import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";
import { resolveGateLogConfig } from "../src/gate/log.js";
import { tempStore } from "./helpers.js";

/** Drive the real MCP handlers over an in-memory transport, with the gate log disabled so
 *  tests never touch a real ~/.jamgate directory. */
async function connected(store: Parameters<typeof createServer>[0]) {
  const server = createServer(store, { path: null, maxBytes: 0, maxTextChars: 0 });
  const client = new Client({ name: "cowork", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: () => Promise.all([client.close(), server.close()]),
  };
}

async function save(client: Client, args: Record<string, unknown>) {
  const res = (await client.callTool({ name: "save_memory", arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: res.isError === true, text: res.content[0].text };
}

// A memory long enough that "too short" could never be an honest answer — the shape of the
// production report that prompted this (D-037).
const LONG_TEXT =
  "The user is architecting a cross-agent memory system called Jamgate. ".repeat(25);

describe("save_memory argument validation (D-037)", () => {
  it("saves a long memory over the MCP tool path", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      assert.ok(LONG_TEXT.length > 1500, "fixture is a realistically long memory");
      const { isError, text } = await save(client, {
        text: LONG_TEXT,
        type: "project",
        subject: "jamgate-project",
      });
      assert.equal(isError, false, text);
      assert.match(text, /^Saved:/);
      const stored = await store.exportAll();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].text, LONG_TEXT.trim(), "the full text is stored, not truncated");
    } finally {
      await close();
      await cleanup();
    }
  });

  it('never answers "too short" when the text argument is missing', async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      const { isError, text } = await save(client, {});
      assert.equal(isError, true, "a usage error is flagged as an error, not a verdict");
      assert.doesNotMatch(text, /too short/, "the old, misleading answer is gone");
      assert.match(text, /"text" is required and must be a non-empty string/);
      assert.match(text, /no arguments were provided/);
      assert.equal((await store.exportAll()).length, 0, "nothing was saved");
    } finally {
      await close();
      await cleanup();
    }
  });

  it("names the keys it did receive when text is misnamed", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      // The likely real-world cause: a client sending the memory under another field.
      const { isError, text } = await save(client, { content: LONG_TEXT, type: "project" });
      assert.equal(isError, true);
      assert.doesNotMatch(text, /too short/);
      assert.match(text, /received keys: content, type/, "the caller can see what arrived");
    } finally {
      await close();
      await cleanup();
    }
  });

  it("rejects a non-string text instead of storing [object Object]", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      // A client wrapping the memory in a content block used to save the literal
      // "[object Object]" through the gate — junk, silently, with a success message.
      const { isError, text } = await save(client, { text: { type: "text", text: LONG_TEXT } });
      assert.equal(isError, true);
      assert.match(text, /"text" was object, not a string/);
      const stored = await store.exportAll();
      assert.equal(stored.length, 0);
      assert.ok(
        !stored.some((m) => m.text.includes("[object Object]")),
        "no stringified object reaches the store",
      );
    } finally {
      await close();
      await cleanup();
    }
  });

  it("still rejects a genuinely short memory — and says how short", async () => {
    const { store, cleanup } = await tempStore();
    const { client, close } = await connected(store);
    try {
      const { isError, text } = await save(client, { text: "hm" });
      assert.equal(isError, false, "a real gate verdict is not a usage error");
      assert.match(text, /Rejected by gate: too short \(2 characters, minimum 4\)/);
    } finally {
      await close();
      await cleanup();
    }
  });
});

describe("gate log location on hardened deployments (D-037)", () => {
  it("defaults next to the store, not to an unwritable home directory", () => {
    // systemd `ProtectHome=true` made ~/.jamgate unwritable on the droplet, so every gate
    // log append failed silently — and the audit trail was empty exactly when a production
    // bug needed it.
    const config = resolveGateLogConfig({ JAMGATE_STORE: "/var/lib/jamgate/memory.json" });
    assert.equal(config.path, "/var/lib/jamgate/gate.log");
  });

  it("lets an explicit JAMGATE_GATE_LOG win over the store directory", () => {
    const config = resolveGateLogConfig({
      JAMGATE_STORE: "/var/lib/jamgate/memory.json",
      JAMGATE_GATE_LOG: "/tmp/elsewhere.log",
    });
    assert.equal(config.path, "/tmp/elsewhere.log");
  });

  it("still honors the off switch", () => {
    const config = resolveGateLogConfig({
      JAMGATE_STORE: "/var/lib/jamgate/memory.json",
      JAMGATE_GATE_LOG: "off",
    });
    assert.equal(config.path, null);
  });

  it("falls back to the home directory when no store path is set", () => {
    const config = resolveGateLogConfig({});
    assert.match(config.path ?? "", /\.jamgate[/\\]gate\.log$/);
  });
});
