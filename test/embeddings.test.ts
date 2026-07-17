import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import type { Embedder } from "../src/embeddings/embedder.js";

// A deterministic, offline stand-in for the real all-MiniLM embedder. It maps text to a
// concept vector where synonyms share a concept (so cosine ≈ 1) and unrelated facts land on
// orthogonal concepts (cosine 0). This exercises the store's semantic wiring — blended
// recall and near-duplicate detection — with zero model download, exactly what CI needs.
const CONCEPTS: Record<string, string[]> = {
  vehicle: ["car", "cars", "automobile", "vehicle", "auto", "drives", "drive"],
  location: ["berlin", "live", "lives", "living", "located", "city", "resides"],
  os: ["linux", "windows", "macos", "operating", "system"],
  language: ["typescript", "rust", "python", "programs", "programming", "codes"],
};
const CONCEPT_KEYS = Object.keys(CONCEPTS);

const mockEmbedder: Embedder = {
  id: "mock-concepts",
  dimensions: CONCEPT_KEYS.length,
  async embed(text: string): Promise<number[]> {
    const tokens = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const vec = CONCEPT_KEYS.map((key) => {
      let hits = 0;
      for (const w of CONCEPTS[key]) if (tokens.has(w)) hits++;
      return hits;
    });
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? vec : vec.map((x) => x / norm);
  },
};

async function tempStore(opts: { embedder?: Embedder } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-emb-"));
  const path = join(dir, "memory.json");
  return {
    store: new FileStore(path, opts),
    path,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe("semantic recall (D-026)", () => {
  it("recalls a synonym match that fuzzy lexical scoring cannot reach", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      await store.save({ text: "jam drives a fast car", source: "user-explicit" });
      // "automobile" shares no stem/trigram with "car" — fuzzy alone returns nothing.
      const hits = await store.recall("automobile", 5);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].text, "jam drives a fast car");
    } finally {
      await cleanup();
    }
  });

  it("does not surface semantically unrelated memories", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      await store.save({ text: "jam programs in rust", source: "user-explicit" });
      const hits = await store.recall("automobile", 5);
      assert.equal(hits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("stores the embedding on the record so it survives a reload", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      await store.save({ text: "jam drives a car", source: "user-explicit" });
      const [m] = await store.recall("", 5);
      assert.ok(Array.isArray(m.embedding), "embedding must be persisted");
      assert.equal(m.embedding?.length, mockEmbedder.dimensions);
    } finally {
      await cleanup();
    }
  });
});

describe("semantic near-duplicate detection (D-026)", () => {
  it("flags a paraphrase as possible_duplicate and does NOT store it", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      const first = await store.save({ text: "jam drives a car", source: "user-explicit" });
      assert.equal(first.action, "created");

      const dup = await store.save({ text: "jam owns an automobile", source: "user-explicit" });
      assert.equal(dup.action, "possible_duplicate");
      assert.equal(dup.possibleDuplicates?.length, 1);
      assert.equal(dup.possibleDuplicates?.[0].memory.id, first.memory.id);
      assert.ok((dup.possibleDuplicates?.[0].similarity ?? 0) >= 0.88);

      // The store still holds exactly one memory — the near-dup was not silently added.
      assert.equal((await store.recall("", 10)).length, 1);
    } finally {
      await cleanup();
    }
  });

  it("still stores a semantically distinct memory", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      await store.save({ text: "jam drives a car", source: "user-explicit" });
      const other = await store.save({ text: "jam lives in berlin", source: "user-explicit" });
      assert.equal(other.action, "created");
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });

  it("a subject-bearing save skips near-dup and takes the supersession path", async () => {
    const { store, cleanup } = await tempStore({ embedder: mockEmbedder });
    try {
      await store.save({ text: "jam drives a car", subject: "vehicle", source: "user-explicit" });
      // Same concept + same subject + equal trust → this is an intentional update, not a
      // duplicate to block: supersession must win over near-dup detection.
      const next = await store.save({
        text: "jam owns an automobile",
        subject: "vehicle",
        source: "user-explicit",
      });
      assert.equal(next.action, "superseded");
    } finally {
      await cleanup();
    }
  });
});

describe("graceful degradation without an embedder", () => {
  it("behaves exactly as fuzzy-only: no embeddings, no possible_duplicate", async () => {
    const { store, cleanup } = await tempStore(); // no embedder injected
    try {
      const a = await store.save({ text: "jam drives a fast car", source: "user-explicit" });
      const b = await store.save({ text: "jam owns an automobile", source: "user-explicit" });
      assert.equal(a.action, "created");
      assert.equal(b.action, "created"); // synonyms are invisible to the fuzzy path
      assert.equal(a.memory.embedding, undefined);

      // Synonym recall misses the "car" memory, as documented — that's the embedder's job.
      // (The "automobile" memory would match "automobile" by literal token, so query "car".)
      const hits = await store.recall("automobile", 5);
      assert.ok(!hits.some((m) => m.text.includes("car")), "fuzzy must not reach the car synonym");
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });
});
