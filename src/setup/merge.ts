import type { ServerEntry } from "./clients.js";

/**
 * Pure JSON-merge logic for wiring Jamgate into a client's MCP config. No IO — the runner
 * reads the file, calls this to compute the new document + what changed, then writes it back.
 *
 * Invariants (the safety contract of `jamgate setup`):
 *  - We only ever touch our own `mcpServers.<key>` entry. Every other server and every other
 *    top-level field in the file is preserved byte-for-byte.
 *  - Merging is idempotent: writing the same entry again is a no-op ("already-configured").
 *  - A malformed / non-object existing config is treated as "start fresh" rather than throwing,
 *    but the runner still backs up the original file before overwriting it.
 */

export type MergeStatus =
  | "configured" // wrote our entry into a config that had a valid mcpServers object
  | "created" // the config file / mcpServers object did not exist and we created it
  | "updated" // an existing jamgate entry differed and we replaced it
  | "already-configured"; // an identical jamgate entry was already present — no change

export interface MergePlan {
  /** The full config document to write back (only produced when `changed`). */
  config: Record<string, unknown>;
  status: MergeStatus;
  /** Whether the document actually changed and therefore needs writing. */
  changed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural deep-equality, sufficient for the JSON server entries we compare. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Compute the merge of a jamgate server entry into an existing (parsed) config document.
 *
 * @param existing  The parsed config, or undefined if the file did not exist. Anything that
 *                  is not a plain object is treated as absent (we start fresh, preserving
 *                  nothing we can't understand — the caller backs up first).
 * @param key       The server key to manage (always "jamgate").
 * @param entry     The desired server entry.
 */
export function planMerge(
  existing: unknown,
  key: string,
  entry: ServerEntry,
): MergePlan {
  const hadValidRoot = isPlainObject(existing);
  const root: Record<string, unknown> = hadValidRoot ? { ...(existing as Record<string, unknown>) } : {};

  const hadServers = isPlainObject(root.mcpServers);
  const servers: Record<string, unknown> = hadServers
    ? { ...(root.mcpServers as Record<string, unknown>) }
    : {};

  const current = servers[key];
  if (current !== undefined && deepEqual(current, entry)) {
    return { config: root, status: "already-configured", changed: false };
  }

  const status: MergeStatus =
    current !== undefined
      ? "updated"
      : !hadValidRoot || !hadServers
        ? "created"
        : "configured";

  servers[key] = entry as unknown as Record<string, unknown>;
  root.mcpServers = servers;
  return { config: root, status, changed: true };
}
