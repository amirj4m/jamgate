import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileStore } from "../src/store/fileStore.js";
import {
  bearerTokenMatches,
  parseCliOptions,
  startHttpServer,
  type RunningHttpServer,
} from "../src/http.js";
import type { GateLogConfig } from "../src/gate/log.js";
import { VERSION } from "../src/version.js";
import { tempStore } from "./helpers.js";

const TOKEN = "s3cret-token-for-tests";
// Disable the gate log so no test ever writes to the real ~/.jamgate directory.
const NO_GATE_LOG: GateLogConfig = { path: null, maxBytes: 0, maxTextChars: 0 };

/** Boot a real HTTP server on an ephemeral port over a fresh temp store. */
async function bootServer(token = TOKEN): Promise<{
  running: RunningHttpServer;
  url: string;
  storePath: string;
  store: FileStore;
  cleanup: () => Promise<void>;
}> {
  const { store, path, cleanup } = await tempStore();
  const running = await startHttpServer({ store, token, port: 0, gateLog: NO_GATE_LOG });
  const url = `http://${running.host}:${running.port}${running.path}`;
  return {
    running,
    url,
    storePath: path,
    store,
    cleanup: async () => {
      await running.close();
      await cleanup();
    },
  };
}

/** Connect a real MCP client over Streamable HTTP with the given bearer token. */
async function connectClient(
  url: string,
  token: string,
  clientInfo = { name: "claude-code", version: "1.0.0" },
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client(clientInfo, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("CLI option parsing (parseCliOptions)", () => {
  it("defaults to stdio (http false) with the default port", () => {
    const opts = parseCliOptions([], {});
    assert.equal(opts.http, false);
    assert.equal(opts.port, 8420);
  });

  it("enables http via the --http flag", () => {
    assert.equal(parseCliOptions(["--http"], {}).http, true);
  });

  it("enables http via a truthy JAMGATE_HTTP env var", () => {
    assert.equal(parseCliOptions([], { JAMGATE_HTTP: "1" }).http, true);
    assert.equal(parseCliOptions([], { JAMGATE_HTTP: "true" }).http, true);
    assert.equal(parseCliOptions([], { JAMGATE_HTTP: "off" }).http, false);
    assert.equal(parseCliOptions([], { JAMGATE_HTTP: "" }).http, false);
  });

  it("reads the port from --port, preferring it over the env", () => {
    assert.equal(parseCliOptions(["--port", "9000"], { JAMGATE_PORT: "1234" }).port, 9000);
  });

  it("reads the port from JAMGATE_PORT when no flag is given", () => {
    assert.equal(parseCliOptions([], { JAMGATE_PORT: "1234" }).port, 1234);
  });

  it("honors the platform PORT env when no flag or JAMGATE_PORT is set", () => {
    assert.equal(parseCliOptions([], { PORT: "3000" }).port, 3000);
  });

  it("prefers JAMGATE_PORT over the platform PORT", () => {
    assert.equal(parseCliOptions([], { JAMGATE_PORT: "1234", PORT: "3000" }).port, 1234);
  });

  it("prefers --port over both JAMGATE_PORT and PORT", () => {
    assert.equal(parseCliOptions(["--port", "9000"], { JAMGATE_PORT: "1234", PORT: "3000" }).port, 9000);
  });

  it("falls back to the default port on an invalid value", () => {
    assert.equal(parseCliOptions(["--port", "not-a-number"], {}).port, 8420);
    assert.equal(parseCliOptions(["--port", "70000"], {}).port, 8420);
    assert.equal(parseCliOptions([], { JAMGATE_PORT: "-1" }).port, 8420);
    assert.equal(parseCliOptions([], { PORT: "not-a-number" }).port, 8420);
  });
});

describe("bearer token check (bearerTokenMatches)", () => {
  it("accepts the exact token behind a Bearer prefix", () => {
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  });

  it("rejects a missing header", () => {
    assert.equal(bearerTokenMatches(undefined, TOKEN), false);
    assert.equal(bearerTokenMatches("", TOKEN), false);
  });

  it("rejects a header without the Bearer prefix", () => {
    assert.equal(bearerTokenMatches(TOKEN, TOKEN), false);
    assert.equal(bearerTokenMatches(`Basic ${TOKEN}`, TOKEN), false);
  });

  it("rejects a wrong token, including one that differs only in length", () => {
    assert.equal(bearerTokenMatches("Bearer wrong", TOKEN), false);
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), false);
  });
});

describe("HTTP transport: auth gate (raw requests)", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, { method: "POST" });
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
    } finally {
      await cleanup();
    }
  });

  it("returns 401 when the token is wrong", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer nope" },
      });
      assert.equal(res.status, 401);
    } finally {
      await cleanup();
    }
  });

  it("passes the auth gate with the right token (400 on a session-less GET, not 401)", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      // Authenticated, but a GET with no session id can't open a stream → 400, not 401.
      assert.equal(res.status, 400);
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for an authenticated request to the wrong path", async () => {
    const { running, cleanup } = await bootServer();
    try {
      const wrong = `http://${running.host}:${running.port}/nope`;
      const res = await fetch(wrong, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(res.status, 404);
    } finally {
      await cleanup();
    }
  });
});

