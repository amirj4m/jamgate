// Fuzzy, dependency-free relevance scoring for recall (Phase 3, item 2).
//
// The MVP recall scored by crude word overlap: for each query word, does the memory text
// contain it as a substring? That is brittle — "projects" misses "project", "berln" misses
// "berlin", and "cat" spuriously matches "category". This module replaces it with a
// deterministic, ML-free scorer that is markedly more forgiving of the small surface
// variations real queries carry, while staying fully local and reproducible.
//
// It is NOT semantic: it has no notion that "car" and "automobile" mean the same thing.
// Synonyms are the job of the optional embedding layer (Phase 3, item 4); this layer earns
// its keep on morphology and typos, deterministically and with zero dependencies.
//
// The score blends two signals:
//   1. weighted token overlap — each query token scored by its best fuzzy match among the
//      text tokens (exact/stemmed match = 1, else a trigram-similarity partial credit),
//      weighted so longer, more-informative tokens count for more and stopwords for nothing;
//   2. whole-string trigram similarity — a character-level Dice coefficient that rewards
//      overall shared substance and catches matches the tokenizer splits apart.
// Token overlap dominates (it is the precise signal); trigram similarity is a smaller
// tie-breaker that mainly helps on typos and word-boundary noise.

/** Blend weight: token overlap is the primary signal, trigram a secondary tie-breaker. */
const TOKEN_WEIGHT = 0.75;
const TRIGRAM_WEIGHT = 0.25;

/** Below this, a memory is treated as not matching the query at all (keeps trigram noise
 *  from surfacing unrelated memories). Chosen so a single solid token match clears it. */
export const MIN_RELEVANCE = 0.1;

/** A fuzzy token match below this trigram similarity earns no credit. Prevents two words
 *  that merely share a first letter ("berlin"/"build") from scoring as a near-match, while
 *  still crediting genuine typos ("berlin"/"berln" ≈ 0.6). */
const FUZZY_TOKEN_FLOOR = 0.4;

/** Common function words that carry no discriminating signal. Deliberately small — only
 *  words that are near-always noise in a short factual memory. If a query is made ENTIRELY
 *  of these, we fall back to using them so the query still matches something. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
  "has", "have", "how", "i", "in", "is", "it", "its", "me", "my", "of", "on",
  "or", "so", "that", "the", "their", "them", "they", "this", "to", "was", "were",
  "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

/** Split text into lowercase alphanumeric tokens, punctuation stripped. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Stemming-lite: strip a few common English inflectional suffixes so "projects",
 * "projecting" and "project" collapse to one stem. Intentionally crude and conservative
 * (no Porter stemmer, no dependency) — it only trims suffixes when a reasonable stem
 * length remains, so short tokens are left intact rather than mangled.
 */
export function stem(token: string): string {
  let t = token;
  const trim = (suffix: string, min: number) => {
    if (t.length >= suffix.length + min && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      return true;
    }
    return false;
  };
  // Order matters: try longer/derivational suffixes before the bare plural -s.
  trim("ing", 3) || trim("edly", 3) || trim("ed", 3) || trim("ly", 3);
  trim("ies", 2) && (t += "y"); // "memories" -> "memory"
  trim("es", 3) || trim("s", 3);
  return t;
}

/** Content stems of a text: tokenized, stopwords removed, each stemmed. Falls back to the
 *  full stemmed token list when the text is nothing but stopwords, so it never goes empty
 *  for a non-empty input. */
export function contentStems(text: string): string[] {
  const tokens = tokenize(text);
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  const kept = content.length > 0 ? content : tokens;
  return kept.map(stem);
}

/** Character trigrams of a string (padded so short strings still produce trigrams). */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Sørensen–Dice similarity of two strings over character trigrams, in [0, 1]. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}

/** How well a single query stem matches a single text stem: exact = 1, else trigram
 *  partial credit (so "berln" still scores against "berlin"). */
function tokenSimilarity(q: string, t: string): number {
  if (q === t) return 1;
  const sim = trigramSimilarity(q, t);
  return sim >= FUZZY_TOKEN_FLOOR ? sim : 0;
}

/**
 * Relevance of `text` to `query`, in [0, 1]. Deterministic and dependency-free.
 * 0 means no meaningful overlap. Higher is more relevant.
 */
export function relevanceScore(query: string, text: string): number {
  const qStems = contentStems(query);
  const tStems = contentStems(text);
  if (qStems.length === 0 || tStems.length === 0) return 0;

  // Weighted token overlap: each query stem earns its best fuzzy match among text stems,
  // weighted by stem length so a hit on "operating" counts for more than a hit on "os".
  let weighted = 0;
  let totalWeight = 0;
  for (const q of qStems) {
    const weight = q.length;
    let best = 0;
    for (const t of tStems) {
      const sim = tokenSimilarity(q, t);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    weighted += weight * best;
    totalWeight += weight;
  }
  const tokenScore = totalWeight > 0 ? weighted / totalWeight : 0;

  // Whole-string trigram similarity over the stemmed content — a smaller corroborating
  // signal that catches shared substance the token loop misses.
  const trigramScore = trigramSimilarity(qStems.join(" "), tStems.join(" "));

  return TOKEN_WEIGHT * tokenScore + TRIGRAM_WEIGHT * trigramScore;
}
