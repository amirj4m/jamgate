// On-disk schema versioning + migration (Phase 2, item 4).
//
// The store file used to be a bare JSON array of memories with no version marker.
// Adding fields (expiresAt) and, later, other shape changes means existing users'
// files must keep working — so every file now carries an explicit `schemaVersion`, and
// this module upgrades any older shape to the current one on read. Migration is pure
// and in-memory; the upgraded shape is persisted the next time the store writes.

import type { Memory } from "./types.js";
import { computeExpiresAt, type TtlPolicy } from "./ttl.js";
import { DEFAULT_SCOPE } from "./scope.js";

/** Current on-disk schema version.
 *  v1 (implicit): a bare `Memory[]`, no version field, no `expiresAt`.
 *  v2: a versioned envelope `{ schemaVersion, memories }` with per-record `expiresAt`.
 *  v3: every record carries a `scope` (D-048); records written before namespaces are
 *      migrated into the default scope, preserving single-tenant behaviour exactly. */
export const CURRENT_SCHEMA_VERSION = 3;

/** The on-disk envelope (schema v2+). */
export interface StoreFile {
  schemaVersion: number;
  memories: Memory[];
}

/** Parse-and-migrate any recognized on-disk shape to the current in-memory envelope.
 *  Unrecognized/empty input yields an empty store rather than throwing, so a corrupt or
 *  blank file degrades to "no memories yet" instead of crashing the server on startup. */
export function migrate(parsed: unknown, policy: TtlPolicy): StoreFile {
  // Legacy v1: a bare array of memories. Wrap it and backfill `expiresAt` so volatile
  // records saved before Phase 2 start honoring their type's freshness window, and stamp
  // the default scope (v3, D-048) so they read exactly as they did when single-tenant.
  if (Array.isArray(parsed)) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      memories: parsed.map((m) => backfillScope(backfillExpiry(m as Memory, policy))),
    };
  }

  // v2+: already an envelope. Backfill the scope (v2→v3, D-048) on any record that predates
  // namespaces. Future migrations (v3→v4, …) branch on schemaVersion here.
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as Partial<StoreFile>).memories)
  ) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      memories: (parsed as StoreFile).memories.map(backfillScope),
    };
  }

  return { schemaVersion: CURRENT_SCHEMA_VERSION, memories: [] };
}

/** Stamp the default scope on a record written before namespaces (v3, D-048). A record that
 *  already carries a non-empty scope is returned untouched, so a memory saved into a named
 *  namespace keeps it across a migration. */
function backfillScope(m: Memory): Memory {
  const s = m.scope;
  return s !== undefined && s !== null && String(s).trim() !== ""
    ? m
    : { ...m, scope: DEFAULT_SCOPE };
}

/** Derive `expiresAt` for a legacy record that predates the expiry field. Records that
 *  already have one, or that carry no type, are returned untouched. */
function backfillExpiry(m: Memory, policy: TtlPolicy): Memory {
  if (m.expiresAt !== undefined || m.type === undefined) return m;
  const expiresAt = computeExpiresAt(m.type, m.createdAt, policy);
  return expiresAt ? { ...m, expiresAt } : m;
}
