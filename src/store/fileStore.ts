import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Memory, MemorySource, MemoryStore, SaveInput, SaveResult } from "./types.js";
import { CURRENT_SCHEMA_VERSION, migrate, type StoreFile } from "./schema.js";
import {
  computeExpiresAt,
  isCompactable,
  isExpired,
  resolveGraceMs,
  resolveTtlPolicy,
  type TtlPolicy,
} from "./ttl.js";
import { withFileLock } from "./lock.js";

/** How much we trust a memory by where it came from. A lower-trust source must not
 *  silently overwrite a higher-trust one — that's a contradiction to confirm, not an
 *  update to apply (RULES §2.3). */
const TRUST: Record<MemorySource, number> = {
  "agent-inferred": 1,
  "user-confirmed": 2,
  "user-explicit": 3,
};

const DEFAULT_PATH = join(homedir(), ".jamgate", "memory.json");

/**
 * The default store for the MVP (RULES §8: file/SQLite first, BYO stores later).
 * Implements the `MemoryStore` adapter contract (D-019) so a hosted store can drop in
 * later without touching the gate. Real, not a stub — save/recall/forget all persist.
 *
 * Phase 2 robustness (see DECISIONS D-020..D-023):
 *  - writes are atomic + durable (temp file + fsync + rename),
 *  - records expire by type and are compacted once long-dead,
 *  - concurrent writers on one host are serialized by a lock file,
 *  - the file carries a schemaVersion and old formats migrate automatically.
 */
export class FileStore implements MemoryStore {
  private path: string;
  private lockPath: string;
  private ttl: TtlPolicy;
  private graceMs: number;

