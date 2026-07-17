import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import type { Memory } from "../src/store/types.js";
import {
  computeExpiresAt,
  isCompactable,
  isExpired,
  resolveTtlPolicy,
} from "../src/store/ttl.js";
import { tempStore } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

/** Build a minimal active memory with explicit timestamps for deterministic tests. */
function mem(partial: Partial<Memory> & Pick<Memory, "id" | "text">): Memory {
  return {
    type: undefined,
    source: "user-explicit",
    status: "active",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  } as Memory;
}

/** Write a schema-v2 store file directly, so we control expiry timestamps exactly. */
async function seed(path: string, memories: Memory[]): Promise<void> {
  await fs.writeFile(path, JSON.stringify({ schemaVersion: 2, memories }, null, 2), "utf8");
}

describe("TTL policy (pure functions)", () => {
  it("expires volatile state and projects but never identity/preference", () => {
    const policy = resolveTtlPolicy({}); // defaults, no env overrides
    const created = "2026-01-01T00:00:00.000Z";
    assert.equal(computeExpiresAt("identity", created, policy), undefined);
    assert.equal(computeExpiresAt("preference", created, policy), undefined);
    assert.ok(computeExpiresAt("project", created, policy), "project should expire");
    assert.ok(computeExpiresAt("state", created, policy), "state should expire");
    // State (2 days) expires sooner than project (90 days).
    const stateAt = new Date(computeExpiresAt("state", created, policy)!).getTime();
    const projectAt = new Date(computeExpiresAt("project", created, policy)!).getTime();
    assert.ok(stateAt < projectAt);
    assert.equal(computeExpiresAt(undefined, created, policy), undefined, "untyped never expires");
  });

  it("honours per-type env overrides, including 'never'", () => {
    const policy = resolveTtlPolicy({
      JAMGATE_TTL_STATE_DAYS: "never",
      JAMGATE_TTL_PROJECT_DAYS: "7",
    });
    const created = "2026-01-01T00:00:00.000Z";
    assert.equal(computeExpiresAt("state", created, policy), undefined, "state overridden to never");
    const projectAt = new Date(computeExpiresAt("project", created, policy)!).getTime();
    assert.equal(projectAt, new Date(created).getTime() + 7 * DAY);
  });

  it("isExpired / isCompactable respect the grace window", () => {
    const now = Date.UTC(2026, 5, 1);
    const yesterday = new Date(now - 1 * DAY).toISOString();
    assert.equal(isExpired(undefined, now), false, "no expiry → never expired");
    assert.equal(isExpired(yesterday, now), true);
    // Expired one day ago, 30-day grace → not yet compactable.
    assert.equal(isCompactable(yesterday, now, 30 * DAY), false);
    // Expired 40 days ago, 30-day grace → compactable.
    const longAgo = new Date(now - 40 * DAY).toISOString();
    assert.equal(isCompactable(longAgo, now, 30 * DAY), true);
  });
});

describe("expiry in recall (Phase 2, item 2)", () => {
  it("hides soft-expired records but keeps non-expiring types", async () => {
    const { store, path, cleanup } = await tempStore();
    try {
      const yesterday = new Date(Date.now() - 1 * DAY).toISOString();
      await seed(path, [
        mem({ id: "a", text: "jam is a developer", type: "identity" }), // never expires
        mem({ id: "b", text: "jam is comparing DB options", type: "state", expiresAt: yesterday }),
      ]);

      const active = await store.recall("", 10);
      assert.equal(active.length, 1, "the expired state must not surface");
      assert.equal(active[0].text, "jam is a developer");

      // The audit view still shows it — soft-expire hides, it does not delete.
      const audit = await store.recall("", 10, true);
      assert.equal(audit.length, 2);
    } finally {
      await cleanup();
    }
  });

  it("stamps expiresAt on save for typed records, and leaves identity open-ended", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const { memory: volatile } = await store.save({
        text: "jam is comparing DB options today",
        type: "state",
        source: "user-explicit",
      });
      assert.ok(volatile.expiresAt, "state must get an expiry");
      assert.ok(new Date(volatile.expiresAt!) > new Date(volatile.createdAt));

      const { memory: identity } = await store.save({
        text: "jam is a software developer",
        type: "identity",
        source: "user-explicit",
      });
      assert.equal(identity.expiresAt, undefined, "identity never expires");

      // The fresh state record (2-day default TTL) is still current, so recall shows both.
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });
});

describe("compaction (Phase 2, item 2)", () => {
  it("removes long-expired records but keeps soft-expired and non-expiring ones", async () => {
    const { store, path, cleanup } = await tempStore();
    try {
      const now = Date.now();
      await seed(path, [
        mem({ id: "keep-identity", text: "jam is a developer", type: "identity" }),
        mem({
          id: "keep-soft",
          text: "jam is tired today",
          type: "state",
          expiresAt: new Date(now - 1 * DAY).toISOString(), // expired, within 30-day grace
        }),
        mem({
          id: "drop-old",
          text: "jam was reading about Postgres",
          type: "state",
          expiresAt: new Date(now - 40 * DAY).toISOString(), // expired beyond grace
        }),
      ]);

      const removed = await store.compact();
      assert.equal(removed, 1, "only the long-expired record is compacted");

      const audit = await store.recall("", 10, true);
      const ids = audit.map((m) => m.id).sort();
      assert.deepEqual(ids, ["keep-identity", "keep-soft"]);
    } finally {
      await cleanup();
    }
  });

  it("compacts opportunistically on save", async () => {
    const { store, path, cleanup } = await tempStore();
    try {
      await seed(path, [
        mem({
          id: "drop-old",
          text: "stale focus",
          type: "state",
          expiresAt: new Date(Date.now() - 40 * DAY).toISOString(),
        }),
      ]);

      await store.save({ text: "jam lives in Berlin", source: "user-explicit" });

      const audit = await store.recall("", 10, true);
      assert.equal(audit.some((m) => m.id === "drop-old"), false, "save should prune long-dead records");
      assert.equal(audit.length, 1);
    } finally {
      await cleanup();
    }
  });
});
