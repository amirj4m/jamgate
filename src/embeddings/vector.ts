// Pure vector math for the optional embedding layer (Phase 3, item 4).
//
// This module is deliberately dependency-free and has NO knowledge of any ML runtime — it
// is just the arithmetic that the semantic layer needs: cosine similarity, blending a
// semantic score with the fuzzy lexical score, and the near-duplicate threshold. Keeping it
// pure means it is fully unit-testable in CI with hand-built vectors, no model download.

/**
 * Default similarity at/above which two texts are treated as semantic near-duplicates.
 *
 * This constant used to claim that paraphrases sit at 0.85–0.95 while genuinely different
 * facts "sit well below". That was an assumption, and measuring it against the real model
 * (all-MiniLM-L6-v2, the pairs from the 0.8.0 stress test) showed it is false — the two
 * populations OVERLAP:
 *
 *   0.94  reworded duplicate  "jam builds Jamgate, an open-source memory quality-gate MCP
 *                              server" / "Jamgate is an open-source MCP server built by jam
 *                              that acts as a memory quality gate"
 *   0.87  same subject, NEW value   "uses Windows" / "moved to Linux"
 *   0.83  reworded duplicate  "prefers dark theme in all his editors" / "likes a dark colour
 *                              scheme in every editor"
 *   0.81  DIFFERENT facts     "jam uses Windows" / "jam uses Linux"
 *   0.76  reworded duplicate  "lives in Athens, Greece" / "home is in Athens, the capital"
 *   0.67  same subject, NEW value   ThinkBook savings "5/10, €640" / "7/10 — €768"
 *
 * Two consequences, and they are the reason this number did not simply get lowered:
 *
 *  1. No single cosine threshold separates "restated" from "changed". Dropping to 0.80 to
 *     catch the 0.83 reword would also flag "jam uses Linux" as a duplicate of "jam uses
 *     Windows" (0.81) — the exact supersession case RULES §2.3 forbids calling a duplicate.
 *  2. Recency-vs-restatement is a SUBJECT question, not a similarity question. That is why
 *     supersession runs on `subject` first and the near-duplicate check only sees candidates
 *     that superseded nothing (D-044).
 *
 * So 0.88 stays: it sits above the "different facts" ceiling we measured (0.81) with room to
 * spare, which makes a false positive — refusing a real fact as a duplicate — unlikely. The
 * cost is the acknowledged false negatives at 0.76–0.83; those are noise the user can delete,
 * and the honest fix for them is the subject layer and the classifier, not a lower number.
 * Overridable via env (see embedder) for anyone who prefers the other trade.
 */
export const DEFAULT_DUP_THRESHOLD = 0.88;

/**
 * Blend weights for combining the lexical (fuzzy) score with the semantic score during
 * recall. Both operands are expected in [0, 1].
 *
 * Semantic used to lead at 0.6/0.4, on the assumption that synonym reach is what recall was
 * missing. Measured against the real model over a real store (17 recall queries, jam's own
 * 12 memories plus the short facts from the gate log, D-063), that assumption is false — a
 * semantic-led blend RANKS WORSE than no embeddings at all:
 *
 *   semantic 0.6 / lexical 0.4   top-1  6/17   top-5 14/17   ← what shipped
 *   semantic 0.5 / lexical 0.5   top-1  7/17   top-5 13/17
 *   semantic 0.4 / lexical 0.6   top-1  9/17   top-5 13/17
 *   semantic 0.3 / lexical 0.7   top-1 10/17   top-5 13/17   ← now
 *   semantic 0.2 / lexical 0.8   top-1 10/17   top-5 13/17
 *   embeddings off (pure fuzzy)  top-1  8/17   top-5 11/17
 *
 * The cause is that MiniLM is mean-pooled: a three-word query against a real 500-character
 * memory dilutes to a middling cosine, while two SHORT unrelated facts that merely share a
 * surface shape score high — "where does jam live" scored 0.645 against "jam started
 * jamgate" but only 0.414 against "Lives in Berlin". Weighting that signal at 0.6 let it
 * outvote a lexical scorer that had the right answer.
 *
 * So lexical leads and semantic assists: 0.3/0.7 beats pure fuzzy on BOTH metrics (the only
 * setting that does) and beats the old blend by four top-1 answers. 0.2 ties it on this
 * corpus; 0.3 is the point where top-1 saturates, so it keeps the most synonym reach for the
 * same measured ranking.
 */
