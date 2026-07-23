import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ForgetResult,
  Memory,
  MemorySource,
  MemoryStore,
  SaveInput,
  SaveResult,
} from "./types.js";
import { CURRENT_SCHEMA_VERSION, migrate, type StoreFile } from "./schema.js";
import { normalizeScope } from "./scope.js";
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
  DEFAULT_RELATED_MIN,
  DEFAULT_SEMANTIC_MIN,
  blendRelevance,
  cosineSimilarity,
} from "../embeddings/vector.js";

/** Shortest id prefix `forget` will resolve. A v4 UUID's first 8 hex characters are
 *  ~4 billion apart; anything shorter is a typo risk, not a shorthand (D-041). */
const MIN_ID_PREFIX = 8;

/** Strip what an LLM tends to carry along when it copies an id out of a recall listing:
 *  surrounding whitespace, quotes/backticks/brackets, an "id:" label, and trailing
 *  sentence punctuation. Lowercased, since ids are lowercase UUIDs. */
function normalizeId(raw: string): string {
  const labelled = raw.trim().replace(/^["'`([<]*\s*id\s*[:=]\s*/i, "");
  // Ids are lowercase hex and hyphens, so anything else on either end is copy noise —
  // quotes, backticks, brackets, a trailing comma or period. Trim by character class
  // rather than by a list of delimiters, which order-dependent stripping gets wrong.
  return labelled
    .toLowerCase()
    .replace(/^[^0-9a-f]+/, "")
    .replace(/[^0-9a-f]+$/, "");
}

/** The canonical scope of a stored memory (D-048). A record written before namespaces has
 *  no `scope` field and belongs to the default scope — the same fold `normalizeScope` applies
 *  to an absent input, so an un-migrated record and a default save always compare equal. */
function memScope(m: Memory): string {
  return normalizeScope(m.scope);
}

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
      // The namespace this memory lives in (D-048). Normalized so an absent/empty scope
      // becomes the default — reproducing today's single-tenant behaviour exactly.
      scope: normalizeScope(input.scope),
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
    // Every gate check runs WITHIN one namespace (D-048). Normalize the candidate's scope
    // once and stamp it back, so an imported record that carried no scope is persisted with
    // the default rather than a bare undefined; then only same-scope memories are considered.
    const scope = memScope(candidate);
    candidate.scope = scope;

    const norm = candidate.text.trim().toLowerCase();
    const existing = memories.find(
      (m) => m.status === "active" && memScope(m) === scope && m.text.trim().toLowerCase() === norm,
    );
    if (existing) return { action: "duplicate", memory: existing };

    let retired: Memory[] = [];
    if (candidate.subject) {
      const matches = memories.filter(
        (m) => m.status === "active" && memScope(m) === scope && m.subject === candidate.subject,
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
    }

    // Semantic near-duplicate check (D-026), widened in 0.8.0 (D-044). This isn't an exact
    // duplicate and nothing was superseded, so the candidate is about to be stored as a NEW
    // fact — the last chance to notice it is a reworded copy of one we already hold.
    //
    // It used to run only for subject-LESS candidates, on the reasoning that supplying a
    // subject signals intent to update. That reasoning holds when the subject MATCHES
    // something; it does not hold when it matches nothing. A reworded memory whose subject
    // was spelled differently (or derived differently) fell through the gap and was stored
    // as new — the first finding of the 0.8.0 stress test. Running the check whenever
    // nothing was retired closes the gap without touching supersession: a candidate that
    // superseded an existing memory never reaches here, so a legitimate update is never
    // mistaken for a duplicate.
    let related: Array<{ memory: Memory; similarity: number }> = [];
    if (retired.length === 0 && candidate.embedding) {
      const near = this.findSimilar(candidate.embedding, memories, DEFAULT_RELATED_MIN, scope);
      const duplicates = near.filter((x) => x.similarity >= this.dupThreshold);
      if (duplicates.length > 0) {
        return {
          action: "possible_duplicate",
          memory: candidate,
          possibleDuplicates: duplicates,
        };
      }
      // Below the duplicate bar but well above unrelated: store it, and say what it
      // resembles so the agent can decide whether it is really an update (D-045).
      related = near;
    }

    memories.push(candidate);
    if (retired.length > 0) return { action: "superseded", memory: candidate, retired };
    return related.length > 0
      ? { action: "created", memory: candidate, relatedMemories: related }
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
  async recall(
    query: string,
    limit = 5,
    includeSuperseded = false,
    scope?: string,
  ): Promise<Memory[]> {
    const now = Date.now();
    // Recall is strictly scoped (D-048): only memories in the requested namespace are ever
    // surfaced. An absent/empty scope resolves to the default, so a three-argument call keeps
    // returning exactly what it did before namespaces existed.
    const wantScope = normalizeScope(scope);
    const memories = (await this.readAll()).filter(
      (m) =>
        memScope(m) === wantScope &&
        (includeSuperseded || (m.status === "active" && !isExpired(m.expiresAt, now))),
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

  /**
   * Delete by id. The id an agent passes back has usually made a round trip through a
   * recall listing and an LLM's copy of it, so it arrives trimmed, quoted, comma-suffixed
   * or shortened (D-041). We normalize the input, then accept an exact id or — failing
   * that — an unambiguous prefix of at least MIN_ID_PREFIX characters. Two matches is an
   * error, never a coin flip: deleting the wrong memory is unrecoverable.
   */
  async forget(idOrPrefix: string, scope?: string): Promise<ForgetResult> {
    const needle = normalizeId(idOrPrefix);
    if (!needle) return { ok: false, reason: "not-found" };
    const wantScope = normalizeScope(scope);
    return this.withLock(async () => {
      const memories = await this.readAll();
      // Forget operates WITHIN one namespace (D-048): only same-scope records are candidates,
      // so an id belonging to another scope is simply "not found" here and can never be
      // deleted across a namespace boundary. Prefix ambiguity is likewise judged in-scope.
      const inScope = memories.filter((m) => memScope(m) === wantScope);
      let target = inScope.find((m) => m.id.toLowerCase() === needle);
      if (!target && needle.length >= MIN_ID_PREFIX) {
        const matches = inScope.filter((m) => m.id.toLowerCase().startsWith(needle));
        if (matches.length > 1) {
          return { ok: false, reason: "ambiguous", matches: matches.map((m) => m.id) };
        }
        target = matches[0];
      }
      if (!target) return { ok: false, reason: "not-found" };
      await this.writeAll(memories.filter((m) => m !== target));
      return { ok: true, id: target.id };
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

  /** Active memories in `scope` whose embedding is at/above `floor` similarity to `vec`, most
   *  similar first. Near-duplicate detection is per-namespace (D-048), so a look-alike in
   *  another scope never blocks or annotates this save. Records without an embedding
   *  (older/pre-embedding saves) are simply skipped — they can't be compared, and we never
   *  guess a near-match (D-026). */
  private findSimilar(
    vec: number[],
    memories: Memory[],
    floor: number,
    scope: string,
  ): Array<{ memory: Memory; similarity: number }> {
    return memories
      .filter((m) => m.status === "active" && memScope(m) === scope && Array.isArray(m.embedding))
      .map((m) => ({ memory: m, similarity: cosineSimilarity(vec, m.embedding as number[]) }))
      .filter((x) => x.similarity >= floor)
      .sort((a, b) => b.similarity - a.similarity);
  }
}
