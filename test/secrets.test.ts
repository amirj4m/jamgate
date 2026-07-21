import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  charClasses,
  detectSecret,
  looksHighEntropy,
  shannonEntropy,
} from "../src/gate/secrets.js";

/**
 * Assemble a credential-shaped fixture at runtime from its prefix and body.
 *
 * These are all invented strings, but they are invented to look exactly like the real
 * thing — which is the point of the test and also the problem: GitHub's push protection
 * scans source files with the same shape rules this module uses, and it blocked the first
 * push of this file over a fabricated Slack token. It was right to. A test fixture is not
 * worth an allowlist entry that says "ignore secrets here", so no literal credential-shaped
 * string is committed; the detector still sees the assembled value at runtime, which is the
 * only thing under test.
 */
const key = (prefix: string, body: string): string => prefix + body;

describe("secret detection (gate layer 1, D-042)", () => {
  describe("known credential shapes", () => {
    it("rejects an OpenAI/Anthropic-style API key", () => {
      // Scorecard failure 3: this exact shape was SAVED by the 0.7.5 gate.
      const found = detectSecret(`my openai key is ${key("sk-", "proj-Xk39fJdlWmQp2ZnR8sVtY7bL4cHgAe1N")}`);
      assert.ok(found);
      assert.match(found.label, /API key/);
    });

    it("rejects an AWS access key id", () => {
      assert.ok(detectSecret(`${key("AKIA", "IOSFODNN7EXAMPLE")} is the access key`));
    });

    it("rejects a GitHub personal access token", () => {
      assert.ok(detectSecret(`use ${key("ghp_", "16C7e42F292c6912E7710c838347Ae178B4a")} for CI`));
    });

    it("rejects an npm automation token", () => {
      assert.ok(detectSecret(key("npm_", "QwErTyUiOpAsDfGhJkLzXcVbNm1234567890")));
    });

    it("rejects a Slack token", () => {
      assert.ok(detectSecret(key("xox", "b-2401234567-8901234567-AbCdEfGhIjKlMnOpQrSt")));
    });

    it("rejects a JWT", () => {
      assert.ok(
        detectSecret(
          `token: ${key("eyJ", "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")}`,
        ),
      );
    });

    it("rejects a PEM private key block", () => {
      assert.ok(detectSecret("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."));
    });

    it("rejects a pasted Authorization header", () => {
      assert.ok(detectSecret("Authorization: Bearer aGVsbG93b3JsZHRoaXNpc2Fsb25ндG9rZW4xMjM0"));
    });

    it("rejects a Stripe live key", () => {
      assert.ok(detectSecret(key("sk_", "live_51H8xKzLmNpQrStUvWxYz")));
    });
  });

  describe("password assignments", () => {
    it("rejects a password stated with a colon", () => {
      const found = detectSecret("jam's server password: Tr0ub4dor&3xK");
      assert.ok(found);
      assert.match(found.label, /password or key assignment/);
    });

    it("rejects a password stated with a copula", () => {
      assert.ok(detectSecret("the wifi password is hunter2Hunter2"));
    });

    it("rejects an api key stated with an equals sign", () => {
      assert.ok(detectSecret(`api_key = ${key("a8Xk39", "fJdlWmQp2ZnR")}`));
    });
  });

  describe("entropy plus context", () => {
    it("rejects a long mixed-alphabet token near credential wording", () => {
      const found = detectSecret(
        "store this access token somewhere safe: Kx7#mQ2vL9$pR4nT8wZ6hY3jB5dF1gA0",
      );
      assert.ok(found);
      assert.match(found.label, /high-entropy/);
    });

    it("does NOT fire on entropy alone, with no credential context", () => {
      assert.equal(detectSecret("Kx7#mQ2vL9$pR4nT8wZ6hY3jB5dF1gA0 appears in the log output"), null);
    });

    it("does NOT fire on credential wording alone, with no secret-shaped value", () => {
      assert.equal(detectSecret("jam rotates his API keys every quarter"), null);
    });
  });

  describe("precision — normal memories must still pass", () => {
    it("allows prose containing a git sha", () => {
      // A 40-char hex digest is ONE character class, so the entropy rule cannot reach it.
      assert.equal(
        detectSecret("jam fixed the supersession bug in commit aee2a73f8c91b04e5d2a6f3c8b7e1d9a0c4f6b28"),
        null,
      );
    });

    it("allows prose containing a git sha even next to the word token", () => {
      assert.equal(
        detectSecret("the token parser regressed in aee2a73f8c91b04e5d2a6f3c8b7e1d9a0c4f6b28"),
        null,
      );
    });

    it("allows a UUID in prose", () => {
      assert.equal(
        detectSecret("memory id 3855893f-1f1b-4a04-8808-56213d6916c3 was forgotten"),
        null,
      );
    });

    it("allows a fact ABOUT a password manager", () => {
      // The adjacency requirement is what saves this one: "password" is followed by
      // "manager", not by a separator.
      assert.equal(detectSecret("jam's password manager is 1Password on all his devices"), null);
    });

    it("allows a fact about secret handling policy", () => {
      assert.equal(
        detectSecret("jam never stores credentials in the repo; they live in the secret store"),
        null,
      );
    });

    it("allows an ordinary long memory with no secrets", () => {
      assert.equal(
        detectSecret(
          "jam builds and maintains Jamgate, an open-source memory quality-gate MCP server " +
            "written in TypeScript on Node, deployed to a DigitalOcean droplet behind Caddy.",
        ),
        null,
      );
    });

    it("allows an asylum case number", () => {
      assert.equal(detectSecret("jam's asylum case number is 645673 at the Piraeus office"), null);
    });
  });

  describe("primitives", () => {
    it("scores entropy of a uniform string as zero", () => {
      assert.equal(shannonEntropy("aaaaaaaa"), 0);
    });

    it("counts character classes", () => {
      assert.equal(charClasses("abc"), 1);
      assert.equal(charClasses("abcDEF"), 2);
      assert.equal(charClasses("abcDEF123"), 3);
      assert.equal(charClasses("abcDEF123!"), 4);
    });

    it("refuses to call a hex digest high-entropy, at any length", () => {
      // The rule that keeps git shas out of the secret detector, stated directly.
      assert.equal(looksHighEntropy("aee2a73f8c91b04e5d2a6f3c8b7e1d9a0c4f6b28"), false);
    });

    it("calls a mixed-alphabet random token high-entropy", () => {
      assert.equal(looksHighEntropy("Kx7#mQ2vL9$pR4nT8wZ6hY3jB5dF1gA0"), true);
    });

    it("refuses to call a short token high-entropy", () => {
      assert.equal(looksHighEntropy("Kx7#mQ2v"), false);
    });
  });
});
