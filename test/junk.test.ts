import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isQuestion, isStructureless, isTransient, meaningfulTokens } from "../src/gate/junk.js";

describe("non-fact detection (gate layer 1, D-043)", () => {
  describe("structure", () => {
    it('rejects the bare word "test"', () => {
      // Scorecard failure 2: "test" is 4 characters, so it cleared MIN_TEXT_LENGTH and was
      // SAVED by the 0.7.5 gate. Length was never the right question.
      assert.equal(isStructureless("test"), true);
    });

    it("rejects a single word however long", () => {
      assert.equal(isStructureless("supercalifragilistic"), true);
    });

    it("rejects text made entirely of placeholders", () => {
      assert.equal(isStructureless("test test"), true);
      assert.equal(isStructureless("foo bar"), true);
      assert.equal(isStructureless("asdf asdf asdf"), true);
    });

    it("rejects text made entirely of filler words", () => {
      assert.equal(isStructureless("the and it is"), true);
    });

    it("accepts a two-word claim", () => {
      assert.equal(isStructureless("jam codes"), false);
    });

    it("accepts a placeholder word used inside a real fact", () => {
      // "test" is only junk when it is the WHOLE input.
      assert.equal(isStructureless("jam runs the test suite before every release"), false);
    });

    it("accepts Persian text", () => {
      // An ASCII-only tokenizer would count zero tokens here and reject a memory that the
      // stress test proved saves correctly. Unicode-awareness is not optional.
      assert.equal(isStructureless("جم در آتن زندگی می‌کند"), false);
    });

    it("counts Unicode tokens", () => {
      assert.deepEqual(meaningfulTokens("jam, در آتن!"), ["jam", "در", "آتن"]);
    });
  });

  describe("questions", () => {
    it("rejects a wh-question", () => {
      // Scorecard failure 5: this was SAVED as if it were a fact.
      assert.equal(isQuestion("how much is jam's rent?"), true);
    });

    it("rejects an auxiliary-opening question", () => {
      assert.equal(isQuestion("does jam use Linux?"), true);
    });

    it("rejects a single-sentence question that opens with a noun", () => {
      assert.equal(isQuestion("jam's rent is how much?"), true);
    });

    it("rejects a Persian question", () => {
      assert.equal(isQuestion("اجاره جم چقدر است؟"), true);
    });

    it("accepts a wh-word opening a declarative sentence", () => {
      assert.equal(isQuestion("how jam works is documented in AGENTS.md"), false);
    });

    it("accepts a long fact containing a rhetorical question", () => {
      // The guard that keeps a real memory from being read as a question.
      assert.equal(
        isQuestion(
          "jam's design rule is to ask \"who reads this?\" before writing any documentation. " +
            "He applies it to every README in the repo.",
        ),
        false,
      );
    });

    it("accepts a statement ending in a period", () => {
      assert.equal(isQuestion("jam pays 500 euros rent."), false);
    });
  });

  describe("transience", () => {
    it('flags "right now"', () => {
      // Scorecard failure 4: saved as a durable memory by the 0.7.5 gate.
      assert.equal(isTransient("it's raining in Athens right now"), true);
    });

    it("flags live weather without an explicit time marker", () => {
      assert.equal(isTransient("it's sunny in Athens"), true);
    });

    it('flags "at the moment"', () => {
      assert.equal(isTransient("jam is at the moment away from his desk"), true);
    });

    it("flags a Persian present-moment marker", () => {
      assert.equal(isTransient("الان در آتن باران می‌بارد"), true);
    });

    it("does NOT flag a durable project fact using the word currently", () => {
      // "currently" and "today" are deliberately NOT markers — they open far too many
      // durable facts to be worth the false rejections.
      assert.equal(isTransient("jam is currently building Jamgate"), false);
    });

    it("does NOT flag an ordinary durable fact", () => {
      assert.equal(isTransient("jam lives in Athens, Greece"), false);
    });

    it("does NOT flag a fact that merely mentions climate", () => {
      assert.equal(isTransient("jam prefers dry climates to humid ones"), false);
    });
  });
});
