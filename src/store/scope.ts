// Namespaces / scopes for Jamgate (D-048).
//
// Jamgate began single-tenant: one human, one memory. A scope lets ONE instance hold several
// independent namespaces (e.g. "amir/greek", "amir/linux") without them interfering — every
// gate check (dedup, supersession, conflict, near-duplicate), every recall, and every forget
// operates strictly within one scope. This is additive and backward-compatible: an absent or
// empty scope resolves to a single DEFAULT_SCOPE, which reproduces the exact single-tenant
// behaviour every pre-namespace client and every already-stored record had.

/** The one namespace an absent/empty scope resolves to. A record written before namespaces
 *  (no `scope` field) reads as this scope, so existing behaviour is unchanged. */
export const DEFAULT_SCOPE = "default";

/**
 * Canonicalize a scope: trim, lowercase, and fold an empty value to {@link DEFAULT_SCOPE}.
 * Scopes are opaque labels; we only normalize case and surrounding whitespace so that
 * "Amir/Greek" and "amir/greek " address one namespace — mirroring how the store already
 * normalizes a memory's `subject`. `null`/`undefined` (no scope supplied) → the default.
 */
export function normalizeScope(scope?: string | null): string {
  const s = (scope ?? "").trim().toLowerCase();
  return s === "" ? DEFAULT_SCOPE : s;
}