const SEMANTIC_WEIGHT = 0.3;
const LEXICAL_WEIGHT = 0.7;

/**
 * Minimum semantic similarity for an embedding match to pull an otherwise lexically
 * irrelevant memory into recall. This is the ONLY thing that earns synonym reach: a query
 * with no shared words reaches a memory through this floor or not at all.
 *
 * It was 0.5 on an estimate ("true synonyms land ~0.6–0.8"). Measured on the real model
 * that is too high, and the README's own advertised example was one of the casualties
 * (D-063). Pure-synonym pairs — no shared word, so lexical scores 0.000 and the floor is
 * the only way in:
 *
 *   0.742  "what vehicle does jam own"        ~ "jam drives a Toyota Corolla"
 *   0.695  "what distro is on jam's laptop"   ~ "jam uses Linux"
 *   0.642  "does jam owe anyone money"        ~ (the debts-settled memory)
 *   0.507  "attorney fees"                    ~ (the lawyer-cost memory)
 *   0.422  "automobile"                       ~ "jam drives a Toyota Corolla"  ← the README's
 *   0.464  "policy on third-party libraries"  ~ "…strict no-dependencies policy…"
 *
 * Against 102 measured unrelated pairs (six deliberately off-topic queries — weather, pizza,
 * the capital of France, sourdough, a dentist appointment, a car nobody owns — over the whole
 * real store) the highest similarity of ANY unrelated pair was 0.204, and in a store of short
 * facts the runners-up behind a true synonym match sat at 0.18 and below.
 *
 * 0.35 therefore sits in real empty space: above every unrelated pair we could produce
 * (0.204) and below every pure-synonym pair that matters (0.422). Unlike the near-duplicate
 * bar (D-045), these two populations genuinely do separate here — a query is a different kind
 * of object from a memory, and "unrelated to the question" is a cleaner call than "restated
 * versus changed". The band 0.25–0.40 is where weak-but-real associations live; setting the
 * floor at the bottom of the true-positive cluster rather than the top of the noise cluster
 * is the deliberate trade, because the cost of a stray recall result is one extra line the
 * agent can ignore, while the cost of a miss is the feature silently not existing.
 */
export const DEFAULT_SEMANTIC_MIN = 0.35;

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a zero vector
 * or a length mismatch (defensive: a corrupt/older embedding must not throw during recall).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Blend a lexical (fuzzy) relevance score with a semantic similarity into one recall score.
 * Clamps the semantic input to [0, 1] first (cosine can be slightly negative for unrelated
 * text) so the blend stays in [0, 1] and comparable to the pure-fuzzy path.
 */
export function blendRelevance(lexical: number, semantic: number): number {
  const sem = Math.max(0, Math.min(1, semantic));
  const lex = Math.max(0, Math.min(1, lexical));
  return LEXICAL_WEIGHT * lex + SEMANTIC_WEIGHT * sem;
}

/**
 * Floor of the "related, but not a duplicate" band (D-045). Between this and
 * DEFAULT_DUP_THRESHOLD a memory is stored, and the existing look-alike is REPORTED to the
 * agent so it can re-save with a shared `subject` if the two are really one tracked value.
 *
 * 0.60 is set from the same measurements as the duplicate threshold: the ThinkBook
 * savings-progress pair sits at 0.67 and "prefers TypeScript" / "prefers Python" at 0.65 —
 * both genuinely worth a "did you mean to update?" — while unrelated facts sit at 0.34 and
 * below, comfortably outside. A hint costs a line of output; it never changes what is
 * stored, so the bar for it is legitimately lower than for a refusal.
 */
export const DEFAULT_RELATED_MIN = 0.6;

/** Is `similarity` at/above the near-duplicate threshold? */
export function isNearDuplicate(similarity: number, threshold = DEFAULT_DUP_THRESHOLD): boolean {
  return similarity >= threshold;
}
