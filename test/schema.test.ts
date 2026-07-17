import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import type { Memory } from "../src/store/types.js";
import { CURRENT_SCHEMA_VERSION, migrate } from "../src/store/schema.js";
import { resolveTtlPolicy } from "../src/store/ttl.js";
import { tempStore } from "./helpers.js";

/** A legacy (schema v1) record: a bare object with no expiresAt, no version envelope. */
function legacy(partial: Partial<Memory> & Pick<Memory, "id" | "text">): Memory {
  const created = new Date().toISOString(); // recent, so type-based backfill stays fresh
  return {
    type: undefined,
    source: "user-explicit",
    status: "active",
    createdAt: created,
    updatedAt: created,
    ...partial,
  } as Memory;
}

describe("schema migration (pure)", () => {
  it("wraps a legacy bare array into the versioned envelope", () => {
    const policy = resolveTtlPolicy({});
    const file = migrate([legacy({ id: "a", text: "jam uses Linux" })], policy);
    assert.equal(file.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(file.memories.length, 1);
    assert.equal(file.memories[0].text, "jam uses Linux");
  });

  it("backfills expiresAt for typed legacy records, leaving identity open-ended", () => {
    const policy = resolveTtlPolicy({});
    const file = migrate(
      [
        legacy({ id: "p", text: "building a language app", type: "project" }),
        legacy({ id: "i", text: "jam is a developer", type: "identity" }),
      ],
      policy,
    );
    const project = file.memories.find((m) => m.id === "p")!;
    const identity = file.memories.find((m) => m.id === "i")!;
    assert.ok(project.expiresAt, "a project gets a backfilled expiry");
    assert.equal(identity.expiresAt, undefined, "identity stays open-ended");
  });

  it("degrades unrecognizable input to an empty store instead of throwing", () => {
    const policy = resolveTtlPolicy({});
    assert.deepEqual(migrate({ nonsense: true }, policy).memories, []);
    assert.deepEqual(migrate(null, policy).memories, []);
  });
});

describe("schema migration (through FileStore)", () => {
  it("loads an old unversioned file and upgrades it on the next write", async () => {
    const { path, cleanup } = await tempStore();
    try {
      // Write an OLD-format file: a bare array, exactly what pre-Phase-2 users have.
      const old: Memory[] = [
        legacy({ id: "1", text: "jam lives in Berlin", subject: "location" }),
        legacy({ id: "2", text: "building a language app", type: "project" }),
      ];
      await fs.writeFile(path, JSON.stringify(old, null, 2), "utf8");

      // Reading migrates in memory — old records are visible.
      const store = new FileStore(path);
      const hits = await store.recall("", 10);
      assert.equal(hits.length, 2);

      // The next write persists the upgraded, versioned format.
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      assert.equal(onDisk.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.ok(Array.isArray(onDisk.memories));
      assert.equal(onDisk.memories.length, 3, "legacy records are preserved through migration");
      assert.ok(
        onDisk.memories.find((m: Memory) => m.id === "1"),
        "the original legacy record survives",
      );
    } finally {
      await cleanup();
    }
  });
});