  constructor(path: string = process.env.JAMGATE_STORE ?? DEFAULT_PATH) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    // Read policy once at construction so a single store instance is internally
    // consistent; a fresh instance picks up any changed env overrides.
    this.ttl = resolveTtlPolicy();
    this.graceMs = resolveGraceMs();
  }

  /** Load the store, migrating any older on-disk format to the current schema in memory
   *  (the upgraded shape is persisted on the next write). */
  private async load(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: CURRENT_SCHEMA_VERSION, memories: [] };
      }
      throw err;
    }
    if (raw.trim() === "") return { schemaVersion: CURRENT_SCHEMA_VERSION, memories: [] };
    return migrate(JSON.parse(raw), this.ttl);
  }

  private async readAll(): Promise<Memory[]> {
    return (await this.load()).memories;
  }

  /**
   * Atomic, durable write (Phase 2, item 1). Serialize to a temp file in the SAME
   * directory, fsync it, then rename over the target. `rename(2)` is atomic on a POSIX
   * local filesystem, so a concurrent reader — or a crash mid-write — sees either the
   * old file or the new one, never a half-written (torn) store. The temp lives in the
   * same directory so the rename stays on one filesystem (a cross-device rename is not
   * atomic).
   */
  private async writeAll(memories: Memory[]): Promise<void> {
    const dir = dirname(this.path);
    await fs.mkdir(dir, { recursive: true });
    const file: StoreFile = { schemaVersion: CURRENT_SCHEMA_VERSION, memories };
    const data = JSON.stringify(file, null, 2);
    const tmp = join(dir, `.${basename(this.path)}.${randomUUID()}.tmp`);
    try {
      await this.persist(tmp, data);
      await fs.rename(tmp, this.path);
    } catch (err) {
      await fs.rm(tmp, { force: true }); // never leave an orphaned temp behind
      throw err;
    }
  }

  /** Write `data` to `tmpPath` and fsync it to disk. Factored out as a seam so a test
   *  can simulate a crash mid-write and prove the committed store survives intact. */
  protected async persist(tmpPath: string, data: string): Promise<void> {
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync(); // flush to disk before the rename commits the new file
    } finally {
      await handle.close();
    }
  }

  /**
   * Write a memory through the stateful checks:
   *  - exact-duplicate dedup (RULES §2.2)
   *  - time-aware supersession (RULES §2.3, D-015): a newer memory with the same
   *    `subject` retires the old one by recency (kept, not deleted, for audit).
   *  - contradiction guard (RULES §2.3): a lower-trust source can't silently overwrite
   *    a higher-trust one on the same subject → returns "conflict" for confirmation.
   *
   * The whole read-modify-write runs under the store lock (re-reading the file fresh
   * inside the lock), so a second process saving at the same time cannot lose this write.
   */
  async save(input: SaveInput): Promise<SaveResult> {
    return this.withLock(() => this.saveLocked(input));
  }

  /** Ensure the store directory exists (the lock file lives there too), then run `fn`
   *  while holding the store lock. Every read-modify-write goes through here. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    return withFileLock(this.lockPath, fn);
  }

  private async saveLocked(input: SaveInput): Promise<SaveResult> {
    const memories = await this.readAll();
    const norm = input.text.trim().toLowerCase();

    const existing = memories.find(
      (m) => m.status === "active" && m.text.trim().toLowerCase() === norm,
    );
    if (existing) return { action: "duplicate", memory: existing };

    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      text: input.text.trim(),
      type: input.type,
      subject: input.subject?.trim().toLowerCase() || undefined,
      source: input.source,
      status: "active",
      createdAt: now,
      updatedAt: now,
      // Assign a freshness window by type (RULES §2.5, §4). Undefined = never expires.
      expiresAt: computeExpiresAt(input.type, now, this.ttl),
    };

    let retired: Memory[] = [];
    if (memory.subject) {
      const matches = memories.filter(
        (m) => m.status === "active" && m.subject === memory.subject,
      );
      if (matches.length > 0) {
        const maxTrust = Math.max(...matches.map((m) => TRUST[m.source]));
        if (TRUST[memory.source] < maxTrust) {
          // Lower-trust fact can't silently overwrite a higher-trust one → flag, don't store.
          return { action: "conflict", memory, conflictsWith: matches };
        }
        // Equal-or-higher trust + newer → supersede by recency (D-015).
        retired = matches;
        for (const old of retired) {
          old.status = "superseded";
          old.supersededBy = memory.id;
          old.supersededAt = now;
          old.updatedAt = now;
        }
      }
    }

    memories.push(memory);
    // Opportunistic compaction: drop long-dead records as part of this same write, so
    // the file self-prunes without a background scheduler (Phase 2, item 2).
    const next = this.dropCompactable(memories, Date.now());
    await this.writeAll(next);
    return retired.length > 0
      ? { action: "superseded", memory, retired }
      : { action: "created", memory };
  }

  /** Recall returns ACTIVE, unexpired memories only — retired/superseded and (soft-)
   *  expired states are never surfaced as current facts (D-015: don't confront the user
   *  with stale words). Pass `includeSuperseded` for the full audit history. */
  async recall(query: string, limit = 5, includeSuperseded = false): Promise<Memory[]> {
    const now = Date.now();
    const memories = (await this.readAll()).filter(
      (m) => includeSuperseded || (m.status === "active" && !isExpired(m.expiresAt, now)),
    );
    const q = query.trim().toLowerCase();
    if (!q) return memories.slice(-limit).reverse();
    return memories
      .map((m) => ({ m, score: overlapScore(q, m.text.toLowerCase()) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.m);
  }

  async forget(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const memories = await this.readAll();
      const next = memories.filter((m) => m.id !== id);
      if (next.length === memories.length) return false;
      await this.writeAll(next);
      return true;
    });
  }

  /**
   * Maintenance: physically remove records that have been expired for longer than the
   * grace window (Phase 2, item 2). Soft-expired records (expired but still within
   * grace) are deliberately kept — hidden from recall yet available for audit/recovery.
   * Returns the number removed. Runs opportunistically on every save, and is also
   * exposed here so a host can trigger it explicitly.
   */
  async compact(): Promise<number> {
    return this.withLock(async () => {
      const memories = await this.readAll();
      const next = this.dropCompactable(memories, Date.now());
      const removed = memories.length - next.length;
      if (removed > 0) await this.writeAll(next);
      return removed;
    });
  }

  private dropCompactable(memories: Memory[], nowMs: number): Memory[] {
    return memories.filter((m) => !isCompactable(m.expiresAt, nowMs, this.graceMs));
  }
}

/** Crude word-overlap relevance for the MVP. Embeddings come later (DECISIONS open item). */
function overlapScore(query: string, text: string): number {
  const qWords = new Set(query.split(/\W+/).filter(Boolean));
  if (qWords.size === 0) return 0;
  let hits = 0;
  for (const w of qWords) if (text.includes(w)) hits++;
  return hits / qWords.size;
}
