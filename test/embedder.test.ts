import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isModelLanguage, loadTransformersEmbedder, resolveDupThreshold } from "../src/embeddings/embedder.js";

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

/**
 * The bundled model is English. Fed another script it still returns a vector — it just does
 * not mean anything, and measurement showed what it degenerates into: a score for "is this
 * the same script". Unrelated words outscored true matches (D-065):
 *
 *   0.62  "ποδήλατο" (bicycle) ~ a Greek memory about studying Greek in Athens
 *   0.46  "自転車"   (bicycle) ~ a Chinese memory about coffee and languages
 *   0.27  "コーヒー"  (coffee)  ~ a Chinese memory that is partly about coffee
 *
 * All above the 0.35 recall floor, so a non-English user with the optional package installed
 * had recall dominated by language noise — and it buried the lexical recall that the D-065
 * tokenizer fix had just made work. Non-Latin text is therefore not embedded at all.
 */
describe("isModelLanguage — the bundled model is English-only (D-065)", () => {
  it("accepts English and other Latin-script languages", () => {
    for (const text of [
      "jam drives a Toyota Corolla",
      "jam préfère le café noir et étudie le grec ancien",
      "jam bevorzugt Müller-Kaffee und arbeitet an Übersetzungen",
      "jam prefiere el café solo",
    ]) {
      assert.equal(isModelLanguage(text), true, text);
    }
  });

  it("rejects the scripts the model cannot represent", () => {
    for (const text of [
      "جم هر روز صبح یونانی می‌خواند",
      "ο Γιαμ μαθαίνει αρχαία ελληνικά",
      "Джем изучает Linux и живёт в Афинах",
      "杰姆每天早上喝咖啡",
      "ジャムは毎朝コーヒーを飲む",
      "잼은 매일 아침 커피를 마신다",
      "ג'אם גר באתונה",
    ]) {
      assert.equal(isModelLanguage(text), false, text);
    }
  });

  it("judges by what the text is mostly made of, not by purity", () => {
    // A Latin sentence with a couple of foreign words is still English to the model.
    assert.equal(isModelLanguage("jam is learning the Greek word λόγος this week"), true);
    // A foreign sentence with a Latin brand name in it is not.
    assert.equal(isModelLanguage("ジャムは毎朝コーヒーを飲みながらLinuxを勉強する"), false);
  });

  it("does not choke on text with no letters at all", () => {
    assert.equal(isModelLanguage("12345 !!! ---"), true);
    assert.equal(isModelLanguage(""), true);
  });
});
