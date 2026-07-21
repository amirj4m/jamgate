import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { prefilter } from "../src/gate/prefilter.js";

describe("prefilter (gate layer 1)", () => {
  it("rejects text shorter than the minimum length", () => {
    const verdict = prefilter("hm");
    assert.equal(verdict.ok, false);
    // The reason states the ACTUAL length: a bare "too short" was reported to a user for a
    // memory they believed was 1700 characters, and gave them no way to see it never
    // arrived (D-037).
    assert.equal(verdict.reason, "too short (2 characters, minimum 4)");
  });

  it("rejects whitespace-only text as too short", () => {
    assert.equal(prefilter("      ").ok, false);
  });

  it("rejects a bare pleasantry", () => {
    const verdict = prefilter("thanks");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "pleasantry / no durable content");
  });

  it("rejects pleasantries regardless of case and surrounding whitespace", () => {
    assert.equal(prefilter("  Hello  ").ok, false);
    assert.equal(prefilter("OKAY").ok, false);
  });

  it("accepts a durable fact", () => {
    const verdict = prefilter("jam uses Linux as a daily driver");
    assert.equal(verdict.ok, true);
    assert.equal(verdict.reason, undefined);
  });

  it("accepts a sentence that merely starts with a pleasantry word", () => {
    // Only the whole text being a pleasantry is junk; "thanks" as a prefix is not.
    assert.equal(prefilter("thanks — note that I moved to Berlin").ok, true);
  });
});
