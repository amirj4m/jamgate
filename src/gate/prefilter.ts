/**
 * Cheap rule pre-filter (RULES §5.1): kill the obvious junk before spending any AI.
 * This is layer 1 of the gate only — the stateful checks (dedup, supersession, conflict,
 * near-duplicate) run afterwards in the store, and the thin classifier comes later.
 *
 * Layer 1 grew from two rules to five after a twelve-save stress test walked four
 * non-memories straight through it (D-042, D-043): a credential, the bare word "test", a
 * question, and a weather report. The rules are ordered cheapest-and-most-dangerous first:
 *
 *   1. length          — a fragment cannot carry a fact
 *   2. credentials     — refuse before anything else can echo the text (D-042)
 *   3. pleasantries    — "thanks" is not a memory
 *   4. structure       — fewer than two meaningful tokens says nothing (D-043)
 *   5. questions       — a question asks for a fact, it is not one (D-043)
 *   6. transience      — pinned to this instant, unless the caller typed it (D-043)
 *
 * Every rejection carries a reason the CALLING AGENT can act on, because the agent is the
 * only party that can correct the call. "rejected" with no explanation teaches nothing and
 * gets worked around.
 */

import { detectSecret } from "./secrets.js";
import { isQuestion, isStructureless, isTransient } from "./junk.js";

const PLEASANTRIES = new Set([
  "hi", "hello", "hey", "thanks", "thank you", "ok", "okay", "k",
  "cool", "nice", "lol", "yes", "no", "sure", "yep", "nope", "bye",
]);

export interface Verdict {
  ok: boolean;
  reason?: string;
  /**
   * True when the rejected text must NOT be written to the gate log verbatim. The log is
   * a training buffer for the future classifier, and a credential we just refused to store
   * has no business being persisted by the very same save (D-042).
   */
  redact?: boolean;
}

/** Shortest text that can carry a durable fact. Below this it is a fragment, not a memory. */
export const MIN_TEXT_LENGTH = 4;

/** What the prefilter needs to know about the call beyond the text itself. */
export interface PrefilterContext {
  /** The `type` the caller passed, if any (identity / project / preference / state). */
  type?: string;
}

export function prefilter(text: string, ctx: PrefilterContext = {}): Verdict {
  const t = text.trim();
  // Report the actual length. "too short" on its own is unfalsifiable from the caller's
  // side — it was reported for a memory the agent believed was 1700 characters (the text
  // had in fact never arrived, D-037), and the bare message gave no way to see that.
  if (t.length < MIN_TEXT_LENGTH) {
    return {
      ok: false,
      reason: `too short (${t.length} characters, minimum ${MIN_TEXT_LENGTH})`,
    };
  }

  // Credentials are checked before every other content rule so that no later rule can
  // reject a secret for a lesser reason and log it in full on the way out (D-042).
  const secret = detectSecret(t);
  if (secret) {
    return {
      ok: false,
      redact: true,
      reason:
        `looks like ${secret.label} — refusing to store credentials in shared memory. ` +
        `This memory is read back into every future agent session and syncs to any remote ` +
        `instance; put the secret in a password manager or secret store and, if the fact ` +
        `matters, save where it lives instead of what it is`,
    };
  }

  if (PLEASANTRIES.has(t.toLowerCase())) {
    return { ok: false, reason: "pleasantry / no durable content" };
  }

  if (isStructureless(t)) {
    return {
      ok: false,
      reason:
        "not a statement — a memory needs at least two meaningful words making a claim " +
        'about the user (got a fragment or placeholder text like "test")',
    };
  }

  if (isQuestion(t)) {
    return {
      ok: false,
      reason:
        "this is a question, not a fact — questions ask for memory, they are not memory. " +
        "If the ANSWER is what should be remembered, save that instead",
    };
  }

  // Transient observations are real, just short-lived. They belong to the volatile layers
  // of the model (RULES §4), which already carry a short TTL — but only if the caller says
  // so. Without a `type` the gate would file a weather report as a permanent fact, so it
  // refuses and says exactly how to save it properly.
  if (isTransient(t) && !ctx.type) {
    return {
      ok: false,
      reason:
        'transient, not durable — this describes right now, not a lasting fact. If it is ' +
        'worth keeping for a few hours, re-save it with type "state" so it expires on its ' +
        "own; otherwise it does not belong in memory",
    };
  }

  return { ok: true };
}
