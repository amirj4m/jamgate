import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import type { Embedder } from "../src/embeddings/embedder.js";

// Scorecard failure 1 (D-044): a semantic REWORDING of an existing memory was stored as a
// new fact. The near-duplicate check existed and worked — it simply never ran, because it
// sat in an `else` branch that only subject-LESS candidates could reach.
//
// The embedder here is a deterministic stand-in keyed on an explicit similarity table, so
// the test states the exact semantic relationship it is asserting about rather than hoping a
// real model lands on the right side of a threshold. Each text is a basis vector plus a
// controlled overlap with its declared near-duplicate.

/** Groups of texts that mean the same thing. Within a group cosine ≈ 0.97; across, ≈ 0. */
const PARAPHRASE_GROUPS: string[][] = [
  [
    "jam prefers dark theme in all his editors",
    "jam likes using a dark colour scheme in every editor he uses",
  ],
  ["jam lives in Athens, Greece", "jam's home is in Athens, the capital of Greece"],
  ["jam uses Linux", "jam runs Linux on his laptop"],
];

const SOLO: string[] = [
  "jam's asylum case number is 645673",
  "jam is engaging with the courier union in Athens",
  "jam prefers TypeScript over Python",
];

/** Build an embedder over a fixed vocabulary: one dimension per paraphrase GROUP, plus one
 *  per solo text. Members of a group get the same dominant component with a small unique
 *  perturbation, so they are near-duplicates (~0.97) without being identical vectors. */
function buildEmbedder(): Embedder {
  const dims = PARAPHRASE_GROUPS.length + SOLO.length;
  const index = new Map<string, { dim: number; variant: number }>();
  PARAPHRASE_GROUPS.forEach((group, d) =>
    group.forEach((text, variant) => index.set(text, { dim: d, variant })),
  );
  SOLO.forEach((text, i) =>
    index.set(text, { dim: PARAPHRASE_GROUPS.length + i, variant: 0 }),
  );

  return {
    id: "mock-paraphrase",
    dimensions: dims,
    async embed(text: string): Promise<number[]> {
      const entry = index.get(text.trim());
      const vec = new Array<number>(dims).fill(0);
      if (!entry) return vec.map((_, i) => (i === 0 ? 1 : 0)); // unknown text → fixed vector
      vec[entry.dim] = 1;
      // A small perturbation on a neighbouring dimension keeps paraphrases distinct
      // vectors (cosine ≈ 0.97) rather than identical ones.
      vec[(entry.dim + 1) % dims] = entry.variant * 0.25;
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
      return vec.map((x) => x / norm);
    },
  };
}

