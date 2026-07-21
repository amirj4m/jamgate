// The storage boundary for Jamgate (D-019).
// The gate and the MCP server depend ONLY on the types and the `MemoryStore` interface
// here — never on a concrete backend. That keeps storage swappable: the flat-file store
// today, SQLite or a hosted Supabase store tomorrow, all behind the same contract.

export type MemoryType = "identity" | "project" | "preference" | "state";
export type MemorySource = "agent-inferred" | "user-confirmed" | "user-explicit";
export type MemoryStatus = "active" | "superseded";

/** Which MCP client wrote this memory, captured server-side from the `clientInfo` in the
 *  MCP `initialize` handshake — NOT self-reported by the calling agent in the tool call.
 *  Provenance we can trust: it says which app (Claude Code, Cursor, Cowork, …) and version
 *  the write actually came from, for auditing a shared cross-agent memory (D-024). */
export interface ClientInfo {
  name: string;
  version?: string;
}

export interface Memory {
  id: string;
  text: string;
  type?: MemoryType;
  /** What this memory is *about* (e.g. "operating-system", "location"). Drives
   *  time-aware supersession: a newer memory with the same subject retires the older
   *  one (RULES §2.3, D-015). Optional — the calling agent supplies it (RULES §5.2). */
  subject?: string;
  source: MemorySource;
  status: MemoryStatus;
  createdAt: string; // ISO timestamp — every memory is a timestamped event (RULES §2.5, §4)
  updatedAt: string;
  /** When this memory goes stale, derived from its `type` at save time (RULES §2.5, §4).
   *  ISO timestamp; absent means it never expires (identity/preference, or untyped).
   *  Expired records are hidden from recall (soft-expire) and eventually compacted. */
  expiresAt?: string;
  /** Set on the OLD memory when a newer one supersedes it. */
  supersededBy?: string;
  supersededAt?: string;
  /** The MCP client that saved this memory, from the initialize handshake (D-024).
   *  Additive and optional — absent on records written before Phase 3 or by a transport
   *  that sent no clientInfo. Schema stays v2-compatible. */
  client?: ClientInfo;
  /** Optional local semantic embedding of `text` (Phase 3, item 4; D-026). Present only
   *  when the optional embedding backend was available at save time — records written
   *  without it (or before Phase 3) simply have none and fall back to fuzzy recall.
   *  Additive/optional → schema stays v2-compatible. */
  embedding?: number[];
}

export interface SaveInput {
  text: string;
  type?: MemoryType;
  source: MemorySource;
  subject?: string;
  /** The MCP client behind this save, stamped by the server from the handshake (D-024). */
  client?: ClientInfo;
}

export interface SaveResult {
  /** created   = new active memory
   *  duplicate = already known (exact, normalized-text match)
   *  superseded = newer fact about the same subject won by recency, old retired (D-015)
   *  conflict  = same subject but the new fact is LESS trusted than the existing one,
   *              so it is NOT stored — the gate flags it for confirmation (RULES §2.3,
   *              §5.4: genuine contradiction → ask, don't silently overwrite).
   *  possible_duplicate = semantically near-identical to an existing memory (embedding
   *              similarity above threshold) but NOT an exact match — the gate does NOT
   *              store it and hands the existing record back to the agent to decide,
   *              mirroring the conflict pattern (never silently dropped; D-026). */
  action: "created" | "duplicate" | "superseded" | "conflict" | "possible_duplicate";
  memory: Memory;
  /** The memories retired by this save (only on action "superseded"). */
  retired?: Memory[];
  /** The existing memories the new one conflicts with (only on action "conflict"). */
  conflictsWith?: Memory[];
  /** The existing near-duplicate(s) (only on action "possible_duplicate"), most similar
   *  first, each annotated with the cosine similarity that triggered the flag. */
  possibleDuplicates?: Array<{ memory: Memory; similarity: number }>;
  /**
   * Existing memories that are RELATED to a newly created one — similar enough to be worth
   * mentioning, not similar enough to refuse (D-045). Present only on action "created".
   *
   * This exists because of a measured limit, not a hunch. Two saves about the same tracked
   * value ("ThinkBook savings 5/10, €640" then "7/10, €768") embed only 0.67 apart — far
   * below any duplicate threshold that could also keep "uses Windows" and "uses Linux"
   * apart (0.81). No cosine cutoff separates those populations, so the gate does not try:
   * it stores the new memory and TELLS the agent what it looks related to, leaving the
   * decision where the context actually is. A hint can never wrongly retire a fact.
   */
  relatedMemories?: Array<{ memory: Memory; similarity: number }>;
}

/**
 * Outcome of a forget. Richer than a boolean because an id PREFIX may resolve to more than
 * one memory (D-041) — the caller has to tell the agent apart from "no such memory".
 */
export type ForgetResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "ambiguous"; matches: string[] };

/**
 * The storage adapter contract. Any backend — flat file (today), SQLite, or a hosted
 * Supabase store (v2, see D-019) — implements this. Swapping stores is a drop-in.
 */
export interface MemoryStore {
  save(input: SaveInput): Promise<SaveResult>;
  recall(query: string, limit?: number, includeSuperseded?: boolean): Promise<Memory[]>;
  /** Accepts a full id or an unambiguous id prefix of at least 8 characters (D-041). */
  forget(idOrPrefix: string): Promise<ForgetResult>;
}