describe("HTTP transport: health check (/healthz)", () => {
  it("answers 200 with status + version and requires no auth", async () => {
    const { running, cleanup } = await bootServer();
    try {
      const healthUrl = `http://${running.host}:${running.port}/healthz`;
      const res = await fetch(healthUrl); // no Authorization header on purpose
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/json");
      const body = await res.json();
      assert.deepEqual(body, { status: "ok", version: VERSION });
    } finally {
      await cleanup();
    }
  });

  it("exposes no memory data — the body is only status + version", async () => {
    const { url, running, store, cleanup } = await bootServer();
    let client: Client | undefined;
    try {
      // Put a real memory in the store, then confirm the health payload can't leak it.
      ({ client } = await connectClient(url, TOKEN));
      await client.callTool({
        name: "save_memory",
        arguments: { text: "jam keeps a secret memory", source: "user-explicit" },
      });
      await store.recall("secret", 5); // sanity: it is really stored

      const res = await fetch(`http://${running.host}:${running.port}/healthz`);
      const raw = await res.text();
      assert.doesNotMatch(raw, /secret/);
      assert.deepEqual(JSON.parse(raw), { status: "ok", version: VERSION });
    } finally {
      if (client) await client.close();
      await cleanup();
    }
  });

  it("rejects a non-GET method on /healthz with 405", async () => {
    const { running, cleanup } = await bootServer();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/healthz`, { method: "POST" });
      assert.equal(res.status, 405);
      assert.match(res.headers.get("allow") ?? "", /GET/);
    } finally {
      await cleanup();
    }
  });
});

describe("HTTP transport: MCP round-trip", () => {
  it("connects, lists the three tools, and saves + recalls over HTTP", async () => {
    const { url, cleanup } = await bootServer();
    let client: Client | undefined;
    try {
      ({ client } = await connectClient(url, TOKEN));

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["forget_memory", "recall_memory", "save_memory"]);

      const saved = await client.callTool({
        name: "save_memory",
        arguments: { text: "jam self-hosts jamgate on a droplet", source: "user-explicit" },
      });
      const savedText = (saved.content as Array<{ text: string }>)[0].text;
      assert.match(savedText, /^Saved:/);

      const recalled = await client.callTool({
        name: "recall_memory",
        arguments: { query: "droplet" },
      });
      const recalledText = (recalled.content as Array<{ text: string }>)[0].text;
      assert.match(recalledText, /self-hosts jamgate/);
    } finally {
      if (client) await client.close();
      await cleanup();
    }
  });

  it("rejects a real MCP client connect when the token is wrong", async () => {
    const { url, cleanup } = await bootServer();
    try {
      await assert.rejects(connectClient(url, "the-wrong-token"));
    } finally {
      await cleanup();
    }
  });

  it("stamps client provenance from the HTTP initialize handshake (D-024 over HTTP)", async () => {
    const { url, store, cleanup } = await bootServer();
    let client: Client | undefined;
    try {
      ({ client } = await connectClient(url, TOKEN, { name: "cursor", version: "4.5.6" }));
      await client.callTool({
        name: "save_memory",
        arguments: { text: "jam ships on Fridays over http", source: "user-explicit" },
      });
      const [stored] = await store.recall("Fridays", 5);
      assert.equal(stored.client?.name, "cursor");
      assert.equal(stored.client?.version, "4.5.6");
    } finally {
      if (client) await client.close();
      await cleanup();
    }
  });
});

describe("HTTP transport: concurrent sessions share one store safely", () => {
  it("two simultaneous HTTP sessions saving at once lose no writes", async () => {
    const { url, storePath, cleanup } = await bootServer();
    let a: Client | undefined;
    let b: Client | undefined;
    try {
      ({ client: a } = await connectClient(url, TOKEN, { name: "app-phone", version: "1.0.0" }));
      ({ client: b } = await connectClient(url, TOKEN, { name: "app-laptop", version: "1.0.0" }));

      // Both sessions fire many distinct saves at once through the one shared FileStore.
      // The Phase 2 lock + re-read-before-write must serialize them without dropping any.
      const calls: Promise<unknown>[] = [];
      for (let i = 0; i < 12; i++) {
        calls.push(
          a.callTool({
            name: "save_memory",
            arguments: { text: `phone fact ${i}`, source: "user-explicit" },
          }),
        );
        calls.push(
          b.callTool({
            name: "save_memory",
            arguments: { text: `laptop fact ${i}`, source: "user-explicit" },
          }),
        );
      }
      await Promise.all(calls);

      // Read the underlying store directly: every distinct fact must have persisted once.
      const all = await new FileStore(storePath).recall("", 100);
      assert.equal(all.length, 24, "no concurrent write may be lost");
      assert.equal(new Set(all.map((m) => m.text)).size, 24, "each fact persisted exactly once");
    } finally {
      if (a) await a.close();
      if (b) await b.close();
      await cleanup();
    }
  });
});

/**
 * Session resilience across a server restart (D-038).
 *
 * Sessions live in process memory, so every deploy invalidates every session id the clients
 * out there are still holding. The spec's recovery path is a status code: an unknown
 * `Mcp-Session-Id` MUST get 404, which is what tells a client to re-initialize. We answered
 * 400, which reads as "bad request" — so claude.ai stayed wedged on a dead session for the
 * rest of the conversation. These tests pin the 404 down, and pin down that it is not
 * conflated with the *missing*-session-id case (still 400) or masked by the auth gate.
 */
describe("HTTP transport: session expiry after a restart", () => {
  const INIT_BODY = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "1.0.0" },
    },
  };
  const MCP_HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  /** Raw initialize over fetch, so the test controls the session id by hand afterwards. */
  async function rawInitialize(
    url: string,
    token: string,
    sessionId?: string,
  ): Promise<{ status: number; sessionId: string | null }> {
    const headers: Record<string, string> = {
      ...MCP_HEADERS,
      Authorization: `Bearer ${token}`,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(INIT_BODY) });
    await res.text(); // drain the response stream so the socket can close
    return { status: res.status, sessionId: res.headers.get("mcp-session-id") };
  }

  /** A tools/list POST carrying an explicit session id. */
  function rawCall(url: string, token: string, sessionId: string): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${token}`, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
  }

  const DEAD = "11111111-2222-3333-4444-555555555555";

  it("answers 404 — not 400 — to a POST carrying an unknown session id", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await rawCall(url, TOKEN, DEAD);
      assert.equal(res.status, 404, "404 is what tells a conforming client to re-initialize");
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("explains in the 404 body that the client should re-initialize", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await rawCall(url, TOKEN, DEAD);
      const body = await res.json();
      assert.equal(body.jsonrpc, "2.0");
      assert.match(body.error.message, /initialize/i);
      assert.match(body.error.message, /expired|unknown/i);
    } finally {
      await cleanup();
    }
  });

  it("answers 404 to a GET (SSE stream) with an unknown session id", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${TOKEN}`, "mcp-session-id": DEAD },
      });
      assert.equal(res.status, 404);
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("answers 404 to a DELETE with an unknown session id", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TOKEN}`, "mcp-session-id": DEAD },
      });
      assert.equal(res.status, 404);
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("still answers 400 when there is no session id at all (a different bug)", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      assert.equal(res.status, 400, "missing session id is 400 per spec; expired is 404");
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("does not let the auth gate mask it: valid token + dead session is 404, never 401", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await rawCall(url, TOKEN, DEAD);
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("www-authenticate"), null);
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("keeps auth first: a WRONG token with a dead session is still 401, not 404", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const res = await rawCall(url, "the-wrong-token", DEAD);
      assert.equal(res.status, 401, "a dead session must never become an auth bypass oracle");
      await res.text();
    } finally {
      await cleanup();
    }
  });

  it("accepts an initialize that still carries a stale session id, issuing a fresh one", async () => {
    const { url, cleanup } = await bootServer();
    try {
      const { status, sessionId } = await rawInitialize(url, TOKEN, DEAD);
      assert.equal(status, 200);
      assert.ok(sessionId, "a new session id must be issued");
      assert.notEqual(sessionId, DEAD);
    } finally {
      await cleanup();
    }
  });

  it("survives a real restart: old session 404s, then a fresh session saves to the same store", async () => {
    // Server A — the instance the client originally handshook with.
    const { store, path, cleanup } = await tempStore();
    const a = await startHttpServer({ store, token: TOKEN, port: 0, gateLog: NO_GATE_LOG });
    const urlA = `http://${a.host}:${a.port}${a.path}`;
    const { sessionId } = await rawInitialize(urlA, TOKEN);
    assert.ok(sessionId, "server A issued a session id");

    // The deploy: the process goes away and comes back over the same store on the same port.
    await a.close();
    const b = await startHttpServer({
      store: new FileStore(path),
      token: TOKEN,
      port: a.port,
      gateLog: NO_GATE_LOG,
    });
    const urlB = `http://${b.host}:${b.port}${b.path}`;

    let client: Client | undefined;
    try {
      // The client is still holding the pre-restart session id. This is the wedged state.
      const stale = await rawCall(urlB, TOKEN, sessionId!);
      assert.equal(stale.status, 404, "the restarted server must tell the client to re-initialize");
      await stale.text();

      // Which is what a conforming client does next — and it must be fully working again.
      ({ client } = await connectClient(urlB, TOKEN));
      const saved = await client.callTool({
        name: "save_memory",
        arguments: { text: "jam redeployed jamgate mid-conversation", source: "user-explicit" },
      });
      assert.match((saved.content as Array<{ text: string }>)[0].text, /^Saved:/);

      // And the memory really landed in the shared store, not just in the response.
      const [stored] = await new FileStore(path).recall("redeployed", 5);
      assert.match(stored.text, /redeployed jamgate/);
    } finally {
      if (client) await client.close();
      await b.close();
      await cleanup();
    }
  });
});
