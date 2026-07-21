// Best-effort automatic subject derivation (Phase 3, item 5).
//
// `subject` is what a memory is *about* — the key that drives time-aware supersession
// (RULES §2.3, D-015): a newer memory with the same subject retires the older one. The
// calling agent is asked to supply it, but often won't. When it's missing, we try to derive
// one from the text with plain, deterministic rules — NO ML.
//
// This is deliberately CONSERVATIVE. A wrong subject would wrongly retire an unrelated
// memory, so the bar for auto-assigning is high: we only return a subject when a rule
// matches with confidence, and otherwise leave it unset (undefined). Missing a subject is
// safe (the memory simply isn't subject-supersedable); inventing a wrong one is not.
//
// Two layers, high-confidence first:
//   1. a curated keyword map for the most common, unambiguous subjects (location, OS, …);
//   2. a possessive/copula pattern — "<determiner> <noun phrase> is/are …" — that lifts the
//      noun phrase as the subject ("my favorite color is blue" → "favorite-color").
// The output is a lowercase, hyphenated key, matching the convention used elsewhere.

/** Longest text we will guess a subject for. A one-fact memory ("jam now lives in Athens")
 *  is well under this; a pasted profile or financial model is far over it. Auto-derivation
 *  is the only thing gated by this — an agent-supplied `subject` is always honoured. */
const MAX_AUTO_SUBJECT_CHARS = 300;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "their", "this", "to",
  "was", "were", "with",
]);

/** High-confidence keyword → subject rules, checked in order (first match wins). Each
 *  pattern is anchored on distinctive words so it rarely fires by accident. */
const KEYWORD_RULES: Array<{ subject: string; pattern: RegExp }> = [
  { subject: "location", pattern: /\b(lives?|living|located|resides?|based)\b/ },
  {
    subject: "operating-system",
    pattern: /\boperating system\b|\b(linux|windows|macos|ubuntu|debian|fedora|arch)\b/,
  },
  { subject: "email", pattern: /\bemail\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ },
  { subject: "timezone", pattern: /\btime ?zone\b|\butc[+-]?\d/ },
  { subject: "name", pattern: /\b(name is|named|call me|goes by)\b/ },
  {
    subject: "programming-language",
    pattern: /\b(programs?|coding|codes?|develops?|writes?) in\b|\bprogramming language\b/,
  },
  { subject: "current-project", pattern: /\b(working on|building|developing|current project)\b/ },
];

/** Possessive/copula extractor: "<det> <noun phrase> is/are …". Captures the noun phrase. */
const COPULA = /\b(?:my|your|their|his|her|our|its|the|[a-z]+'s)\s+([a-z]+(?:\s+[a-z]+){0,2})\s+(?:is|are|was|were)\b/;

/**
 * Derive a best-effort subject from `text`, or undefined when no rule fires confidently.
 * Deterministic and dependency-free.
 */
export function deriveSubject(text: string): string | undefined {
  const lower = text.toLowerCase();

  // A long memory is almost never ABOUT one thing (D-040). The rules below scan the whole
  // text and the first hit wins, so on a multi-paragraph dump an incidental "lives in
  // ~/Documents/accountant" makes the memory's subject "location" — and three unrelated
  // dumps then supersede each other in turn. Above this length we decline to guess.
  if (lower.length > MAX_AUTO_SUBJECT_CHARS) return undefined;

  // Ambiguity guard (D-040): if the text trips two or more DIFFERENT keyword rules it is
  // covering several topics, and "first match wins" would be an arbitrary pick. Decline.
  const hits = KEYWORD_RULES.filter((r) => r.pattern.test(lower));
  if (hits.length > 1) return undefined;
  if (hits.length === 1) return hits[0].subject;

  const m = COPULA.exec(lower);
  if (m) {
    const phrase = normalizePhrase(m[1]);
    if (phrase) return phrase;
  }

  return undefined; // not confident → leave unset (safe)
}

/** Turn a captured noun phrase into a subject key: drop stopwords, keep 1–3 content tokens,
 *  hyphenate. Returns undefined if nothing meaningful remains. */
function normalizePhrase(phrase: string): string | undefined {
  const tokens = phrase
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  if (tokens.length === 0 || tokens.length > 3) return undefined;
  // Guard against a lone ultra-generic token producing a useless subject.
  if (tokens.length === 1 && tokens[0].length < 3) return undefined;
  return tokens.join("-");
}
