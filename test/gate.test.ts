import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { tempStore } from "./helpers.js";

describe("exact dedup (RULES §2.2)", () => {
  it("returns the existing memory instead of storing a second copy", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const first = await store.save({ text: "jam lives in Berlin", source: "user-explicit" });
      assert.equal(first.action, "created");

      const second = await store.save({ text: "jam lives in Berlin", source: "user-explicit" });
      assert.equal(second.action, "duplicate");
      assert.equal(second.memory.id, first.memory.id);

      const all = await store.recall("", 10);
      assert.equal(all.length, 1);
    } finally {
      await cleanup();
    }
  });

  it("normalizes case and surrounding whitespace before comparing", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      const dup = await store.save({ text: "  JAM USES LINUX  ", source: "user-explicit" });
      assert.equal(dup.action, "duplicate");
      assert.equal((await store.recall("", 10)).length, 1);
    } finally {
      await cleanup();
    }
  });
});

describe("time-aware supersession (RULES §2.3, D-015)", () => {
  it("retires an older memory when a newer one shares its subject", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const old = await store.save({
        text: "jam uses Windows",
        subject: "operating-system",
        source: "user-explicit",
      });
      const fresh = await store.save({
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });

      assert.equal(fresh.action, "superseded");
      assert.equal(fresh.retired?.length, 1);
      assert.equal(fresh.retired?.[0].id, old.memory.id);
    } finally {
      await cleanup();
    }
  });

  it("keeps the retired memory for audit with supersededBy/supersededAt set", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const old = await store.save({
        text: "jam uses Windows",
        subject: "operating-system",
        source: "user-explicit",
      });
      const fresh = await store.save({
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });

      const history = await store.recall("", 10, true);
      const retired = history.find((m) => m.id === old.memory.id);
      assert.ok(retired, "retired memory must still exist (kept, not deleted)");
      assert.equal(retired.status, "superseded");
      assert.equal(retired.supersededBy, fresh.memory.id);
      assert.ok(retired.supersededAt, "supersededAt must be stamped");
    } finally {
      await cleanup();
    }
  });

  it("recall surfaces only the active fact, never the stale one", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({
        text: "jam uses Windows",
        subject: "operating-system",
        source: "user-explicit",
      });
      await store.save({
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });

      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.equal(active[0].text, "jam moved to Linux");
    } finally {
      await cleanup();
    }
  });

  it("does not supersede across different subjects", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", subject: "operating-system", source: "user-explicit" });
      const other = await store.save({
        text: "jam lives in Berlin",
        subject: "location",
        source: "user-explicit",
      });

      assert.equal(other.action, "created");
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });

  it("does not supersede when no subject is supplied", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Windows", source: "user-explicit" });
      const next = await store.save({ text: "jam moved to Linux", source: "user-explicit" });

      assert.equal(next.action, "created");
      assert.equal((await store.recall("", 10)).length, 2);
    } finally {
      await cleanup();
    }
  });

  it("matches subjects case-insensitively", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Windows", subject: "Operating-System", source: "user-explicit" });
      const fresh = await store.save({
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });
      assert.equal(fresh.action, "superseded");
    } finally {
      await cleanup();
    }
  });
});

describe("source-trust conflict guard (RULES §2.3, §5.4)", () => {
  it("refuses to let a lower-trust source overwrite a higher-trust one", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const trusted = await store.save({
        text: "jam lives in Berlin",
        subject: "location",
        source: "user-explicit",
      });
      const guess = await store.save({
        text: "jam lives in Paris",
        subject: "location",
        source: "agent-inferred",
      });

      assert.equal(guess.action, "conflict");
      assert.equal(guess.conflictsWith?.length, 1);
      assert.equal(guess.conflictsWith?.[0].id, trusted.memory.id);
    } finally {
      await cleanup();
    }
  });

  it("does not store the conflicting memory — the trusted fact stays active", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-explicit" });
      await store.save({ text: "jam lives in Paris", subject: "location", source: "agent-inferred" });

      const active = await store.recall("", 10);
      assert.equal(active.length, 1);
      assert.equal(active[0].text, "jam lives in Berlin");
    } finally {
      await cleanup();
    }
  });

  it("supersedes when the new fact carries equal trust", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-confirmed" });
      const next = await store.save({
        text: "jam lives in Paris",
        subject: "location",
        source: "user-confirmed",
      });
      assert.equal(next.action, "superseded");
    } finally {
      await cleanup();
    }
  });

  it("supersedes when the new fact carries higher trust", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "agent-inferred" });
      const next = await store.save({
        text: "jam lives in Paris",
        subject: "location",
        source: "user-explicit",
      });

      assert.equal(next.action, "superseded");
      assert.equal((await store.recall("", 10))[0].text, "jam lives in Paris");
    } finally {
      await cleanup();
    }
  });

  it("compares against the most-trusted existing memory on the subject", async () => {
    const { store, cleanup } = await tempStore();
    try {
      // An agent-inferred fact is on file, then a user-explicit one supersedes it.
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "agent-inferred" });
      await store.save({ text: "jam lives in Paris", subject: "location", source: "user-explicit" });

      // A fresh guess must lose to the user-explicit fact, not win against the retired one.
      const guess = await store.save({
        text: "jam lives in Rome",
        subject: "location",
        source: "user-confirmed",
      });
      assert.equal(guess.action, "conflict");
    } finally {
      await cleanup();
    }
  });
});
