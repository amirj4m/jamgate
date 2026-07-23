import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileStore } from "../src/store/fileStore.js";
import { CURRENT_SCHEMA_VERSION, migrate } from "../src/store/schema.js";
import { DEFAULT_SCOPE, normalizeScope } from "../src/store/scope.js";
import { resolveTtlPolicy } from "../src/store/ttl.js";
import type { Memory } from "../src/store/types.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

const NO_GATE_LOG = { path: null, maxBytes: 0, maxTextChars: 0 } as const;

describe("scope normalization (D-048)", () => {
  it("folds case and whitespace, and maps absent/empty to the default", () => {
    assert.equal(normalizeScope("amir/greek"), "amir/greek");
    assert.equal(normalizeScope("  Amir/Greek "), "amir/greek");
    assert.equal(normalizeScope(""), DEFAULT_SCOPE);
    assert.equal(normalizeScope("   "), DEFAULT_SCOPE);
    assert.equal(normalizeScope(undefined), DEFAULT_SCOPE);
    assert.equal(normalizeScope(null), DEFAULT_SCOPE);
  });
});

describe("default-scope backward compatibility (D-048)", () => {
  it("a save with no scope reads back with no scope call AND under the default scope", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });

      // The three-argument recall every pre-namespace caller makes is unchanged.
      const legacyCall = await store.recall("Linux", 5);
      assert.equal(legacyCall.length, 1);
      // And it lives in the default namespace explicitly.
      const defaultScope = await store.recall("Linux", 5, false, DEFAULT_SCOPE);
      assert.equal(defaultScope.length, 1);
      assert.equal(defaultScope[0].text, "jam uses Linux");
      // The stored record carries the canonical default scope.
      assert.equal(defaultScope[0].scope, DEFAULT_SCOPE);
    } finally {
      await cleanup();
    }
  });

  it("an empty-string scope behaves identically to no scope", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Athens", source: "user-explicit", scope: "" });
      const hits = await store.recall("Athens", 5); // no scope arg
      assert.equal(hits.length, 1);
      assert.equal(hits[0].scope, DEFAULT_SCOPE);
    } finally {
      await cleanup();
    }
  });
});

describe("scope isolation (D-048)", () => {
  it("recall returns only memories in the requested scope", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "the aorist tense", source: "user-explicit", scope: "amir/greek" });
      await store.save({ text: "grep -r pattern .", source: "user-explicit", scope: "amir/linux" });

      const greek = await store.recall("", 10, false, "amir/greek");
      assert.deepEqual(greek.map((m) => m.text), ["the aorist tense"]);

      const linux = await store.recall("", 10, false, "amir/linux");
      assert.deepEqual(linux.map((m) => m.text), ["grep -r pattern ."]);

      // The default scope holds neither.
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await cleanup();
    }
  });

  it("the same exact text is NOT a duplicate across two scopes", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const a = await store.save({ text: "review due tomorrow", source: "user-explicit", scope: "amir/greek" });
      const b = await store.save({ text: "review due tomorrow", source: "user-explicit", scope: "amir/linux" });
      assert.equal(a.action, "created");
      assert.equal(b.action, "created", "a look-alike in another scope is a distinct memory");
      assert.notEqual(a.memory.id, b.memory.id);
    } finally {
      await cleanup();
    }
  });

  it("supersession by subject is confined to one scope", async () => {
    const { store, cleanup } = await tempStore();
    try {
      // Same subject "level" in two scopes must not interfere.
      await store.save({ text: "greek level A2", subject: "level", source: "user-explicit", scope: "amir/greek" });
      await store.save({ text: "linux level beginner", subject: "level", source: "user-explicit", scope: "amir/linux" });

      // Update the greek level: only the greek record is retired.
      const bump = await store.save({
        text: "greek level B1",
        subject: "level",
        source: "user-explicit",
        scope: "amir/greek",
      });
      assert.equal(bump.action, "superseded");
      assert.equal(bump.retired?.length, 1);

      const greek = await store.recall("", 10, false, "amir/greek");
      assert.deepEqual(greek.map((m) => m.text), ["greek level B1"]);
      const linux = await store.recall("", 10, false, "amir/linux");
      assert.deepEqual(linux.map((m) => m.text), ["linux level beginner"], "the other scope is untouched");
    } finally {
      await cleanup();
    }
  });

  it("the source-trust conflict guard is per scope", async () => {
    const { store, cleanup } = await tempStore();
    try {
      // A trusted fact on subject "goal" in greek must not block a guess on "goal" in linux.
      await store.save({ text: "pass the exam", subject: "goal", source: "user-explicit", scope: "amir/greek" });
      const other = await store.save({
        text: "learn systemd",
        subject: "goal",
        source: "agent-inferred",
        scope: "amir/linux",
      });
      assert.equal(other.action, "created", "the guard only sees the same scope's memories");
    } finally {
      await cleanup();
    }
  });
});

