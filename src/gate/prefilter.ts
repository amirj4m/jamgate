/**
 * Cheap rule pre-filter (RULES §5.1): kill the obvious junk before spending any AI.
 * This is layer 1 of the gate only — salience scoring and the thin classifier come later.
 */

const PLEASANTRIES = new Set([
  "hi", "hello", "hey", "thanks", "thank you", "ok", "okay", "k",
  "cool", "nice", "lol", "yes", "no", "sure", "yep", "nope", "bye",
]);

export interface Verdict {
  ok: boolean;
  reason?: string;
}

/** Shortest text that can carry a durable fact. Below this it is a fragment, not a memory. */
export const MIN_TEXT_LENGTH = 4;

export function prefilter(text: string): Verdict {
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
  if (PLEASANTRIES.has(t.toLowerCase())) {
    return { ok: false, reason: "pleasantry / no durable content" };
  }
  return { ok: true };
}
