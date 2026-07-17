import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import { tempStore } from "./helpers.js";

describe("FileStore persistence", () => {
  it("creates the store file and its parent directory on first write", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-test-"));
    const path = join(dir, "nested", "memory.json");
    try {
      await new FileStore(path).save({ text: "jam uses Linux", source: "user-explicit" });
      const raw = JSON.parse(await fs.readFile(path, "utf8"));
      assert.equal(raw.length, 1);
      assert.equal(raw[0].text, "jam uses Linux");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reads back memories written by a previous instance", async () => {
    const { path, cleanup } = await tempStore();
    try {
      await new FileStore(path).save({ text: "jam lives in Berlin", source: "user-explicit" });

      const reopened = await new FileStore(path).recall("Berlin");
      assert.equal(reopened.length, 1);
      assert.equal(reopened[0].text, "jam lives in Berlin");
    } finally {
      await cleanup();
    }
  });

  it("honours the JAMGATE_STORE environment override", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-test-"));
    const path = join(dir, "from-env.json");
    const previous = process.env.JAMGATE_STORE;
    process.env.JAMGATE_STORE = path;
    try {
      await new FileStore().save({ text: "jam uses Linux", source: "user-explicit" });
      // The file exists at the overridden path, not the default under $HOME.
      assert.equal(JSON.parse(await fs.readFile(path, "utf8")).length, 1);
    } finally {
      if (previous === undefined) delete process.env.JAMGATE_STORE;
      else process.env.JAMGATE_STORE = previous;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the store file does not exist yet", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-test-"));
    try {
      const hits = await new FileStore(join(dir, "absent.json")).recall("anything");
      assert.deepEqual(hits, []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("stamps every memory with an id and ISO timestamps", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const { memory } = await store.save({ text: "jam uses Linux", source: "user-explicit" });
      assert.match(memory.id, /^[0-9a-f-]{36}$/);
      assert.equal(memory.status, "active");
      assert.equal(new Date(memory.createdAt).toISOString(), memory.createdAt);
      assert.equal(memory.updatedAt, memory.createdAt);
    } finally {
      await cleanup();
    }
  });
});

describe("FileStore recall and forget", () => {
  it("ranks by word overlap and respects the limit", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", source: "user-explicit" });
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      await store.save({ text: "the weather in Berlin is cold", source: "user-explicit" });

      const hits = await store.recall("Berlin", 1);
      assert.equal(hits.length, 1);
      assert.ok(hits[0].text.includes("Berlin"));
    } finally {
      await cleanup();
    }
  });

  it("returns the most recent memories for an empty query", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", source: "user-explicit" });
      await store.save({ text: "jam uses Linux", source: "user-explicit" });

      const hits = await store.recall("", 5);
      assert.equal(hits[0].text, "jam uses Linux", "newest first");
    } finally {
      await cleanup();
    }
  });

  it("forgets a memory by id and reports success", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const { memory } = await store.save({ text: "jam uses Linux", source: "user-explicit" });

      assert.equal(await store.forget(memory.id), true);
      assert.deepEqual(await store.recall("", 10), []);
    } finally {
      await cleanup();
    }
  });

  it("reports failure when forgetting an unknown id", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      assert.equal(await store.forget("does-not-exist"), false);
      assert.equal((await store.recall("", 10)).length, 1);
    } finally {
      await cleanup();
    }
  });
});