describe("forget is scoped (D-048)", () => {
  it("cannot delete a memory from another scope, even with the exact id", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const saved = await store.save({ text: "the middle voice", source: "user-explicit", scope: "amir/greek" });
      const id = saved.memory.id;

      // Wrong scope → not found; the memory survives.
      const wrong = await store.forget(id, "amir/linux");
      assert.deepEqual(wrong, { ok: false, reason: "not-found" });
      // Default scope → also not found.
      assert.deepEqual(await store.forget(id), { ok: false, reason: "not-found" });
      assert.equal((await store.recall("", 10, false, "amir/greek")).length, 1);

      // Right scope → deleted.
      assert.deepEqual(await store.forget(id, "amir/greek"), { ok: true, id });
      assert.equal((await store.recall("", 10, false, "amir/greek")).length, 0);
    } finally {
      await cleanup();
    }
  });
});

describe("schema v2→v3 scope migration (D-048)", () => {
  it("stamps the default scope on legacy records lacking one (bare array and envelope)", () => {
    const policy = resolveTtlPolicy({});
    const rec = (id: string, scope?: string): Memory =>
      ({
        id,
        text: `memory ${id}`,
        source: "user-explicit",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(scope ? { scope } : {}),
      }) as Memory;

    // Legacy v1 bare array → default scope backfilled.
    const v1 = migrate([rec("a")], policy);
    assert.equal(v1.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(v1.memories[0].scope, DEFAULT_SCOPE);

    // v2 envelope → default backfilled, but a record already in a named scope keeps it.
    const v2 = migrate({ schemaVersion: 2, memories: [rec("b"), rec("c", "amir/greek")] }, policy);
    assert.equal(v2.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(v2.memories.find((m) => m.id === "b")!.scope, DEFAULT_SCOPE);
    assert.equal(v2.memories.find((m) => m.id === "c")!.scope, "amir/greek");
  });

  it("through FileStore: an old file loads under the default scope and upgrades on write", async () => {
    const { path, cleanup } = await tempStore();
    try {
      // Pre-namespace file: a bare v1 array with no scope field.
      const old: Memory[] = [
        {
          id: "1",
          text: "jam lives in Berlin",
          source: "user-explicit",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Memory,
      ];
      await fs.writeFile(path, JSON.stringify(old, null, 2), "utf8");

      const store = new FileStore(path);
      // Visible under the default scope (and via the legacy no-scope call).
      assert.equal((await store.recall("Berlin", 5)).length, 1);
      assert.equal((await store.recall("Berlin", 5, false, DEFAULT_SCOPE)).length, 1);
      // Not visible from another scope.
      assert.equal((await store.recall("Berlin", 5, false, "amir/greek")).length, 0);

      // A named-scope save persists the upgraded, versioned format and stays isolated.
      await store.save({ text: "the dative case", source: "user-explicit", scope: "amir/greek" });
      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      assert.equal(onDisk.schemaVersion, CURRENT_SCHEMA_VERSION);
      const legacy = onDisk.memories.find((m: Memory) => m.id === "1");
      assert.equal(legacy.scope, DEFAULT_SCOPE, "the legacy record was migrated into the default scope");
    } finally {
      await cleanup();
    }
  });
});

describe("scope over the MCP tools (D-048)", () => {
  async function connected(store: Parameters<typeof createServer>[0]) {
    const server = createServer(store, NO_GATE_LOG);
    const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  }
  const textOf = (res: unknown) => (res as { content: Array<{ text: string }> }).content[0].text;

  it("save/recall/forget all honour the scope argument", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      await client.callTool({
        name: "save_memory",
        arguments: { text: "the genitive absolute", source: "user-explicit", scope: "amir/greek" },
      });

      // Recall in the same scope sees it.
      const inScope = textOf(await client.callTool({
        name: "recall_memory",
        arguments: { query: "genitive", scope: "amir/greek" },
      }));
      assert.match(inScope, /genitive absolute/);

      // Recall with no scope (the default namespace) does not.
      const defaultScope = textOf(await client.callTool({
        name: "recall_memory",
        arguments: { query: "genitive" },
      }));
      assert.match(defaultScope, /No matching memories/);

      // Forget needs the right scope; the wrong scope can't touch it.
      const [rec] = await store.recall("genitive", 5, false, "amir/greek");
      const wrong = textOf(await client.callTool({
        name: "forget_memory",
        arguments: { id: rec.id, scope: "amir/linux" },
      }));
      assert.match(wrong, /No memory with id/);
      assert.equal((await store.recall("", 10, false, "amir/greek")).length, 1);

      const right = textOf(await client.callTool({
        name: "forget_memory",
        arguments: { id: rec.id, scope: "amir/greek" },
      }));
      assert.match(right, /Forgotten/);
      assert.equal((await store.recall("", 10, false, "amir/greek")).length, 0);
    } finally {
      await close();
      await cleanup();
    }
  });
});
