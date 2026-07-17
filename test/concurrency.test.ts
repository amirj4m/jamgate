import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import { tempStore } from "./helpers.js";

describe("concurrency safety (Phase 2, item 3)", () => {
  it("interleaved writes from two writers lose no data", async () => {
    const { path, cleanup } = await tempStore();
    try {
      // Two independent store instances = two processes sharing one file.
      const a = new FileStore(path);
      const b = new FileStore(path);

      // Fire many saves from both at once. Without the lock, the read-modify-write races
      // and the last rename wins, dropping most of these. The lock serializes them.
      const saves: Promise<unknown>[] = [];
      for (let i = 0; i < 15; i++) {
        saves.push(a.save({ text: `alpha fact ${i}`, source: "user-explicit" }));
        saves.push(b.save({ text: `beta fact ${i}`, source: "user-explicit" }));
      }
      await Promise.all(saves);

      const all = await new FileStore(path).recall("", 100);
      assert.equal(all.length, 30, "no write may be lost");
      const texts = new Set(all.map((m) => m.text));
      assert.equal(texts.size, 30, "every distinct fact persisted exactly once");
    } finally {
      await cleanup();
    }
  });

  it("releases the lock so later writes still succeed", async () => {
    const { path, cleanup } = await tempStore();
    try {
      const store = new FileStore(path);
      await store.save({ text: "jam lives in Berlin", source: "user-explicit" });
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      // A fresh instance (a different process) must be able to acquire the lock too.
      await new FileStore(path).save({ text: "jam speaks Persian", source: "user-explicit" });

      assert.equal((await store.recall("", 10)).length, 3);
    } finally {
      await cleanup();
    }
  });
});
