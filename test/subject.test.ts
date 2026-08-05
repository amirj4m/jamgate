import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { promises as fs } from "node:fs";
import { deriveSubject, normalizeSubject } from "../src/gate/subject.js";
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

describe("subject keys are canonical: lowercase and hyphenated (D-052)", () => {
  it("folds dots, underscores and spaces to the hyphenated convention", () => {
    assert.equal(normalizeSubject("editor.theme"), "editor-theme");
    assert.equal(normalizeSubject("editor_theme"), "editor-theme");
    assert.equal(normalizeSubject("Editor Theme"), "editor-theme");
    assert.equal(normalizeSubject("  OPERATING SYSTEM  "), "operating-system");
    assert.equal(normalizeSubject("project..jamgate__status"), "project-jamgate-status");
  });

  it("leaves an already-canonical key untouched", () => {
    // Every subject already on disk is hyphenated, so normalization must be a no-op on them.
    for (const s of ["location", "operating-system", "current-project", "greek-level"]) {
      assert.equal(normalizeSubject(s), s);
    }
  });

  it("treats an absent, empty or separator-only subject as no subject", () => {
    assert.equal(normalizeSubject(undefined), undefined);
    assert.equal(normalizeSubject(null), undefined);
    assert.equal(normalizeSubject("   "), undefined);
    assert.equal(normalizeSubject("-._"), undefined);
  });

  it("does NOT collapse a more specific key into a broader one", () => {
    // `location.city` and `location` are different subjects under any convention. Guessing
    // that one subsumes the other is the wrong-supersession risk this module refuses to take.
    assert.notEqual(normalizeSubject("location.city"), normalizeSubject("location"));
  });

  it("supersedes across separator spellings of the same subject", async () => {
    // The bug this closes: the memory-discipline skill told agents to use DOTTED subjects
    // while the gate derived hyphenated ones, so an agent-supplied `editor.theme` sat beside
    // a gate-derived `editor-theme` as two live, contradicting facts (RULES §10).
    const { store, cleanup } = await tempStore();
    try {
      const first = await store.save({
        text: "jam prefers a light editor theme",
        subject: "editor.theme",
        source: "user-explicit",
      });
      assert.equal(first.action, "created");
      assert.equal(first.memory.subject, "editor-theme", "stored in canonical form");

      const second = await store.save({
        text: "jam switched to a dark editor theme",
        subject: "editor_theme",
        source: "user-explicit",
      });
      assert.equal(second.action, "superseded");
      assert.equal(second.retired?.length, 1);

      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.match(active[0].text, /dark/);
    } finally {
      await cleanup();
    }
  });

  it("supersedes a LEGACY record whose stored subject used the old separator", async () => {
    // Records written before the fold keep their original spelling on disk. Comparing
    // canonical-to-canonical on read is what lets a new save retire them without a migration.
    const { store, path, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Athens", subject: "location", source: "user-explicit" });
      // Rewrite that record's subject to the old dotted spelling, as an older client would have.
      const raw = JSON.parse(await fs.readFile(path, "utf8"));
      raw.memories[0].subject = "location.city";
      await fs.writeFile(path, JSON.stringify(raw), "utf8");

      const next = await store.save({
        text: "jam lives in Rotterdam",
        subject: "location-city",
        source: "user-explicit",
      });
      assert.equal(next.action, "superseded");
      assert.match(next.retired?.[0].text ?? "", /Athens/);

      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.match(active[0].text, /Rotterdam/);
    } finally {
      await cleanup();
    }
  });
});
