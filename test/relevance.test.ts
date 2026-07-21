import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MIN_RELEVANCE,
  TYPE_BOOST,
  contentStems,
  memoryRelevance,
  relevanceScore,
  stem,
  tokenize,
  trigramSimilarity,
} from "../src/gate/relevance.js";

/** The MVP's original scorer, kept here only as the baseline the fuzzy scorer must beat:
 *  a query word counts if it appears as a substring of the text. */
function plainOverlap(query: string, text: string): number {
  const t = text.toLowerCase();
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  if (qWords.size === 0) return 0;
  let hits = 0;
  for (const w of qWords) if (t.includes(w)) hits++;
  return hits / qWords.size;
}

describe("relevance primitives", () => {
  it("tokenizes on punctuation and case", () => {
    assert.deepEqual(tokenize("Linux, macOS & Windows!"), ["linux", "macos", "windows"]);
  });

  it("stems common inflections to a shared root", () => {
    assert.equal(stem("projects"), stem("project"));
    assert.equal(stem("projecting"), stem("project"));
    assert.equal(stem("memories"), "memory");
    // Conservative: short tokens are left intact rather than mangled.
    assert.equal(stem("os"), "os");
    assert.equal(stem("is"), "is");
  });

  it("drops stopwords but never empties a real query", () => {
    assert.deepEqual(contentStems("what is the operating system"), ["operat", "system"]);
    // All-stopword input falls back to the tokens themselves.
    assert.ok(contentStems("what is it").length > 0);
  });

  it("scores trigram similarity between typo variants highly", () => {
    assert.ok(trigramSimilarity("berlin", "berln") > 0.5);
    assert.equal(trigramSimilarity("berlin", "berlin"), 1);
    assert.ok(trigramSimilarity("berlin", "tokyo") < 0.2);
  });
});

// A small hand-built relevance set. Each case: a query, the memory that should match, and a
// distractor that should not. The fuzzy scorer must (a) rank the relevant memory first and
// (b) win on cases where plain word-overlap fails outright.
const RELEVANT_PAIRS: Array<{
  query: string;
  relevant: string;
  distractor: string;
  plainFails: boolean;
}> = [
  {
    query: "projects",
    relevant: "jam is building a side project in rust",
    distractor: "jam lives in berlin",
    plainFails: true, // "projects" is not a substring of "...project..."
  },
  {
    query: "berln", // typo
    relevant: "jam currently lives in berlin",
    distractor: "jam is building a side project in rust",
    plainFails: true,
  },
  {
    query: "operating system",
    relevant: "jam switched his operating system to linux",
    distractor: "jam enjoys hiking on weekends",
    plainFails: false,
  },
  {
    query: "what languages does jam program in",
    relevant: "jam programs mainly in typescript and rust",
    distractor: "jam drinks his coffee black",
    plainFails: false,
  },
  {
    query: "memories", // plural / -ies stemming
    relevant: "jam wants to preserve his memory across agents",
    distractor: "jam owns a bike",
    plainFails: true,
  },
];

describe("fuzzy recall relevance set (Phase 3, item 2)", () => {
  it("ranks the relevant memory strictly above the distractor", () => {
    for (const { query, relevant, distractor } of RELEVANT_PAIRS) {
      const rel = relevanceScore(query, relevant);
      const dis = relevanceScore(query, distractor);
      assert.ok(
        rel > dis,
        `"${query}": relevant (${rel.toFixed(3)}) should beat distractor (${dis.toFixed(3)})`,
      );
      assert.ok(
        rel >= MIN_RELEVANCE,
        `"${query}": relevant score ${rel.toFixed(3)} should clear MIN_RELEVANCE`,
      );
    }
  });

  it("beats plain word-overlap where morphology or typos break substring matching", () => {
    for (const { query, relevant, plainFails } of RELEVANT_PAIRS.filter((p) => p.plainFails)) {
      const plain = plainOverlap(query, relevant);
      const fuzzy = relevanceScore(query, relevant);
      assert.equal(plain, 0, `plain overlap should miss "${query}" -> "${relevant}"`);
      assert.ok(fuzzy >= MIN_RELEVANCE, `fuzzy should find "${query}" -> "${relevant}"`);
    }
  });

  it("does not flood: an unrelated memory stays below the relevance floor", () => {
    assert.ok(relevanceScore("berlin", "jam builds bridges out of code") < MIN_RELEVANCE);
    assert.ok(relevanceScore("typescript", "jam went sailing last summer") < MIN_RELEVANCE);
  });

  it("stays synonym-blind (that is the embedding layer's job, item 4)", () => {
    // "car" vs "automobile" share no morphology — the fuzzy scorer is expected to miss it.
    assert.ok(relevanceScore("automobile", "jam bought a new car") < MIN_RELEVANCE);
  });
});

describe("memoryRelevance — subject and type are matchable (D-036)", () => {
  // The real-world miss this fixes: a desktop chat asked for the user's projects and got
  // "No matching memories" over a store that held exactly that, because the record's text
  // never contained the word "project" — it was only in `type` and `subject`.
  const jamgate = {
    text: "Shipping a cross-agent memory quality gate as an MCP server",
    subject: "jamgate-project",
    type: "project",
  };

  it("finds a type=project record whose text never says 'project'", () => {
    assert.ok(
      relevanceScore("my projects", jamgate.text) < MIN_RELEVANCE,
      "precondition: text-only scoring misses it (this was the bug)",
    );
    assert.ok(
      memoryRelevance("my projects", jamgate) >= MIN_RELEVANCE,
      "whole-memory scoring finds it",
    );
  });

  it("matches on subject tokens, not just text", () => {
    assert.ok(memoryRelevance("jamgate", jamgate) >= MIN_RELEVANCE);
    assert.ok(
      memoryRelevance("operating system", {
        text: "jam switched everything over to Ubuntu 24.04",
        subject: "operating-system",
      }) >= MIN_RELEVANCE,
      "a hyphenated subject key is split into ordinary words",
    );
  });

  it("the type boost alone is weak — a real word match still ranks higher", () => {
    const byType = memoryRelevance("projects", { text: "jam went sailing", type: "project" });
    const byWords = memoryRelevance("projects", jamgate);
    assert.ok(byType >= MIN_RELEVANCE, "a type match is enough to surface the record");
    assert.ok(byWords > byType, "but text/subject matches outrank a bare type match");
    assert.equal(byType, TYPE_BOOST, "a bare type match earns exactly the boost");
  });

  it("does not flood: an untyped, unrelated memory stays below the floor", () => {
    assert.ok(
      memoryRelevance("my projects", { text: "jam lives in Berlin", subject: "location" }) <
        MIN_RELEVANCE,
    );
    assert.ok(
      memoryRelevance("berlin", jamgate) < MIN_RELEVANCE,
      "adding subject/type never makes an unrelated memory match",
    );
  });

  it("is unchanged from text-only scoring when a memory has no subject or type", () => {
    const text = "jam prefers TypeScript";
    assert.equal(memoryRelevance("typescript", { text }), relevanceScore("typescript", text));
  });
});
