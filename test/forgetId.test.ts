import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

const NO_LOG = { path: null, maxBytes: 0, maxTextChars: 0 };

async function connected(store: Parameters<typeof createServer>[0]) {
  const server = createServer(store, NO_LOG);
  const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
  };
  return res.content[0].text;
}

describe("forget_memory accepts the id recall_memory printed (D-041)", () => {
  it("round-trips save → recall → forget using the id parsed out of the listing", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      await call(client, "save_memory", {
        text: "jam's LPIC-1 exam target is 9 September 2026",
        source: "user-explicit",
        subject: "lpic-target",
      });

      const listing = await call(client, "recall_memory", { query: "LPIC" });
      // The id must appear on its own line, whole, with no trailing punctuation — this is
      // exactly what an agent copies.
      const line = listing.split("\n").find((l) => l.trim().startsWith("id:"));
      assert.ok(line, `recall output has a dedicated id line:\n${listing}`);
      const id = line.trim().slice("id:".length).trim();
      assert.match(id, /^[0-9a-f-]{36}$/, "the full uuid, not truncated");

      assert.match(await call(client, "forget_memory", { id }), /forgotten/i);
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await close();
      await cleanup();
    }
  });

  it("resolves an 8+ character prefix and tolerates copy noise", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      const { memory } = await store.save({ text: "a fact to forget", source: "user-explicit" });
      // A shortened, comma-suffixed, backticked copy — all the shapes an LLM produces.
      const noisy = "`" + memory.id.slice(0, 12) + "`,";
      assert.match(await call(client, "forget_memory", { id: noisy }), /forgotten/i);
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await close();
      await cleanup();
    }
  });

  it("refuses an ambiguous prefix rather than guessing which memory to delete", async () => {
    const { store, cleanup } = await tempStore();
    try {
      // Two records deliberately sharing an id prefix — importBatch keeps original ids.
      const shared = "abcdef12";
      const stamp = "2026-07-21T10:00:00.000Z";
      await store.importBatch([
        {
          id: `${shared}-0000-4000-8000-000000000001`,
          text: "first fact",
          source: "user-explicit",
          status: "active",
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${shared}-0000-4000-8000-000000000002`,
          text: "second fact",
          source: "user-explicit",
          status: "active",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);
      assert.equal((await store.recall("", 10)).length, 2);

      const res = await store.forget(shared);
      assert.equal(res.ok, false);
      assert.equal(res.ok === false && res.reason, "ambiguous");
      assert.equal(res.ok === false && res.reason === "ambiguous" && res.matches.length, 2);
      assert.equal((await store.recall("", 10)).length, 2, "nothing was deleted");
    } finally {
      await cleanup();
    }
  });

  it("rejects a too-short prefix instead of matching loosely", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const { memory } = await store.save({ text: "keep me", source: "user-explicit" });
      const res = await store.forget(memory.id.slice(0, 4));
      assert.equal(res.ok, false);
      assert.equal(res.ok === false && res.reason, "not-found");
      assert.equal((await store.recall("", 10)).length, 1);
    } finally {
      await cleanup();
    }
  });
});
