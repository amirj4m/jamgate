import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadTransformersEmbedder, resolveDupThreshold } from "../src/embeddings/embedder.js";

describe("embedder loader graceful degradation (D-026)", () => {
  it("returns null when embeddings are switched off", async () => {
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "off" }), null);
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "0" }), null);
    assert.equal(await loadTransformersEmbedder({ JAMGATE_EMBEDDINGS: "false" }), null);
  });

  it("never throws, whether or not the optional package is installed", async () => {
    // @huggingface/transformers is an OPTIONAL peer dep. This assertion used to be a flat
    // `equal(embedder, null)` on the reasoning that the package is absent in CI — but the
    // test never ESTABLISHED that absence, it assumed it. On a machine where the peer IS
    // installed (the supported configuration for semantic recall) the loader correctly
    // returned a real embedder and the suite failed, reading as a loader regression when
    // nothing had regressed. So assert the contract that actually holds in BOTH
    // environments: the call resolves rather than throwing, and yields either null (degrade
    // to fuzzy recall) or a well-formed Embedder — never anything in between.
    const embedder = await loadTransformersEmbedder({});
    if (embedder === null) return; // package absent → degraded, which is the CI path
    assert.equal(typeof embedder.embed, "function");
    assert.equal(typeof embedder.id, "string");
    assert.equal(embedder.dimensions, 384);
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
