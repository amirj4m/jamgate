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

// The three saves from the production stress test that superseded each other in a chain
// (gate.log, 21 Jul 2026 15:35–15:36Z): completely different topics, no `subject` supplied,
// all three derived "location" off an incidental "lives in …" (D-040).
const PING_PONG = [
  "[finance] jam's accounting system lives in ~/Documents/accountant on his laptop " +
    "(Markdown files: RULES, MEMORY, DECISIONS, INCOME, EXPENSES, SAVINGS, ANALYSIS, TAX, " +
    "ACTIONS — Persian, no spreadsheets). Core income model: real income = what he actually " +
    "receives (cash in hand + card deposits), already net of the intermediary's ~30% " +
    "commission, personal AMA insurance, and the efood wallet (pass-through, net-zero).",
  "[profile+career] jam lives in Athens, Greece as an asylum seeker holding only a red card. " +
    "The red card blocks practical things: he could not open a Google Play developer account " +
    "to publish jamlex and cannot get a driver's license; as an asylum seeker he legally " +
    "cannot be self-employed in Greece — only salaried work. He works as an efood delivery " +
    "courier via an intermediary company, and is studying toward a DevOps career.",
  "[finance-model] jam's bookkeeping lives in ~/Documents/accountant (Persian Markdown: " +
    "RULES, MEMORY, DECISIONS, INCOME, EXPENSES, SAVINGS, ANALYSIS, TAX, ACTIONS). " +
    "Accounting rules: real income = cash in hand + card deposits, already net of the ~30% " +
    "intermediary commission (moped rental & insurance are inside that 30%), of personal AMA " +
    "insurance, and of the wallet. Insurance amounts are recorded but never deducted twice.",
];

describe("auto-subject is conservative on long, multi-topic text (D-040)", () => {
  it("declines to guess a subject for each of the three ping-pong memories", () => {
    for (const text of PING_PONG) {
      assert.equal(deriveSubject(text), undefined, `should not guess for: ${text.slice(0, 60)}…`);
    }
  });

  it("declines above the length threshold even when a rule would match", () => {
    const padded = "jam lives in Berlin. " + "Unrelated background detail. ".repeat(20);
    assert.ok(padded.length > 300);
    assert.equal(deriveSubject(padded), undefined);
    assert.equal(deriveSubject("jam lives in Berlin"), "location", "short form still works");
  });

  it("declines when two different keyword rules both match (ambiguous topic)", () => {
    // "lives" → location AND "@" → email: two topics, so first-match-wins would be arbitrary.
    assert.equal(deriveSubject("jam lives in Berlin and his email is jam@example.com"), undefined);
  });
});

describe("supersession never fires without a subject", () => {
  it("keeps all three different-topic subjectless memories active (the ping-pong)", async () => {
    const { store, cleanup } = await tempStore();
    const server = createServer(store, NO_LOG);
    const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);

      for (const text of PING_PONG) {
        const res = await client.callTool({
          name: "save_memory",
          arguments: { text, source: "agent-inferred" },
        });
        const out = (res.content as Array<{ text: string }>)[0].text;
        assert.doesNotMatch(out, /superseded/i, `must not supersede: ${text.slice(0, 50)}…`);
      }

      const active = await store.recall("", 10);
      assert.equal(active.length, 3, "all three unrelated memories stay active");
      for (const m of active) assert.equal(m.subject, undefined, "no subject was invented");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
    }
  });

  it("a subjectless save never retires an existing subjectless memory", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "first unrelated fact about taxes", source: "user-explicit" });
      const second = await store.save({
        text: "second unrelated fact about bicycles",
        source: "user-explicit",
      });
      assert.equal(second.action, "created");
      assert.equal(second.retired, undefined);
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
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
