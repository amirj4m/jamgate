import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { saveThroughGate } from "../src/gate/pipeline.js";
import { isMemorySource, isMemoryType, MEMORY_TYPES } from "../src/store/types.js";
import { isExpired } from "../src/store/ttl.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

const NO_LOG = { path: null, maxBytes: 0, maxTextChars: 0 };

/**
 * D-054. The `type` enum was declared to the model in the tool's `inputSchema` and enforced
 * nowhere, so an unrecognized value was cast straight through to the store. Auditing the real
 * production store found `type: "profile"` on a live record — and since `computeExpiresAt`
 * returns undefined for a type it does not recognize, that typo silently became "never
 * expires". The synthetic suite never caught it because every test passed a valid type.
 */
describe("memory type/source enums are enforced in code (D-054)", () => {
  it("recognizes exactly the four documented types", () => {
    assert.deepEqual([...MEMORY_TYPES], ["identity", "project", "preference", "state"]);
    for (const t of MEMORY_TYPES) assert.equal(isMemoryType(t), true);
    for (const bad of ["profile", "State", "", "identity ", 3, null, undefined, {}]) {
      assert.equal(isMemoryType(bad), false, `${JSON.stringify(bad)} must not be a type`);
    }
  });

  it("recognizes exactly the three documented sources", () => {
    for (const s of ["agent-inferred", "user-confirmed", "user-explicit"]) {
      assert.equal(isMemorySource(s), true);
    }
    for (const bad of ["user", "inferred", "", 1, null]) assert.equal(isMemorySource(bad), false);
  });

  it("refuses an unknown type, names the valid ones, and stores nothing", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const outcome = await saveThroughGate(
        store,
        { text: "jam lives in Athens, Greece", type: "profile", source: "user-explicit" },
        NO_LOG,
      );
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok === false && outcome.kind, "invalid_argument");
      assert.match(outcome.ok === false ? outcome.reason : "", /unknown type "profile"/);
      assert.match(outcome.ok === false ? outcome.reason : "", /identity, project, preference, state/);
      assert.equal((await store.recall("", 10)).length, 0, "nothing may be stored");
    } finally {
      await cleanup();
    }
  });

  it("refuses an unknown source", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const outcome = await saveThroughGate(
        store,
        { text: "jam lives in Athens, Greece", source: "user-said-so" },
        NO_LOG,
      );
      assert.equal(outcome.ok === false && outcome.kind, "invalid_argument");
      assert.match(outcome.ok === false ? outcome.reason : "", /unknown source/);
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await cleanup();
    }
  });

  it("a typo'd type cannot bypass TTL by becoming a permanent record", async () => {
    // The exact production failure: "state" mistyped is a 2-day memory that silently became
    // immortal. Prove the typo is refused AND that the correctly-typed save does expire.
    const { store, cleanup } = await tempStore();
    try {
      const typo = await saveThroughGate(
        store,
        { text: "jam is tired after a long delivery shift", type: "sate", source: "user-explicit" },
        NO_LOG,
      );
      assert.equal(typo.ok, false, "a typo'd type must never reach the store");
      assert.equal((await store.recall("", 10)).length, 0);

      const correct = await saveThroughGate(
        store,
        { text: "jam is tired after a long delivery shift", type: "state", source: "user-explicit" },
        NO_LOG,
      );
      assert.equal(correct.ok, true);
      const m = correct.ok ? correct.result.memory : null;
      assert.ok(m?.expiresAt, "a valid state memory must carry an expiry");
      // …and that expiry is real: it has passed a month later.
      assert.equal(isExpired(m.expiresAt, Date.now() + 31 * 24 * 60 * 60 * 1000), true);
    } finally {
      await cleanup();
    }
  });

  it("still accepts every valid type, and an absent type stays absent", async () => {
    const { store, cleanup } = await tempStore();
    try {
      for (const type of MEMORY_TYPES) {
        const outcome = await saveThroughGate(
          store,
          { text: `jam has a durable fact about ${type} handling`, type, source: "user-explicit" },
          NO_LOG,
        );
        assert.equal(outcome.ok, true, `valid type ${type} must be accepted`);
      }
      const untyped = await saveThroughGate(
        store,
        { text: "jam maintains an open-source memory gate", source: "user-explicit" },
        NO_LOG,
      );
      assert.equal(untyped.ok, true);
      assert.equal(untyped.ok && untyped.result.memory.type, undefined);
    } finally {
      await cleanup();
    }
  });

  it("the MCP tool answers a bad type as an ERROR, not as a gate verdict", async () => {
    // D-037's line: a usage error must not read as "the gate judged your memory and said no".
    const { store, cleanup } = await tempStore();
    const server = createServer(store, NO_LOG);
    const client = new Client({ name: "type-enum-test", version: "1" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const res = await client.callTool({
        name: "save_memory",
        arguments: { text: "jam lives in Athens, Greece", type: "profile" },
      });
      assert.equal(res.isError, true);
      const text = (res.content as Array<{ text: string }>)[0].text;
      assert.match(text, /save_memory failed/);
      assert.match(text, /unknown type "profile"/);
      assert.doesNotMatch(text, /Rejected by gate/);
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await client.close();
      await server.close();
      await cleanup();
    }
  });
});
