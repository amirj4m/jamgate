// Non-fact detection (gate layer 1, D-043).
//
// A stress test walked twelve saves past the gate and three of them were not facts at all:
// the bare word "test", a question ("how much is jam's rent?"), and a weather report ("it's
// raining in Athens right now"). Each is junk for a different reason, and none of them is
// caught by a length check.
//
// The three rules here are deliberately narrow, because the failure modes are asymmetric in
// the same way they are everywhere else in this gate: a junk memory is noise the user can
// delete, but a WRONGLY REJECTED memory is a fact the user asked us to keep and we threw
// away, and the agent has no way to tell the difference from a legitimate refusal. So each
// rule fires only on an unambiguous signal and declines otherwise:
//
//   1. NO STATEMENT — fewer than two meaningful tokens, or nothing but filler words. A
//      memory is a claim about the user; a single word cannot be one.
//   2. QUESTION — the text is interrogative as a WHOLE. A question is a request for a fact,
//      not a fact. Rhetorical questions inside a longer memory are untouched.
//   3. TRANSIENT — the text is explicitly pinned to this moment ("right now", "at the
//      moment", live weather). These are real observations with a lifespan of hours, so
//      they are rejected only when the caller gave no `type`; with a `type` they are the
//      volatile layer the model already has TTLs for (RULES §4).
//
// Everything is Unicode-aware. Jamgate's memory is not English-only — a Persian memory
// saved cleanly in the same stress test, and an ASCII-only tokenizer would have counted it
// as zero tokens and rejected it as junk.

/** Tokens carrying no claim on their own. Only used to decide whether a SHORT text says
 *  anything; a long memory is never judged by its filler ratio. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "so", "of", "to", "in", "on", "at", "is",
  "are", "was", "were", "be", "it", "its", "this", "that", "there", "here",
]);

/** Words that are placeholders rather than content. A text made ENTIRELY of these says
 *  nothing regardless of how many of them there are ("test test", "foo bar"). */
const PLACEHOLDERS = new Set([
  "test", "testing", "tests", "asdf", "asdfasdf", "qwerty", "foo", "bar", "baz",
  "blah", "xxx", "yyy", "zzz", "abc", "123", "hmm", "hmmm", "dummy", "sample",
  "placeholder", "lorem", "ipsum", "todo", "tbd", "n/a", "na", "none", "null",
  "undefined", "whatever", "stuff", "thing", "things",
]);

/**
 * Interrogative openers. English plus the Persian forms the user actually writes in —
 * چطور (how), چقدر (how much), چرا (why), کجا (where), کی (who/when), چه/چی (what),
 * آیا (whether). A leading auxiliary ("is", "does", "can") counts too, but ONLY in
 * combination with a question mark, since those words open plenty of declarative
 * sentences.
 */
const WH_OPENERS =
  /^(what|whats|what's|when|where|who|whom|whose|which|why|how|چطور|چگونه|چقدر|چرا|کجا|کِی|کی|چه|چی|آیا)\b/i;

const AUX_OPENERS =
  /^(is|are|was|were|am|do|does|did|can|could|should|would|will|shall|has|have|had|may|might)\b/i;

/** Question marks: ASCII, Arabic/Persian (؟), and fullwidth (？). */
const QUESTION_MARK = /[?؟？]\s*$/;

/**
 * Markers that pin a statement to the present instant. Kept SMALL and strong on purpose.
 * "currently" and "today" were considered and left out: "jam is currently building
 * Jamgate" is a durable project fact, and rejecting it would cost more than the occasional
 * transient note it would catch.
 */
const TRANSIENT_MARKERS =
  /\b(right now|at the moment|at present|just now|for now|as of (right )?now|as we speak|at this moment|currently feeling)\b|الان|همین الان|در حال حاضر/i;

/**
 * Live-weather phrasing, which is transient even without an explicit time marker.
 *
 * A bare adjective is NOT enough: "jam prefers dry climates to humid ones" is a durable
 * preference that mentions weather without describing any. So a condition word only counts
 * when it is framed as happening — an "it's …" copula, a progressive verb (which is
 * momentary by construction), an explicit "the weather …", or a temperature reading.
 */
const WEATHER =
  /\b(it'?s|it is|its)\s+(raining|snowing|drizzling|pouring|sunny|cloudy|overcast|foggy|windy|humid|hot|cold)\b|\b(raining|snowing|drizzling|pouring)\b|\b(the )?weather (in|is|today)\b|-?\d{1,2}\s?°\s?[cf]\b/i;

/** Unicode-aware content tokens: letters/numbers only, punctuation and symbols dropped. */
export function meaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** True when `text` carries no statement: fewer than two tokens, only filler, or only
 *  placeholder words. This is what turns the bare word "test" away. */
export function isStructureless(text: string): boolean {
  const tokens = meaningfulTokens(text);
  if (tokens.length < 2) return true;
  if (tokens.every((t) => FILLER.has(t))) return true;
  if (tokens.every((t) => PLACEHOLDERS.has(t) || FILLER.has(t))) return true;
  return false;
}

/**
 * True when the text is a question AS A WHOLE — it ends on a question mark and either opens
 * with an interrogative word or is a single sentence.
 *
 * The single-sentence condition is what protects a long memory that happens to contain a
 * rhetorical question: "jam's design rule is to ask 'who reads this?' before writing docs."
 * does not end on a question mark, and a multi-sentence note that does still has to open
 * interrogatively to be refused.
 */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (!QUESTION_MARK.test(t)) return false;
  if (WH_OPENERS.test(t) || AUX_OPENERS.test(t)) return true;
  // Single sentence: no sentence-ending punctuation before the final mark.
  const body = t.slice(0, -1);
  return !/[.!?؟。]/.test(body);
}

/** True when the text is explicitly about this moment rather than a durable fact. */
export function isTransient(text: string): boolean {
  return TRANSIENT_MARKERS.test(text) || WEATHER.test(text);
}
