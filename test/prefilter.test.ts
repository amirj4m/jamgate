import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { prefilter } from "../src/gate/prefilter.js";

/** Credential fixtures are assembled at runtime, never committed as a literal — a
 *  credential-shaped string in a source file trips GitHub push protection, and a test
 *  fixture is not worth an allowlist entry. See test/secrets.test.ts. */
const FAKE_KEY = "sk-" + "proj-Xk39fJdlWmQp2ZnR8sVtY7bL4cHgAe1N";

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

  // ── 0.8.0 stress-test regressions (D-042, D-043) ──────────────────────────────────────
  // Each of the four below passed the 0.7.5 gate and was stored as a durable memory.

  describe("scorecard regressions", () => {
    it('rejects the bare word "test" (scorecard failure 2)', () => {
      const verdict = prefilter("test");
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason ?? "", /not a statement/);
    });

    it("rejects a credential (scorecard failure 3)", () => {
      const verdict = prefilter(`my api key is ${FAKE_KEY}`);
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason ?? "", /refusing to store credentials/);
    });

    it("marks a rejected credential for redaction so the gate log never holds it", () => {
      // Refusing to STORE a secret while LOGGING it verbatim would be theatre (D-042).
      const verdict = prefilter("password: Tr0ub4dor&3xK");
      assert.equal(verdict.ok, false);
      assert.equal(verdict.redact, true);
    });

    it("does not set the redaction flag on an ordinary rejection", () => {
      assert.equal(prefilter("test").redact, undefined);
    });

    it("rejects transient info (scorecard failure 4)", () => {
      const verdict = prefilter("it's raining in Athens right now");
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason ?? "", /transient, not durable/);
    });

    it("rejects a question (scorecard failure 5)", () => {
      const verdict = prefilter("how much is jam's rent?");
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason ?? "", /question, not a fact/);
    });
  });

  describe("transient input with an explicit type", () => {
    it("accepts a transient observation when the caller typed it as state", () => {
      // Transient facts are real, just short-lived — that is what the state layer and its
      // TTL are for (RULES §4). The gate refuses only to file one as a PERMANENT fact.
      assert.equal(prefilter("it's raining in Athens right now", { type: "state" }).ok, true);
    });

    it("still rejects a transient observation when no type is given", () => {
      assert.equal(prefilter("it's raining in Athens right now", {}).ok, false);
    });

    it("does not let a type launder a credential", () => {
      // Ordering matters: the secret rule runs before the transient rule, so a `type` can
      // never be used to smuggle a key past the gate.
      const verdict = prefilter(`right now the key is ${FAKE_KEY}`, {
        type: "state",
      });
      assert.equal(verdict.ok, false);
      assert.equal(verdict.redact, true);
    });
  });

  describe("precision — real memories must still pass the whole layer", () => {
    const REAL_MEMORIES = [
      "jam prefers dark theme in every editor he uses",
      "jam lives in Athens, Greece and is an asylum seeker",
      "jam fixed the supersession bug in commit aee2a73f8c91b04e5d2a6f3c8b7e1d9a0c4f6b28",
      "jam's password manager is 1Password on all his devices",
      "jam is currently building Jamgate, a memory quality gate for MCP agents",
      "jam prefers dry climates to humid ones",
      "جم در آتن زندگی می‌کند و به دنبال پناهندگی است",
      "jam's asylum case number is 645673 at the Regional Asylum Office of Piraeus",
      "jam's design rule is to ask \"who reads this?\" before writing docs. He applies it everywhere.",
    ];

    for (const text of REAL_MEMORIES) {
      it(`accepts: ${text.slice(0, 56)}…`, () => {
        const verdict = prefilter(text);
        assert.equal(verdict.ok, true, `wrongly rejected: ${verdict.reason}`);
      });
    }

    it("accepts a long multi-paragraph memory", () => {
      const long =
        "jam builds and maintains Jamgate, an open-source memory quality-gate MCP server. " +
        "It is written in TypeScript on Node 20+, uses the official MCP SDK, and ships a " +
        "file-backed default store with atomic writes, a lock file and schema migration. ".repeat(
          6,
        );
      assert.equal(prefilter(long).ok, true);
    });
  });
});
