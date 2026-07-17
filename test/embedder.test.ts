import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadTransformersEmbedder, resolveDupThreshold } from "../src/embeddings/embedder.js";

describe("embedder loader graceful degradation (D-026)", () => {
  it("returns null when embeddings are switched off", async () => {
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "off" }), null);
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "0" }), null);
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "false" }), null);
  });

  it("returns null (never throws) when the optional package is absent", async () => {
    // @huggingface/transformers is an OPTIONAL peer dep and is not installed in CI, so the
    // dynamic import fails — the loader must degrade to null rather than crash the server.
    const embedder = await loadTransformersEmbedder({});
    assert.equal(embedder, null);
  });
});

describe("resolveDupThreshold", () => {
  it("returns undefined when unset or out of range, so the caller uses its default", () => {
    assert.equal(resolveDupThreshold({}), undefined);
    assert.equal(resolveDupThreshold({ JAMGATE_DUP_THRESHOLD: "0" }), undefined);
    assert.equal(resolveDupThreshold({ JAMGATE_DUP_THRESHOLD: "1.5" }), undefined);
    assert.equal(resolveDupThreshold({ JAMGATE_DUP_THRESHOLD: "abc" }), undefined);
  });

  it("accepts a valid override in (0, 1]", () => {
    assert.equal(resolveDupThreshold({ JAMGATE_DUP_THRESHOLD: "0.8" }), 0.8);
    assert.equal(resolveDupThreshold({ JAMGATE_DUP_THRESHOLD: "1" }), 1);
  });
});
