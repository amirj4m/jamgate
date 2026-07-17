// Type-based TTL / expiry policy (Phase 2, item 2; RULES §2.5, §4).
//
// Every memory is a timestamped event with a freshness window, not a standing rule.
// The window is derived from the memory's `type`, mirroring the 5-layer model in
// RULES §4 (organized by how fast each layer changes):
//
//   identity   — who the user is (name, role, language) ............ never expires
//   preference — lasting, identity-adjacent trait ................... never expires
//   project    — what they're building (weeks–months) .............. long TTL
//   state      — volatile focus / physical / emotional state ....... short TTL
//
// A memory with no `type` gets no expiry: we do not guess a lifespan for something we
// could not classify — better to keep it than silently drop it.
//
// Every default is overridable via environment variables (see ENV_KEYS below), so a
// deployment can tune freshness without code changes. This module is pure and holds no
// I/O, which keeps the policy trivially testable.

import type { MemoryType } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** TTL per memory type, in milliseconds. `null` means "never expires". */
export type TtlPolicy = Record<MemoryType, number | null>;

/** Default freshness windows, in days. `null` = never. Overridable per type via env. */
export const DEFAULT_TTL_DAYS: Record<MemoryType, number | null> = {
  identity: null,
  preference: null,
  project: 90,
  state: 2,
};

/** How long (days) a soft-expired record is retained before compaction may drop it. */
export const DEFAULT_COMPACT_GRACE_DAYS = 30;

/** Env var that overrides each type's TTL. Value: a number of days, or `never`/`none`. */
const ENV_KEYS: Record<MemoryType, string> = {
  identity: "JAMGATE_TTL_IDENTITY_DAYS",
  preference: "JAMGATE_TTL_PREFERENCE_DAYS",
  project: "JAMGATE_TTL_PROJECT_DAYS",
  state: "JAMGATE_TTL_STATE_DAYS",
};

/** Env var that overrides the compaction grace window (in days). */
export const GRACE_ENV_KEY = "JAMGATE_COMPACT_GRACE_DAYS";

/** Parse a days value into milliseconds. `never`/`none`/`off` → null; garbage → fallback. */
function parseDaysMs(raw: string | undefined, fallbackMs: number | null): number | null {
  if (raw === undefined) return fallbackMs;
  const t = raw.trim().toLowerCase();
  if (t === "never" || t === "none" || t === "off") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return fallbackMs; // ignore junk, keep the default
  return n * DAY_MS;
}

/** Resolve the effective TTL policy, applying any per-type env overrides. */
export function resolveTtlPolicy(env: NodeJS.ProcessEnv = process.env): TtlPolicy {
  const policy = {} as TtlPolicy;
  for (const type of Object.keys(ENV_KEYS) as MemoryType[]) {
    const def = DEFAULT_TTL_DAYS[type];
    policy[type] = parseDaysMs(env[ENV_KEYS[type]], def === null ? null : def * DAY_MS);
  }
  return policy;
}

/** Resolve the compaction grace window, in milliseconds. Never falls back to null. */
export function resolveGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseDaysMs(env[GRACE_ENV_KEY], DEFAULT_COMPACT_GRACE_DAYS * DAY_MS);
  return parsed ?? DEFAULT_COMPACT_GRACE_DAYS * DAY_MS;
}

/** Compute the expiry timestamp for a memory of `type` created at `createdAtISO`.
 *  Returns undefined for untyped or never-expiring types. */
export function computeExpiresAt(
  type: MemoryType | undefined,
  createdAtISO: string,
  policy: TtlPolicy,
): string | undefined {
  if (!type) return undefined;
  const ttl = policy[type];
  if (ttl === null || ttl === undefined) return undefined;
  return new Date(new Date(createdAtISO).getTime() + ttl).toISOString();
}

/** A memory is (soft-)expired once its expiry has passed. No expiry → never expires. */
export function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= nowMs;
}

/** A memory is compactable once it has been expired for longer than the grace window.
 *  Soft-expired-but-within-grace records are kept (hidden from recall, still auditable). */
export function isCompactable(
  expiresAt: string | undefined,
  nowMs: number,
  graceMs: number,
): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() + graceMs <= nowMs;
}
