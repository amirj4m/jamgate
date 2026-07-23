import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";
import type { GateLogConfig } from "../src/gate/log.js";
import { tempStore } from "./helpers.js";

const TOKEN = "s3cret-token-for-tests";
const NO_GATE_LOG: GateLogConfig = { path: null, maxBytes: 0, maxTextChars: 0 };

/** Boot a real HTTP server on an ephemeral port over a fresh temp store, and expose the
 *  REST base URL (`http://host:port/v1/memory`). */
async function bootRest(): Promise<{
  running: RunningHttpServer;
  base: string;
  cleanup: () => Promise<void>;
}> {
  const { store, cleanup } = await tempStore();
  const running = await startHttpServer({ store, token: TOKEN, port: 0, gateLog: NO_GATE_LOG });
  const base = `http://${running.host}:${running.port}/v1/memory`;
  return {
    running,
    base,
    cleanup: async () => {
      await running.close();
      await cleanup();
    },
  };
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function post(base: string, body: unknown, token = TOKEN): Promise<Response> {
  return fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("REST API: auth gate (D-049)", () => {
  it("requires a bearer token on every REST method", async () => {
    const { base, cleanup } = await bootRest();
    try {
      assert.equal((await fetch(base)).status, 401); // GET, no header
      assert.equal((await fetch(base, { method: "POST" })).status, 401);
      const wrong = await fetch(base, { method: "GET", headers: { Authorization: "Bearer nope" } });
      assert.equal(wrong.status, 401);
    } finally {
      await cleanup();
    }
  });
});

describe("REST API: scoped CRUD (D-049)", () => {
  it("POST creates, GET recalls, DELETE forgets", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const created = await post(base, { text: "jam self-hosts jamgate", source: "user-explicit" });
      assert.equal(created.status, 201);
      const cbody = await created.json();
      assert.equal(cbody.action, "created");
      assert.equal(cbody.memory.text, "jam self-hosts jamgate");
      const id = cbody.memory.id as string;

      const recalled = await fetch(`${base}?query=jamgate`, { headers: auth });
      assert.equal(recalled.status, 200);
      const rbody = await recalled.json();
      assert.equal(rbody.memories.length, 1);
      assert.equal(rbody.memories[0].text, "jam self-hosts jamgate");

      const deleted = await fetch(`${base}/${id}`, { method: "DELETE", headers: auth });
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { ok: true, id });

      const after = await fetch(`${base}?query=jamgate`, { headers: auth });
      assert.deepEqual((await after.json()).memories, []);
    } finally {
      await cleanup();
    }
  });

  it("isolates memories by scope across the REST surface", async () => {
    const { base, cleanup } = await bootRest();
    try {
      await post(base, { text: "the aorist tense", source: "user-explicit", scope: "amir/greek" });
      await post(base, { text: "grep -r pattern .", source: "user-explicit", scope: "amir/linux" });

      const greek = await (await fetch(`${base}?scope=amir/greek`, { headers: auth })).json();
      assert.deepEqual(greek.memories.map((m: { text: string }) => m.text), ["the aorist tense"]);

      const linux = await (await fetch(`${base}?scope=amir/linux`, { headers: auth })).json();
      assert.deepEqual(linux.memories.map((m: { text: string }) => m.text), ["grep -r pattern ."]);

      // The default namespace holds neither.
      const dflt = await (await fetch(base, { headers: auth })).json();
      assert.deepEqual(dflt.memories, []);
    } finally {
      await cleanup();
    }
  });

  it("DELETE cannot cross a scope boundary", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const created = await (await post(base, {
        text: "the middle voice",
        source: "user-explicit",
        scope: "amir/greek",
      })).json();
      const id = created.memory.id as string;

      // Wrong scope → 404, memory survives.
      const wrong = await fetch(`${base}/${id}?scope=amir/linux`, { method: "DELETE", headers: auth });
      assert.equal(wrong.status, 404);
      const still = await (await fetch(`${base}?scope=amir/greek`, { headers: auth })).json();
      assert.equal(still.memories.length, 1);

      // Right scope → 200.
      const right = await fetch(`${base}/${id}?scope=amir/greek`, { method: "DELETE", headers: auth });
      assert.equal(right.status, 200);
    } finally {
      await cleanup();
    }
  });
});

describe("REST API: the gate applies (D-049)", () => {
  it("runs the prefilter — a too-short memory is rejected, nothing stored", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const res = await post(base, { text: "hm" });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.action, "rejected");
      assert.match(body.reason, /too short/);

      const all = await (await fetch(base, { headers: auth })).json();
      assert.deepEqual(all.memories, []);
    } finally {
      await cleanup();
    }
  });

  it("refuses a credential over REST, same as the MCP tool (D-042)", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const SECRET = "sk-" + "proj-Xk39fJdlWmQp2ZnR8sVtY7bL4cHgAe1N";
      const res = await post(base, { text: `my openai key is ${SECRET}` });
      const body = await res.json();
      assert.equal(body.action, "rejected");
      assert.match(body.reason, /credentials/);
      const all = await (await fetch(base, { headers: auth })).json();
      assert.deepEqual(all.memories, []);
    } finally {
      await cleanup();
    }
  });

  it("reports a recency supersede with 201 and action superseded", async () => {
    const { base, cleanup } = await bootRest();
    try {
      await post(base, { text: "jam uses Windows", subject: "operating-system", source: "user-explicit" });
      const bump = await post(base, {
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });
      assert.equal(bump.status, 201);
      assert.equal((await bump.json()).action, "superseded");
    } finally {
      await cleanup();
    }
  });
});

describe("REST API: error shapes (D-049)", () => {
  it("400 on a missing text field", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const res = await post(base, { type: "project" });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "invalid_request");
    } finally {
      await cleanup();
    }
  });

  it("400 on an unparseable JSON body", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const res = await fetch(base, { method: "POST", headers: auth, body: "{not json" });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "parse_error");
    } finally {
      await cleanup();
    }
  });

  it("404 on deleting an unknown id", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const res = await fetch(`${base}/does-not-exist`, { method: "DELETE", headers: auth });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, "not_found");
    } finally {
      await cleanup();
    }
  });

  it("405 on an unsupported method with an Allow header", async () => {
    const { base, cleanup } = await bootRest();
    try {
      const res = await fetch(base, { method: "PUT", headers: auth });
      assert.equal(res.status, 405);
      assert.match(res.headers.get("allow") ?? "", /POST/);
    } finally {
      await cleanup();
    }
  });
});

describe("REST API: default-scope backward compatibility (D-049)", () => {
  it("a scope-less POST is recalled by a scope-less GET", async () => {
    const { base, cleanup } = await bootRest();
    try {
      await post(base, { text: "jam ships on Fridays", source: "user-explicit" });
      const body = await (await fetch(`${base}?query=Fridays`, { headers: auth })).json();
      assert.equal(body.memories.length, 1);
      assert.match(body.memories[0].text, /Fridays/);
    } finally {
      await cleanup();
    }
  });
});
