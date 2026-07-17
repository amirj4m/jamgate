// Pure vector math for the optional embedding layer (Phase 3, item 4).
//
// This module is deliberately dependency-free and has NO knowledge of any ML runtime — it
// is just the arithmetic that the semantic layer needs: cosine similarity, blending a
// semantic score with the fuzzy lexical score, and the near-duplicate threshold. Keeping it
// pure means it is fully unit-testable in CI with hand-built vectors, no model download.

/** Default similarity at/above which two texts are treated as semantic near-duplicates.
 *  Tuned for all-MiniLM-L6-v2 normalized embeddings: paraphrases of the same statement
 *  sit high (~0.85–0.95) while genuinely different facts (even similar phrasing like
 *  "uses Windows" vs "uses Linux") sit well below. Overridable via env (see embedder). */
export const DEFAULT_DUP_THRESHOLD = 0.88;

/** Blend weights for combining the lexical (fuzzy) score with the semantic score during
 *  recall. Semantic leads because it is what adds synonym reach; fuzzy anchors on exact
 *  surface matches the embedding can under-weight. Both operands are expected in [0, 1]. */
const SEMANTIC_WEIGHT = 0.6;
const LEXICAL_WEIGHT = 0.4;

/** Minimum semantic similarity for an embedding match to pull an otherwise lexically
 *  irrelevant memory into recall. High enough to admit true synonyms (~0.6–0.8 on MiniLM)
 *  while excluding the moderate baseline similarity (~0.2–0.4) unrelated short texts show —
 *  without this floor, semantic noise would flood recall. */
export const DEFAULT_SEMANTIC_MIN = 0.5;

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

/** Is `similarity` at/above the near-duplicate threshold? */
export function isNearDuplicate(similarity: number, threshold = DEFAULT_DUP_THRESHOLD): boolean {
  return similarity >= threshold;
}
