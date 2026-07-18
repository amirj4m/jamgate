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
