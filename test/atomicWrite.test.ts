import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import { tempStore } from "./helpers.js";

/** A store whose disk write dies halfway through, before the fsync + rename that would
 *  commit it — a stand-in for a power loss / process kill mid-write. */
class CrashingStore extends FileStore {
  protected async persist(tmpPath: string, data: string): Promise<void> {
    // Write only a truncated, syntactically-broken prefix, then crash before commit.
    await fs.writeFile(tmpPath, data.slice(0, Math.floor(data.length / 2)), "utf8");
    throw new Error("simulated crash mid-write");
  }
}

describe("atomic write (Phase 2, item 1)", () => {
  it("an interrupted write leaves the committed store intact", async () => {
    const { path, cleanup } = await tempStore();
    try {
      // Commit a good version through the normal path.
      await new FileStore(path).save({ text: "jam lives in Berlin", source: "user-explicit" });

      // Now a save that crashes mid-write must NOT corrupt the committed file.
      const crashing = new CrashingStore(path);
      await assert.rejects(
        crashing.save({ text: "jam moved to Paris", source: "user-explicit" }),
        /simulated crash/,
      );

      // The target file is still valid JSON and still holds exactly the committed data.
      const parsed = JSON.parse(await fs.readFile(path, "utf8"));
      assert.equal(parsed.schemaVersion, 2);
      assert.equal(parsed.memories.length, 1);
      assert.equal(parsed.memories[0].text, "jam lives in Berlin");

      // And it is still fully usable afterwards.
      const hits = await new FileStore(path).recall("Berlin");
      assert.equal(hits.length, 1);
    } finally {
      await cleanup();
    }
  });

  it("cleans up its temp files — no torn temp is left behind", async () => {
    const { path, cleanup } = await tempStore();
    const dir = dirname(path);
    try {
      const store = new FileStore(path);
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      await store.save({ text: "jam speaks Persian", source: "user-explicit" });

      const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(leftovers, [], "no .tmp files should survive a successful write");

      // A failed write also removes its own temp.
      await assert.rejects(new CrashingStore(path).save({ text: "another fact", source: "user-explicit" }));
      const afterCrash = (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(afterCrash, [], "a crashed write must not orphan a .tmp file");
    } finally {
      await cleanup();
    }
  });

  it("ignores an orphaned temp file left by a previously crashed writer", async () => {
    const { path, cleanup } = await tempStore();
    const dir = dirname(path);
    try {
      await new FileStore(path).save({ text: "jam lives in Berlin", source: "user-explicit" });
      // Simulate a leftover temp from a crash that never renamed.
      await fs.writeFile(`${dir}/.memory.json.orphan.tmp`, "{ half-written", "utf8");

      const hits = await new FileStore(path).recall("Berlin");
      assert.equal(hits.length, 1, "the orphan temp must not affect the real store");
    } finally {
      await cleanup();
    }
  });
});
