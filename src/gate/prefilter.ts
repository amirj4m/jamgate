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

export function prefilter(text: string): Verdict {
  const t = text.trim();
  if (t.length < 4) return { ok: false, reason: "too short" };
  if (PLEASANTRIES.has(t.toLowerCase())) {
    return { ok: false, reason: "pleasantry / no durable content" };
  }
  return { ok: true };
}
