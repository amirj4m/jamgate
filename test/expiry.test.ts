import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { saveThroughGate } from "../src/gate/pipeline.js";
import { createServer } from "../src/index.js";
import { startHttpServer } from "../src/http.js";
import type { GateLogConfig } from "../src/gate/log.js";
import { tempStore } from "./helpers.js";

const NO_LOG: GateLogConfig = { path: null, maxBytes: 0, maxTextChars: 0 };
const DAY = 24 * 60 * 60 * 1000;

/** Backdate a stored record so it is already expired, the way real time would. */
async function backdate(path: string, predicate: (text: string) => boolean, daysAgo: number) {
  const file = JSON.parse(await fs.readFile(path, "utf8"));
  for (const m of file.memories) {
    if (!predicate(m.text)) continue;
    const created = new Date(Date.now() - daysAgo * DAY).toISOString();
    m.createdAt = created;
    m.updatedAt = created;
    m.expiresAt = new Date(Date.now() - (daysAgo - 2) * DAY).toISOString();
  }
  await fs.writeFile(path, JSON.stringify(file), "utf8");
}

/**
 * D-055. Auditing the real production store found 17 of 39 live records — 44% — expired and
 * invisible to recall. Twelve were `user-explicit`: a human had said "remember this" and the
 * memory was unreachable two days later, with nothing in the reply, the log, or recall saying
 * so. The TTL is right; the silence was the bug.
 */
describe("a human-sourced memory never goes dark silently (D-055)", () => {
  it("warns when a user-explicit save gets a short TTL", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const outcome = await saveThroughGate(
        store,
        {
          text: "eFood pay structure: paid per delivery, settled every two weeks",
          type: "state",
          source: "user-explicit",
        },
        NO_LOG,
      );
      assert.equal(outcome.ok, true);
      const notices = outcome.ok ? outcome.notices : [];
      assert.equal(notices.length, 1, "a short-lived explicit save must produce a warning");
      assert.match(notices[0], /expires on \d{4}-\d{2}-\d{2}/);
      assert.match(notices[0], /identity|preference|project/);
    } finally {
      await cleanup();
    }
  });

  it("warns for user-confirmed too, but not for agent-inferred", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const confirmed = await saveThroughGate(
        store,
        { text: "jam is between apartments this week", type: "state", source: "user-confirmed" },
        NO_LOG,
      );
      assert.equal(confirmed.ok && confirmed.notices.length, 1);

      // An agent-inferred state note ageing out is the system working as designed; warning on
      // every one of those is noise that would train callers to ignore the warning.
      const inferred = await saveThroughGate(
        store,
        { text: "jam seems focused on the donate page today", type: "state", source: "agent-inferred" },
        NO_LOG,
      );
      assert.equal(inferred.ok && inferred.notices.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("does NOT warn for durable types, which is the whole point of the advice", async () => {
    const { store, cleanup } = await tempStore();
    try {
      for (const type of ["identity", "preference", "project"] as const) {
        const outcome = await saveThroughGate(
          store,
          { text: `jam has a lasting fact recorded as ${type} data`, type, source: "user-explicit" },
          NO_LOG,
        );
        assert.equal(outcome.ok && outcome.notices.length, 0, `${type} must not warn`);
      }
    } finally {
      await cleanup();
    }
  });

  it("the MCP tool shows the warning alongside the save, not instead of it", async () => {
    const { store, cleanup } = await tempStore();
    const server = createServer(store, NO_LOG);
    const client = new Client({ name: "expiry-test", version: "1" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const res = await client.callTool({
        name: "save_memory",
        arguments: {
          text: "jam's Eurobank card was lost in June 2026 and reissued",
          type: "state",
          source: "user-explicit",
        },
      });
      const text = (res.content as Array<{ text: string }>)[0].text;
      assert.match(text, /^Saved:/, "the save still succeeded and says so first");
      assert.match(text, /Note — .*expires on/);
      assert.equal((await store.recall("", 10)).length, 1, "the memory was really stored");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
    }
  });
});

describe("expired records are discoverable, not merely absent (D-055)", () => {
  it("listExpired reports what recall hides, with the compaction deadline", async () => {
    const { store, path, cleanup } = await tempStore();
    try {
      await store.save({ text: "a passing state worth two days", type: "state", source: "user-explicit" });
      await store.save({ text: "jam maintains an open-source memory gate", type: "project", source: "user-explicit" });
      await backdate(path, (t) => t.includes("passing state"), 10);

      assert.equal((await store.recall("", 10)).length, 1, "recall hides the expired one");
      const expired = await store.listExpired();
      assert.equal(expired.length, 1);
      assert.match(expired[0].memory.text, /passing state/);
      // Expired 8 days ago + 30 days grace → still rescuable, ~22 days from now.
      assert.ok(new Date(expired[0].compactableAt).getTime() > Date.now());
    } finally {
      await cleanup();
    }
  });

  it("listExpired is per scope, like everything else (D-048)", async () => {
    const { store, path, cleanup } = await tempStore();
    try {
      await store.save({ text: "greek scope passing note", type: "state", source: "user-explicit", scope: "amir/greek" });
      await store.save({ text: "linux scope passing note", type: "state", source: "user-explicit", scope: "amir/linux" });
      await backdate(path, () => true, 10);

      assert.equal((await store.listExpired("amir/greek")).length, 1);
      assert.match((await store.listExpired("amir/greek"))[0].memory.text, /greek/);
      assert.equal((await store.listExpired("amir/linux")).length, 1);
      assert.equal((await store.listExpired()).length, 0, "the default scope holds neither");
    } finally {
      await cleanup();
    }
  });

  it("recall_memory reports the hidden count — including when it finds nothing", async () => {
    // The empty answer is where a hidden record misleads most: "nothing is stored" and
    // "everything stored has aged out" look identical without this.
    const { store, path, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam's May 2026 income summary", type: "state", source: "user-explicit" });
      await backdate(path, () => true, 10);

      const server = createServer(store, NO_LOG);
      const client = new Client({ name: "expiry-recall", version: "1" }, { capabilities: {} });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      try {
        const res = await client.callTool({ name: "recall_memory", arguments: { query: "income" } });
        const text = (res.content as Array<{ text: string }>)[0].text;
        assert.match(text, /No matching memories\./);
        assert.match(text, /1 memory has expired/);
        assert.match(text, /jamgate expired/);
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      await cleanup();
    }
  });

  it("REST exposes the expired list and the hidden count", async () => {
    const { store, path, cleanup } = await tempStore();
    const running = await startHttpServer({ store, token: "t", port: 0, gateLog: NO_LOG });
    const base = `http://${running.host}:${running.port}/v1/memory`;
    const auth = { Authorization: "Bearer t" };
    try {
      await store.save({ text: "jam's efood income by period", type: "state", source: "user-explicit" });
      await store.save({ text: "jam maintains an open-source memory gate", type: "project", source: "user-explicit" });
      await backdate(path, (t) => t.includes("efood"), 10);

      const listed = await (await fetch(`${base}?expired=1`, { headers: auth })).json();
      assert.equal(listed.expired.length, 1);
      assert.match(listed.expired[0].memory.text, /efood/);
      assert.ok(listed.expired[0].compactableAt);
      assert.equal(listed.expired[0].memory.embedding, undefined, "still no vectors on the wire");

      const recalled = await (await fetch(`${base}?query=gate`, { headers: auth })).json();
      assert.equal(recalled.memories.length, 1);
      assert.equal(recalled.expiredHidden, 1);
    } finally {
      await running.close();
      await cleanup();
    }
  });
});
