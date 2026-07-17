import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { deriveSubject } from "../src/gate/subject.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

const NO_LOG = { path: null, maxBytes: 0, maxTextChars: 0 };

describe("auto-subject derivation (D-027)", () => {
  it("maps high-confidence keyword facts to a canonical subject", () => {
    assert.equal(deriveSubject("jam lives in Berlin"), "location");
    assert.equal(deriveSubject("jam moved to Linux"), "operating-system");
    assert.equal(deriveSubject("jam's operating system is Windows"), "operating-system");
    assert.equal(deriveSubject("reach jam at a@b.com"), "email");
    assert.equal(deriveSubject("jam programs in Rust"), "programming-language");
    assert.equal(deriveSubject("jam is working on jamgate"), "current-project");
  });

  it("extracts a noun-phrase subject from a possessive/copula sentence", () => {
    assert.equal(deriveSubject("my favorite color is blue"), "favorite-color");
    assert.equal(deriveSubject("the current project is jamgate"), "current-project");
    assert.equal(deriveSubject("your preferred editor is neovim"), "preferred-editor");
  });

  it("returns a lowercase, hyphenated key", () => {
    const s = deriveSubject("my Favorite Programming Language is TypeScript");
    assert.ok(s && s === s.toLowerCase());
    assert.ok(!s.includes(" "));
  });

  it("leaves the subject unset when nothing matches confidently (conservative)", () => {
    assert.equal(deriveSubject("jam had a great day"), undefined);
    assert.equal(deriveSubject("jam is happy today"), undefined); // mood/state, not a subject
    assert.equal(deriveSubject("that sounds interesting"), undefined);
  });

  it("does not extract an over-long or empty phrase", () => {
    // >3 content tokens before the copula → not confident.
    assert.equal(
      deriveSubject("my long rambling meandering description is pointless"),
      undefined,
    );
  });
});

describe("auto-subject drives supersession end-to-end", () => {
  it("a second location fact retires the first without any subject supplied", async () => {
    const { store, cleanup } = await tempStore();
    const server = createServer(store, NO_LOG);
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);

      await client.callTool({
        name: "save_memory",
        arguments: { text: "jam lives in Berlin", source: "user-explicit" },
      });
      const second = await client.callTool({
        name: "save_memory",
        arguments: { text: "jam now lives in Amsterdam", source: "user-explicit" },
      });

      // Both derived subject "location" → the newer fact supersedes the older by recency.
      const text = (second.content as Array<{ text: string }>)[0].text;
      assert.match(text, /superseded/i);

      // Recall surfaces only the current location.
      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.equal(active[0].text, "jam now lives in Amsterdam");
      assert.equal(active[0].subject, "location");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
    }
  });
});