async function tempStore() {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-neardup-"));
  const path = join(dir, "memory.json");
  return {
    store: new FileStore(path, { embedder: buildEmbedder() }),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe("semantic near-duplicate coverage (D-044)", () => {
  it("flags a reworded memory saved without a subject", () => {
    // The path that already worked before 0.8.0 — kept as the control.
    return (async () => {
      const { store, cleanup } = await tempStore();
      try {
        await store.save({
          text: "jam prefers dark theme in all his editors",
          source: "user-explicit",
        });
        const res = await store.save({
          text: "jam likes using a dark colour scheme in every editor he uses",
          source: "user-explicit",
        });
        assert.equal(res.action, "possible_duplicate");
      } finally {
        await cleanup();
      }
    })();
  });

  it("flags a reworded memory whose subject matches nothing on file", async () => {
    // THE REGRESSION. Before 0.8.0 the near-duplicate check lived in an `else` branch, so
    // any candidate carrying a subject skipped it entirely — and a reword whose subject was
    // spelled differently from the original's was stored as a brand-new fact.
    const { store, cleanup } = await tempStore();
    try {
      await store.save({
        text: "jam prefers dark theme in all his editors",
        subject: "editor-theme",
        source: "user-explicit",
      });
      const res = await store.save({
        text: "jam likes using a dark colour scheme in every editor he uses",
        subject: "colour-scheme", // a different spelling of the same subject
        source: "user-explicit",
      });
      assert.equal(res.action, "possible_duplicate");
      assert.equal(res.possibleDuplicates?.[0].memory.text, "jam prefers dark theme in all his editors");
    } finally {
      await cleanup();
    }
  });

  it("flags a reword when only the NEW memory carries a subject", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Athens, Greece", source: "user-explicit" });
      const res = await store.save({
        text: "jam's home is in Athens, the capital of Greece",
        subject: "home-city",
        source: "user-explicit",
      });
      assert.equal(res.action, "possible_duplicate");
    } finally {
      await cleanup();
    }
  });

  it("still SUPERSEDES rather than deduplicates when the subject matches", async () => {
    // The guard that makes widening the check safe: a candidate that superseded something
    // never reaches the near-duplicate branch, so a legitimate update to a known subject is
    // never mistaken for a restatement (RULES §2.3 — the newer fact wins by recency).
    const { store, cleanup } = await tempStore();
    try {
      await store.save({
        text: "jam prefers dark theme in all his editors",
        subject: "editor-theme",
        source: "user-explicit",
      });
      const res = await store.save({
        text: "jam likes using a dark colour scheme in every editor he uses",
        subject: "editor-theme", // SAME subject → an update, not a duplicate
        source: "user-explicit",
      });
      assert.equal(res.action, "superseded");
      assert.equal(res.retired?.length, 1);
    } finally {
      await cleanup();
    }
  });

  it("does not flag unrelated memories as near-duplicates", async () => {
    // The precision half: the 0.8.0 stress test's headline success was twelve
    // different-topic saves with no ping-pong, and widening the check must not cost that.
    const { store, cleanup } = await tempStore();
    try {
      for (const text of SOLO) {
        const res = await store.save({ text, source: "user-explicit" });
        assert.equal(res.action, "created", `wrongly gated: ${text}`);
      }
      const active = await store.recall("", 20);
      assert.equal(active.length, SOLO.length);
    } finally {
      await cleanup();
    }
  });

  it("does not flag unrelated memories even when each carries its own subject", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const subjects = ["asylum-case", "union-work", "language-preference"];
      for (const [i, text] of SOLO.entries()) {
        const res = await store.save({ text, subject: subjects[i], source: "user-explicit" });
        assert.equal(res.action, "created", `wrongly gated: ${text}`);
      }
    } finally {
      await cleanup();
    }
  });

  it("leaves the store untouched when a near-duplicate is refused", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({
        text: "jam uses Linux",
        subject: "operating-system",
        source: "user-explicit",
      });
      await store.save({
        text: "jam runs Linux on his laptop",
        subject: "os-choice",
        source: "user-explicit",
      });
      const active = await store.recall("", 20);
      assert.equal(active.length, 1);
      assert.equal(active[0].text, "jam uses Linux");
    } finally {
      await cleanup();
    }
  });
});

// Scorecard failure 6 (D-045): two saves tracking the SAME value stayed active side by
// side, because their phrasing differed lexically and their embeddings sit only 0.67 apart
// — far below any duplicate threshold that could still tell "uses Windows" from "uses
// Linux" (0.81). No cutoff separates those two populations, so the gate stops pretending it
// can: it stores the memory and reports the resemblance for the agent to act on.

/** An embedder with an explicit similarity table, so each test states the exact semantic
 *  relationship it asserts instead of relying on a real model landing where we hope. */
function tableEmbedder(table: Record<string, [number, number]>): Embedder {
  return {
    id: "mock-table",
    dimensions: 2,
    async embed(text: string): Promise<number[]> {
      const v = table[text.trim()] ?? [1, 0];
      const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
      return [v[0] / norm, v[1] / norm];
    },
  };
}

