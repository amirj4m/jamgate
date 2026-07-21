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
import { memoryRelevance, MIN_RELEVANCE } from "../gate/relevance.js";
import type { Embedder } from "../embeddings/embedder.js";
import {
  DEFAULT_DUP_THRESHOLD,
  DEFAULT_SEMANTIC_MIN,
  blendRelevance,
  cosineSimilarity,
} from "../embeddings/vector.js";

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
 *
 * Phase 3 (D-026): an OPTIONAL embedder can be injected. When present, saves carry a local
 * semantic embedding, recall blends semantic similarity with the fuzzy lexical score, and a
 * near-duplicate is flagged as "possible_duplicate". When absent, everything falls back to
 * fuzzy-only recall — the base install needs no ML runtime, and CI runs this path.
 */
export class FileStore implements MemoryStore {
  private path: string;
  private lockPath: string;
  private ttl: TtlPolicy;
  private graceMs: number;
  private embedder?: Embedder;
  private dupThreshold: number;

  constructor(
    path: string = process.env.JAMGATE_STORE ?? DEFAULT_PATH,
    opts: { embedder?: Embedder; dupThreshold?: number } = {},
  ) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    // Read policy once at construction so a single store instance is internally
    // consistent; a fresh instance picks up any changed env overrides.
    this.ttl = resolveTtlPolicy();
    this.graceMs = resolveGraceMs();
    this.embedder = opts.embedder;
    this.dupThreshold = opts.dupThreshold ?? DEFAULT_DUP_THRESHOLD;
  }

  /** The resolved on-disk path of this store, for reporting in the backup CLI (D-033). */
  get storePath(): string {
    return this.path;
  }

  /** Best-effort embedding: returns the vector, or undefined if no embedder is configured
   *  or the embedder fails (recall/near-dup then degrade to fuzzy for this call). */
  private async embed(text: string): Promise<number[] | undefined> {
    if (!this.embedder) return undefined;
    try {
      return await this.embedder.embed(text);
    } catch (err) {
      console.error("jamgate: embedding failed, using fuzzy recall for this op:", err);
      return undefined;
    }
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

    // Compute the semantic embedding once (best-effort). Stored on the record and reused
    // for near-duplicate detection below. Undefined when no embedder is configured.
    const embedding = await this.embed(input.text.trim());

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
      // Trusted provenance from the MCP handshake, not agent-claimed (D-024).
      client: input.client,
      // Local semantic vector (D-026); absent when embeddings are unavailable.
      embedding,
    };

    const result = this.applyGate(memory, memories, now);
    // Only a write outcome (created/superseded) mutates the store. Duplicate/conflict/
    // possible_duplicate are early rejections that leave the file untouched.
    if (result.action === "created" || result.action === "superseded") {
      // Opportunistic compaction: drop long-dead records as part of this same write, so
      // the file self-prunes without a background scheduler (Phase 2, item 2).
      const next = this.dropCompactable(memories, Date.now());
      await this.writeAll(next);
    }
    return result;
  }

  /**
   * The stateful write-time gate, applied to a fully-formed candidate against an in-memory
   * `memories` list. Pure w.r.t. the disk — it MUTATES `memories` (pushing the candidate and
   * marking retired records) on an accept/supersede, but never persists; the caller writes.
   * Factored out of `saveLocked` so a bulk import can replay many candidates through the exact
   * same rules under one lock and one write (D-033), instead of re-implementing the gate.
   *
   *  - exact-duplicate dedup (RULES §2.2)
   *  - time-aware supersession by `subject` + recency (RULES §2.3, D-015)
   *  - contradiction guard: a lower-trust source can't overwrite a higher-trust one (RULES §2.3)
   *  - semantic near-duplicate flag when no subject drives supersession (D-026)
   *
   * `now` stamps the supersededAt/updatedAt on any retired records — for a live save it equals
   * the candidate's createdAt; for an import it is the (real) import time, while the candidate
   * keeps its original createdAt.
   */
  private applyGate(candidate: Memory, memories: Memory[], now: string): SaveResult {
    const norm = candidate.text.trim().toLowerCase();
    const existing = memories.find(
      (m) => m.status === "active" && m.text.trim().toLowerCase() === norm,
    );
    if (existing) return { action: "duplicate", memory: existing };

    let retired: Memory[] = [];
    if (candidate.subject) {
      const matches = memories.filter(
        (m) => m.status === "active" && m.subject === candidate.subject,
      );
      if (matches.length > 0) {
        const maxTrust = Math.max(...matches.map((m) => TRUST[m.source]));
        if (TRUST[candidate.source] < maxTrust) {
          // Lower-trust fact can't silently overwrite a higher-trust one → flag, don't store.
          return { action: "conflict", memory: candidate, conflictsWith: matches };
        }
        // Equal-or-higher trust + newer → supersede by recency (D-015).
        retired = matches;
        for (const old of retired) {
          old.status = "superseded";
          old.supersededBy = candidate.id;
          old.supersededAt = now;
          old.updatedAt = now;
        }
      }
    } else if (candidate.embedding) {
      // No subject to drive supersession, and this isn't an exact duplicate — check whether
      // it is a SEMANTIC near-duplicate of something already on file (D-026). If so, don't
      // store it; hand the existing record back so the agent decides (mirrors "conflict",
      // never a silent drop). A subject-bearing save intentionally skips this: supplying a
      // subject signals intent to update, handled by supersession above.
      const near = this.findNearDuplicates(candidate.embedding, memories);
      if (near.length > 0) {
        return { action: "possible_duplicate", memory: candidate, possibleDuplicates: near };
      }
    }

    memories.push(candidate);
    return retired.length > 0
      ? { action: "superseded", memory: candidate, retired }
      : { action: "created", memory: candidate };
  }

  /**
   * Full, unfiltered snapshot of the store for backup/export (D-033): active AND superseded
   * records, expired ones included, in on-disk order. Read-only, so it runs without the write
   * lock — the atomic temp+rename write path means a concurrent reader always sees a whole
   * file, never a torn one. Any older on-disk shape is migrated in memory first.
   */
  async exportAll(): Promise<Memory[]> {
    return this.readAll();
  }

  /**
   * Replay a batch of pre-formed memories through the gate as one atomic transaction (D-033).
   * Every ACTIVE record runs through the exact same rules as a live save (dedup, supersession,
   * conflict guard, near-duplicate) — imports respect quality, they never blind-append. Records
   * already marked `superseded` in the source are historical audit and are NOT re-activated
   * through the gate; they are counted as skipped. The candidates keep their original ids,
   * timestamps and provenance (only retired records are re-stamped at import time). The whole
   * read-modify-write happens under one lock and a single write; `dryRun` reports what would
   * happen and writes nothing.
   */
  async importBatch(
    records: Memory[],
    opts: { dryRun?: boolean } = {},
  ): Promise<{ outcomes: SaveResult[]; skippedSuperseded: number; dryRun: boolean }> {
    return this.withLock(async () => {
      const memories = await this.readAll();
      const now = new Date().toISOString();

      // Only live facts go through the gate. Replay them oldest-first so recency-based
      // supersession resolves deterministically, matching the order the facts were saved.
      const active = records.filter((r) => (r.status ?? "active") === "active");
      const skippedSuperseded = records.length - active.length;
      active.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const outcomes: SaveResult[] = active.map((r) => this.applyGate(r, memories, now));

      const changed = outcomes.some(
        (o) => o.action === "created" || o.action === "superseded",
      );
      if (!opts.dryRun && changed) {
        const next = this.dropCompactable(memories, Date.now());
        await this.writeAll(next);
      }
      return { outcomes, skippedSuperseded, dryRun: opts.dryRun ?? false };
    });
  }

  /** Recall returns ACTIVE, unexpired memories only — retired/superseded and (soft-)
   *  expired states are never surfaced as current facts (D-015: don't confront the user
   *  with stale words). Pass `includeSuperseded` for the full audit history. */
  async recall(query: string, limit = 5, includeSuperseded = false): Promise<Memory[]> {
    const now = Date.now();
    const memories = (await this.readAll()).filter(
      (m) => includeSuperseded || (m.status === "active" && !isExpired(m.expiresAt, now)),
    );
    const q = query.trim();
    if (!q) return memories.slice(-limit).reverse();

    // Fuzzy, deterministic lexical relevance (Phase 3, item 2). Always computed. Beats
    // plain word-overlap on plurals/typos/word-boundary noise.
    // When an embedder is available (D-026), also compute semantic similarity and blend it
    // in — this is what earns synonym reach ("automobile" recalling a "car" memory) that
    // the lexical scorer structurally cannot. A memory qualifies for recall if it is
    // lexically relevant OR strongly semantically similar; results rank by the blended score.
    const qVec = await this.embed(q);

    const scored = memories.map((m) => {
      // Score the whole memory — text, subject and type — not just the text (D-036).
      const lexical = memoryRelevance(q, m);
      const semantic =
        qVec && Array.isArray(m.embedding) ? cosineSimilarity(qVec, m.embedding) : 0;
      const qualifies = lexical >= MIN_RELEVANCE || semantic >= DEFAULT_SEMANTIC_MIN;
      const score = qVec ? blendRelevance(lexical, semantic) : lexical;
      return { m, score, qualifies };
    });

    return scored
      .filter((x) => x.qualifies)
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

  /** Active memories whose embedding is at/above the near-duplicate threshold to `vec`,
   *  most similar first. Records without an embedding (older/pre-embedding saves) are
   *  simply skipped — they can't be compared, and we never guess a near-match (D-026). */
  private findNearDuplicates(
    vec: number[],
    memories: Memory[],
  ): Array<{ memory: Memory; similarity: number }> {
    return memories
      .filter((m) => m.status === "active" && Array.isArray(m.embedding))
      .map((m) => ({ memory: m, similarity: cosineSimilarity(vec, m.embedding as number[]) }))
      .filter((x) => x.similarity >= this.dupThreshold)
      .sort((a, b) => b.similarity - a.similarity);
  }
}
