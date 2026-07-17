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
   *  duplicate = already known
   *  superseded = newer fact about the same subject won by recency, old retired (D-015)
   *  conflict  = same subject but the new fact is LESS trusted than the existing one,
   *              so it is NOT stored — the gate flags it for confirmation (RULES §2.3,
   *              §5.4: genuine contradiction → ask, don't silently overwrite). */
  action: "created" | "duplicate" | "superseded" | "conflict";
  memory: Memory;
  /** The memories retired by this save (only on action "superseded"). */
  retired?: Memory[];
  /** The existing memories the new one conflicts with (only on action "conflict"). */
  conflictsWith?: Memory[];
}

/**
 * The storage adapter contract. Any backend — flat file (today), SQLite, or a hosted
 * Supabase store (v2, see D-019) — implements this. Swapping stores is a drop-in.
 */
export interface MemoryStore {
  save(input: SaveInput): Promise<SaveResult>;
  recall(query: string, limit?: number, includeSuperseded?: boolean): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
}
