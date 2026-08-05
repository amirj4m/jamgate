import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";
import type { GateLogConfig } from "../src/gate/log.js";
import { FileStore } from "../src/store/fileStore.js";
import type { Embedder } from "../src/embeddings/embedder.js";
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

describe("REST API: errors answer in the REST envelope, never JSON-RPC (D-051)", () => {
  // The auth gate runs BEFORE routing and the 404 fall-through runs after it, so both used to
  // hand a JSON-RPC error to REST callers — making the two most common failures the only ones
  // whose shape didn't match the contract D-049 documents (`error` a string, plus `message`).
  const assertRestShape = (body: Record<string, unknown>) => {
    assert.equal(typeof body.error, "string", "`error` must be a machine-readable string");
    assert.equal(typeof body.message, "string", "`message` must be a human-readable string");
    assert.equal(body.jsonrpc, undefined, "a REST response must not carry a jsonrpc envelope");
  };

  it("401 on a REST path is REST-shaped (and still sends WWW-Authenticate)", async () => {
    const { base, cleanup } = await bootRest();
    try {
      for (const init of [
        { method: "GET" },
        { method: "POST", body: "{}" },
        { method: "DELETE" },
      ] as const) {
        const res = await fetch(`${base}${init.method === "DELETE" ? "/some-id" : ""}`, init);
        assert.equal(res.status, 401);
        assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
        const body = await res.json();
        assertRestShape(body);
        assert.equal(body.error, "unauthorized");
      }
    } finally {
      await cleanup();
    }
  });

  it("401 on the MCP path keeps its JSON-RPC envelope", async () => {
    // The fix must not leak the other way: an MCP client still needs a JSON-RPC error.
    const { running, cleanup } = await bootRest();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/mcp`, { method: "POST" });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.error.code, -32001);
    } finally {
      await cleanup();
    }
  });

  it("404 on an unrouted /v1/ path names the REST routes, not the MCP endpoint", async () => {
    const { running, cleanup } = await bootRest();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/v1/nope`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assertRestShape(body);
      assert.match(body.message as string, /\/v1\/memory/);
      assert.doesNotMatch(body.message as string, /MCP/);
    } finally {
      await cleanup();
    }
  });

  it("a forget miss names the scope it searched", async () => {
    // Forget is strictly scoped (D-048), so the likeliest cause of a miss is a scope mismatch,
    // not a bad id — a message that never mentions scope sends the caller to re-check the id.
    const { base, cleanup } = await bootRest();
    try {
      const res = await fetch(`${base}/00000000-0000-0000-0000-000000000000?scope=amir/greek`, {
        method: "DELETE",
        headers: auth,
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, "not_found");
      assert.match(body.message as string, /amir\/greek/);
    } finally {
      await cleanup();
    }
  });
});

describe("REST API: responses never carry the embedding vector (D-051)", () => {
  /** A store with a real (if trivial) embedder, so saved records actually carry a vector —
   *  which is the only way to prove the wire form drops it. */
  async function bootWithEmbeddings(): Promise<{ base: string; cleanup: () => Promise<void> }> {
    const embedder: Embedder = {
      id: "test-embedder",
      dimensions: 4,
      async embed(text: string) {
        const v = [0, 0, 0, 0];
        for (let i = 0; i < text.length; i++) v[i % 4] += text.charCodeAt(i) / 1000;
        return v;
      },
    };
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-rest-embed-"));
    const path = join(dir, "memory.json");
    const store = new FileStore(path, { embedder });
    const running = await startHttpServer({ store, token: TOKEN, port: 0, gateLog: NO_GATE_LOG });
    return {
      base: `http://${running.host}:${running.port}/v1/memory`,
      cleanup: async () => {
        await running.close();
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  it("strips the embedding from POST and GET, while keeping it on disk", async () => {
    const { base, cleanup } = await bootWithEmbeddings();
    try {
      const created = await post(base, { text: "jam runs the gate locally", source: "user-explicit" });
      const cbody = await created.json();
      assert.equal(cbody.action, "created");
      assert.equal(cbody.memory.embedding, undefined, "POST must not return the vector");
      assert.equal(cbody.memory.text, "jam runs the gate locally"); // the rest of the record survives

      const recalled = await (await fetch(`${base}?query=gate`, { headers: auth })).json();
      assert.equal(recalled.memories.length, 1);
      assert.equal(recalled.memories[0].embedding, undefined, "GET must not return the vector");
      assert.equal(recalled.memories[0].id, cbody.memory.id);
    } finally {
      await cleanup();
    }
  });

  it("strips the embedding from the retired records of a supersede", async () => {
    const { base, cleanup } = await bootWithEmbeddings();
    try {
      await post(base, { text: "jam uses Windows", subject: "operating-system", source: "user-explicit" });
      const res = await post(base, {
        text: "jam moved to Linux",
        subject: "operating-system",
        source: "user-explicit",
      });
      const body = await res.json();
      assert.equal(body.action, "superseded");
      assert.equal(body.memory.embedding, undefined);
      assert.equal(body.retired.length, 1);
      assert.equal(body.retired[0].embedding, undefined, "retired records must be stripped too");
      assert.match(body.retired[0].text, /Windows/);
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
