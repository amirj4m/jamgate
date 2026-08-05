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
  it("weights lexical above semantic and stays in [0, 1]", () => {
    // Defaults: 0.7*lex + 0.3*sem (D-063 — a semantic-led blend ranked worse than no
    // embeddings at all on the real corpus).
    assert.ok(Math.abs(blendRelevance(1, 1) - 1) < 1e-12);
    assert.ok(Math.abs(blendRelevance(0, 0) - 0) < 1e-12);
    assert.ok(Math.abs(blendRelevance(1, 0) - 0.7) < 1e-12);
    assert.ok(Math.abs(blendRelevance(0, 1) - 0.3) < 1e-12);
  });

  it("clamps out-of-range inputs (negative cosine, >1 lexical)", () => {
    assert.equal(blendRelevance(-5, -5), 0);
    assert.equal(blendRelevance(5, 5), 1);
  });

  it("lets a strong semantic match rescue a lexically absent one", () => {
    // A pure synonym hit still outranks a barely-lexical one — semantic assists, it just
    // no longer leads. ("automobile" ~ "…Toyota Corolla" measured 0.422, lexical 0.000.)
    assert.ok(blendRelevance(0, 0.42) > 0);
    assert.ok(blendRelevance(0, 0.8) > blendRelevance(0.2, 0));
  });

  it("does not let embedding noise outrank a solid lexical match (D-063)", () => {
    // The measured failure of the old 0.6/0.4 blend: "where does jam live" scored 0.645
    // against the unrelated "jam started jamgate" but only 0.414 against "Lives in Berlin".
    // With lexical leading, the memory the lexical scorer actually recognized wins.
    const rightAnswer = blendRelevance(0.33, 0.41); // "Lives in Berlin"
    const surfaceNoise = blendRelevance(0.1, 0.65); // "jam started jamgate"
    assert.ok(rightAnswer > surfaceNoise);
    // Under the old weights it went the other way — this is the regression being locked in.
    assert.ok(0.4 * 0.33 + 0.6 * 0.41 < 0.4 * 0.1 + 0.6 * 0.65);
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

describe("semantic recall floor (measured, D-063)", () => {
  // These are real cosines from all-MiniLM-L6-v2 over jam's own store, not estimates.
  // The floor is the only route into recall for a query that shares no word with the memory,
  // so it has to sit between these two populations.
  const PURE_SYNONYM_HITS = [
    ["what vehicle does jam own ~ jam drives a Toyota Corolla", 0.742],
    ["what distro is on jam's laptop ~ jam uses Linux", 0.695],
    ["does jam owe anyone money ~ (debts settled)", 0.642],
    ["attorney fees ~ (lawyer cost)", 0.507],
    ["policy on third-party libraries ~ (no-dependencies policy)", 0.464],
    ["automobile ~ jam drives a Toyota Corolla (the README's example)", 0.422],
  ] as const;

  // Highest similarity reached by ANY of 102 deliberately unrelated query/memory pairs.
  const WORST_UNRELATED = 0.204;

  it("admits every measured pure-synonym pair, including the README's own example", () => {
    for (const [pair, score] of PURE_SYNONYM_HITS) {
      assert.ok(score >= DEFAULT_SEMANTIC_MIN, `${pair} (${score}) must clear the floor`);
    }
  });

  it("stays above the noisiest unrelated pair we could measure", () => {
    assert.ok(DEFAULT_SEMANTIC_MIN > WORST_UNRELATED);
  });

  it("would have failed at the old 0.5 floor — which is why the README lied", () => {
    assert.ok(0.422 < 0.5);
  });
});
