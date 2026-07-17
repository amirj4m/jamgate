import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DEFAULT_DUP_THRESHOLD,
  DEFAULT_SEMANTIC_MIN,
  blendRelevance,
  cosineSimilarity,
  isNearDuplicate,
} from "../src/embeddings/vector.js";

// Pure, deterministic math — always runs in CI (no model, no network).
describe("cosine similarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it("is scale-invariant", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 1], [2, 2]) - 1) < 1e-12);
  });

  it("is -1 for opposite vectors", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-12);
  });

  it("defends against zero vectors and length mismatch (never throws)", () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
    assert.equal(cosineSimilarity([], []), 0);
  });
});

describe("blendRelevance", () => {
  it("weights semantic above lexical and stays in [0, 1]", () => {
    // Defaults: 0.4*lex + 0.6*sem.
    assert.ok(Math.abs(blendRelevance(1, 1) - 1) < 1e-12);
    assert.ok(Math.abs(blendRelevance(0, 0) - 0) < 1e-12);
    assert.ok(Math.abs(blendRelevance(1, 0) - 0.4) < 1e-12);
    assert.ok(Math.abs(blendRelevance(0, 1) - 0.6) < 1e-12);
  });

  it("clamps out-of-range inputs (negative cosine, >1 lexical)", () => {
    assert.equal(blendRelevance(-5, -5), 0);
    assert.equal(blendRelevance(5, 5), 1);
  });

  it("lets a strong semantic match rescue a lexically weak one", () => {
    // Synonym hit: no lexical overlap, high semantic similarity → clearly relevant.
    assert.ok(blendRelevance(0, 0.8) > DEFAULT_SEMANTIC_MIN * 0.6);
    assert.ok(blendRelevance(0, 0.8) > blendRelevance(0.2, 0));
  });
});

describe("isNearDuplicate threshold", () => {
  it("fires at or above the threshold, not below", () => {
    assert.equal(isNearDuplicate(DEFAULT_DUP_THRESHOLD), true);
    assert.equal(isNearDuplicate(DEFAULT_DUP_THRESHOLD + 0.01), true);
    assert.equal(isNearDuplicate(DEFAULT_DUP_THRESHOLD - 0.01), false);
  });

  it("honors a custom threshold", () => {
    assert.equal(isNearDuplicate(0.7, 0.6), true);
    assert.equal(isNearDuplicate(0.5, 0.6), false);
  });

  it("keeps the default duplicate threshold above the semantic-recall floor", () => {
    // A near-duplicate must be a much stronger signal than mere semantic relevance.
    assert.ok(DEFAULT_DUP_THRESHOLD > DEFAULT_SEMANTIC_MIN);
  });
});