/** Two unit vectors `deg` degrees apart — cosine similarity = cos(deg). */
function atAngle(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

const THINKBOOK_OLD = "jam's ThinkBook savings progress is 5/10, €640 saved";
const THINKBOOK_NEW = "ThinkBook fund now at 7/10 — €768 put aside";

async function tableStore(table: Record<string, [number, number]>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-related-"));
  return {
    store: new FileStore(join(dir, "memory.json"), { embedder: tableEmbedder(table) }),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe("related-memory hints (D-045)", () => {
  it("reports the older memory when a same-subject update is saved without a subject", async () => {
    // cos(48°) ≈ 0.67 — the measured ThinkBook similarity.
    const { store, cleanup } = await tableStore({
      [THINKBOOK_OLD]: [1, 0],
      [THINKBOOK_NEW]: atAngle(48),
    });
    try {
      await store.save({ text: THINKBOOK_OLD, source: "user-explicit" });
      const res = await store.save({ text: THINKBOOK_NEW, source: "user-explicit" });

      // Stored — a hint must never be a refusal, and 0.67 is not duplicate evidence.
      assert.equal(res.action, "created");
      assert.equal(res.relatedMemories?.length, 1);
      assert.equal(res.relatedMemories?.[0].memory.text, THINKBOOK_OLD);
      assert.ok((res.relatedMemories?.[0].similarity ?? 0) > 0.6);
    } finally {
      await cleanup();
    }
  });

  it("carries the older memory's subject in the hint so the agent can reuse it", async () => {
    const { store, cleanup } = await tableStore({
      [THINKBOOK_OLD]: [1, 0],
      [THINKBOOK_NEW]: atAngle(48),
    });
    try {
      await store.save({
        text: THINKBOOK_OLD,
        subject: "thinkbook-savings",
        source: "user-explicit",
      });
      const res = await store.save({ text: THINKBOOK_NEW, source: "user-explicit" });
      assert.equal(res.relatedMemories?.[0].memory.subject, "thinkbook-savings");
    } finally {
      await cleanup();
    }
  });

  it("supersedes with no hint once the agent reuses the subject", async () => {
    // The loop closes: hint → agent re-saves with the subject → the old memory retires.
    const { store, cleanup } = await tableStore({
      [THINKBOOK_OLD]: [1, 0],
      [THINKBOOK_NEW]: atAngle(48),
    });
    try {
      await store.save({
        text: THINKBOOK_OLD,
        subject: "thinkbook-savings",
        source: "user-explicit",
      });
      const res = await store.save({
        text: THINKBOOK_NEW,
        subject: "thinkbook-savings",
        source: "user-explicit",
      });
      assert.equal(res.action, "superseded");
      assert.equal(res.relatedMemories, undefined);
      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.equal(active[0].text, THINKBOOK_NEW);
    } finally {
      await cleanup();
    }
  });

  it("does not hint on genuinely unrelated memories", async () => {
    // cos(70°) ≈ 0.34 — the measured similarity of two unrelated facts.
    const A = "jam's asylum case number is 645673";
    const B = "jam prefers dark theme in all his editors";
    const { store, cleanup } = await tableStore({ [A]: [1, 0], [B]: atAngle(70) });
    try {
      await store.save({ text: A, source: "user-explicit" });
      const res = await store.save({ text: B, source: "user-explicit" });
      assert.equal(res.action, "created");
      assert.equal(res.relatedMemories, undefined);
    } finally {
      await cleanup();
    }
  });

  it("refuses rather than hints once similarity clears the duplicate bar", async () => {
    // cos(20°) ≈ 0.94 — the measured similarity of a true reword. The two bands must not
    // overlap: above the duplicate threshold the gate acts, below it only speaks.
    const A = "jam builds Jamgate, an open-source memory quality-gate MCP server";
    const B = "Jamgate is an open-source MCP server built by jam that gates memory quality";
    const { store, cleanup } = await tableStore({ [A]: [1, 0], [B]: atAngle(20) });
    try {
      await store.save({ text: A, source: "user-explicit" });
      const res = await store.save({ text: B, source: "user-explicit" });
      assert.equal(res.action, "possible_duplicate");
      assert.equal(res.relatedMemories, undefined);
    } finally {
      await cleanup();
    }
  });

  it("keeps a distinct-fact pair storable while flagging it as related", async () => {
    // "prefers TypeScript" / "prefers Python" measured 0.65 — inside the hint band. Both
    // are stored (they may well be two real preferences); the agent is merely told.
    const A = "jam prefers TypeScript";
    const B = "jam prefers Python";
    const { store, cleanup } = await tableStore({ [A]: [1, 0], [B]: atAngle(49) });
    try {
      await store.save({ text: A, source: "user-explicit" });
      const res = await store.save({ text: B, source: "user-explicit" });
      assert.equal(res.action, "created");
      assert.ok(res.relatedMemories && res.relatedMemories.length > 0);
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });

  it("never hints when there is no embedder at all", async () => {
    // The base install has no ML runtime; the hint layer must simply not exist there.
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-noemb-"));
    const store = new FileStore(join(dir, "memory.json"));
    try {
      await store.save({ text: THINKBOOK_OLD, source: "user-explicit" });
      const res = await store.save({ text: THINKBOOK_NEW, source: "user-explicit" });
      assert.equal(res.action, "created");
      assert.equal(res.relatedMemories, undefined);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
