import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import { CURRENT_SCHEMA_VERSION } from "../src/store/schema.js";
import { tempStore } from "./helpers.js";

describe("FileStore persistence", () => {
  it("creates the store file and its parent directory on first write", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-test-"));
    const path = join(dir, "nested", "memory.json");
    try {
      await new FileStore(path).save({ text: "jam uses Linux", source: "user-explicit" });
      const raw = JSON.parse(await fs.readFile(path, "utf8"));
      assert.equal(raw.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(raw.memories.length, 1);
      assert.equal(raw.memories[0].text, "jam uses Linux");
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
      assert.equal(JSON.parse(await fs.readFile(path, "utf8")).memories.length, 1);
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

  it("recalls by type and subject, not just text (D-036 regression)", async () => {
    // Reproduces a real miss: asking for "my projects" returned nothing, even though the
    // store held a type=project / subject=jamgate-project record — its text just never used
    // the word. Structured fields the gate assigns must be visible to recall.
    const { store, cleanup } = await tempStore();
    try {
      await store.save({
        text: "Shipping a cross-agent memory quality gate as an MCP server",
        type: "project",
        subject: "jamgate-project",
        source: "user-explicit",
      });
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-explicit" });

      const byType = await store.recall("what are my projects?", 5);
      assert.equal(byType.length, 1, "the project record is found");
      assert.equal(byType[0].subject, "jamgate-project");

      // Subject tokens are matchable too. (The fuzzy scorer also gives the "jam ..." memory
      // partial credit for "jamgate" — long-standing morphology behavior — so assert on the
      // ranking, which is what a caller actually consumes.)
      const bySubject = await store.recall("jamgate", 5);
      assert.equal(bySubject[0].subject, "jamgate-project", "the subject match ranks first");

      const unrelated = await store.recall("my projects", 5);
      assert.ok(
        unrelated.every((m) => m.subject !== "location"),
        "an unrelated memory is not dragged in",
      );
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

      const deleted = await store.forget(memory.id);
      assert.equal(deleted.ok, true);
      assert.equal(deleted.ok && deleted.id, memory.id);
      // The deleted record is handed back so a caller can log the reversal (D-056).
      assert.equal(deleted.ok && deleted.memory?.text, "jam uses Linux");
      assert.deepEqual(await store.recall("", 10), []);
    } finally {
      await cleanup();
    }
  });

  it("reports failure when forgetting an unknown id", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      assert.deepEqual(await store.forget("does-not-exist"), { ok: false, reason: "not-found" });
      assert.equal((await store.recall("", 10)).length, 1);
    } finally {
      await cleanup();
    }
  });
});

/**
 * A corrupt store is the worst moment to be handed a bad error message (D-065). Before this,
 * every save and recall failed with a bare `Expected property name or '}' in JSON at position
 * 2` relayed through MCP — no file path, no cause, no next step, and no reassurance that the
 * user's memories still existed. The user sees their agent report a JSON syntax error with no
 * way to connect it to a file on their own disk.
 */
describe("unreadable store: the message a user gets at the worst moment", () => {
  it("names the file, the cause, and the fact that nothing was destroyed", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-corrupt-"));
    const path = join(dir, "memory.json");
    const corrupt = '{ "memories": [ this is not json';
    await fs.writeFile(path, corrupt);
    try {
      const store = new FileStore(path);
      await assert.rejects(store.recall("anything"), (err: Error) => {
        assert.match(err.message, /not valid JSON/);
        assert.ok(err.message.includes(path), "the error must name the store path");
        assert.match(err.message, /NOT been modified or deleted/);
        return true;
      });
      // The promise of that message has to be true: a failed read must never let a write
      // through that would flatten the file the user still needs.
      await assert.rejects(store.save({ text: "jam wants to save a durable fact about himself", source: "user-explicit" }));
      assert.equal(await fs.readFile(path, "utf8"), corrupt, "the corrupt store was modified");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("explains a permission error rather than leaking a bare EACCES", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-perm-"));
    const path = join(dir, "memory.json");
    await fs.writeFile(path, JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, memories: [] }));
    await fs.chmod(path, 0o000);
    try {
      // Running as root defeats the mode bits entirely; skip rather than assert a falsehood.
      let readable = true;
      try { await fs.readFile(path, "utf8"); } catch { readable = false; }
      if (readable) return;
      await assert.rejects(new FileStore(path).recall("anything"), (err: Error) => {
        assert.match(err.message, /permission denied/);
        assert.ok(err.message.includes(path));
        return true;
      });
    } finally {
      await fs.chmod(path, 0o644);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
