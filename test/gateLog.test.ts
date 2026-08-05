import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  appendGateLog,
  resolveGateLogConfig,
  type GateLogConfig,
} from "../src/gate/log.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

async function tempLog(): Promise<{ path: string; config: GateLogConfig; dir: string }> {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-log-"));
  const path = join(dir, "gate.log");
  return { path, dir, config: { path, maxBytes: 1_000_000, maxTextChars: 500 } };
}

async function readLines(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(path, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("gate decision log (D-025)", () => {
  it("appends one JSONL record per decision with a timestamp", async () => {
    const { path, dir, config } = await tempLog();
    try {
      await appendGateLog({ decision: "saved", text: "jam uses linux", source: "user-explicit" }, config);
      await appendGateLog({ decision: "rejected", reason: "too short", text: "hi" }, config);

      const lines = await readLines(path);
      assert.equal(lines.length, 2);
      assert.equal(lines[0].decision, "saved");
      assert.equal(lines[0].text, "jam uses linux");
      assert.equal(lines[0].source, "user-explicit");
      assert.ok(typeof lines[0].ts === "string" && (lines[0].ts as string).includes("T"));
      assert.equal(lines[1].decision, "rejected");
      assert.equal(lines[1].reason, "too short");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("omits empty optional fields", async () => {
    const { path, dir, config } = await tempLog();
    try {
      await appendGateLog({ decision: "saved", text: "jam uses linux" }, config);
      const [line] = await readLines(path);
      assert.equal("reason" in line, false);
      assert.equal("subject" in line, false);
      assert.equal("client" in line, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("truncates long text to bound line size", async () => {
    const { path, dir, config } = await tempLog();
    try {
      const long = "x".repeat(2000);
      await appendGateLog({ decision: "saved", text: long }, { ...config, maxTextChars: 100 });
      const [line] = await readLines(path);
      const text = line.text as string;
      assert.ok(text.length <= 101, `text should be truncated, was ${text.length}`);
      assert.ok(text.endsWith("…"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when logging is disabled (path null)", async () => {
    const { path, dir } = await tempLog();
    try {
      await appendGateLog(
        { decision: "saved", text: "jam uses linux" },
        { path: null, maxBytes: 0, maxTextChars: 0 },
      );
      await assert.rejects(fs.stat(path), /ENOENT/, "no log file should be created");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rotates to <path>.1 once the size cap is exceeded", async () => {
    const { path, dir, config } = await tempLog();
    try {
      const smallCap: GateLogConfig = { ...config, maxBytes: 200 };
      // First few writes fill the file; a later write trips rotation.
      for (let i = 0; i < 20; i++) {
        await appendGateLog({ decision: "saved", text: `memory number ${i}` }, smallCap);
      }
      const rotated = await fs.stat(`${path}.1`).then(() => true, () => false);
      assert.ok(rotated, "a rotated log file <path>.1 should exist");
      // The live log still exists and is under (roughly) the cap after rotation.
      const { size } = await fs.stat(path);
      assert.ok(size < 200 + 100, `live log should be small after rotation, was ${size}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("logs decisions end-to-end when driven through the MCP server", async () => {
    const { store, cleanup } = await tempStore();
    const { path, dir, config } = await tempLog();
    const server = createServer(store, config);
    const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);

      await client.callTool({ name: "save_memory", arguments: { text: "jam lives in berlin" } });
      await client.callTool({ name: "save_memory", arguments: { text: "hi" } }); // rejected: pleasantry-ish/short

      const lines = await readLines(path);
      assert.equal(lines.length, 2);
      assert.equal(lines[0].decision, "saved");
      assert.equal(lines[0].client, "claude-code");
      assert.equal(lines[1].decision, "rejected");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("never writes a refused credential into the log (D-042)", async () => {
    // The gate log is a plaintext training buffer that outlives the save. Refusing to STORE
    // a secret while LOGGING it verbatim would move the secret, not protect it — so a
    // redacted rejection keeps its decision and reason (what the classifier learns from)
    // and drops the text.
    const { store, cleanup } = await tempStore();
    const { path, dir, config } = await tempLog();
    const server = createServer(store, config);
    const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    // Assembled at runtime, not committed as a literal: a credential-shaped string in a
    // source file trips GitHub's push protection, and a test fixture is not worth an
    // allowlist entry. See the note in test/secrets.test.ts.
    const SECRET = "sk-" + "proj-Xk39fJdlWmQp2ZnR8sVtY7bL4cHgAe1N";
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      const res = await client.callTool({
        name: "save_memory",
        arguments: { text: `my openai key is ${SECRET}` },
      });

      // The caller is told why, in terms it can act on.
      const reply = JSON.stringify(res.content);
      assert.match(reply, /refusing to store credentials/);

      const raw = await fs.readFile(path, "utf8");
      assert.equal(raw.includes(SECRET), false, "the gate log contains the refused secret");

      const lines = await readLines(path);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].decision, "rejected");
      assert.match(String(lines[0].reason), /credentials/);
      assert.match(String(lines[0].text), /^\[redacted: \d+ characters\]$/);

      // And nothing reached the store.
      assert.equal((await store.recall("", 10)).length, 0);
    } finally {
      await client.close();
      await server.close();
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("logs an ordinary rejection with its text intact", async () => {
    // Redaction is scoped to credentials — the classifier still needs to see what junk
    // looks like.
    const { store, cleanup } = await tempStore();
    const { path, dir, config } = await tempLog();
    const server = createServer(store, config);
    const client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      await client.callTool({ name: "save_memory", arguments: { text: "test" } });
      const lines = await readLines(path);
      assert.equal(lines[0].decision, "rejected");
      assert.equal(lines[0].text, "test");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves an env-driven config and honors the off switch", () => {
    assert.equal(resolveGateLogConfig({ JAMGATE_GATE_LOG: "off" }).path, null);
    assert.equal(
      resolveGateLogConfig({ JAMGATE_GATE_LOG: "/tmp/x/gate.log" }).path,
      "/tmp/x/gate.log",
    );
    assert.equal(
      resolveGateLogConfig({ JAMGATE_GATE_LOG_MAX_BYTES: "1234", JAMGATE_GATE_LOG: "/tmp/x/g.log" })
        .maxBytes,
      1234,
    );
  });

  after(() => {
    // Nothing global to clean; each test cleans its own temp dir.
  });
});

/**
 * D-056. `forget` wrote nothing to the log. D-025 states that this file is the training
 * corpus for the future classifier, and a corpus of every acceptance with no reversal teaches
 * the wrong lesson twice: memories the user later threw away read as good examples, and the
 * correction signal is absent entirely. Auditing the real store made it concrete — 24
 * production log-writes had no surviving record and the log explained none of them.
 */
describe("deletes are logged like saves (D-056)", () => {
  it("records a forgotten decision carrying the deleted memory's own metadata", async () => {
    const { path, dir, config } = await tempLog();
    const { store, cleanup } = await tempStore();
    const server = createServer(store, config);
    const client = new Client({ name: "forget-log-test", version: "1" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const saved = await client.callTool({
        name: "save_memory",
        arguments: {
          text: "jam's ThinkBook savings are at 7/10",
          type: "project",
          subject: "thinkbook-savings",
          source: "user-explicit",
        },
      });
      const id = (saved.content as Array<{ text: string }>)[0].text.match(/\[id ([0-9a-f-]{36})\]/)![1];

      await client.callTool({ name: "forget_memory", arguments: { id } });

      const lines = await readLines(path);
      assert.equal(lines.length, 2, "one line for the save, one for the delete");
      assert.equal(lines[0].decision, "saved");
      assert.equal(lines[1].decision, "forgotten");
      // The reversal must be reconstructable on its own — same fields as the save.
      assert.equal(lines[1].text, "jam's ThinkBook savings are at 7/10");
      assert.equal(lines[1].type, "project");
      assert.equal(lines[1].subject, "thinkbook-savings");
      assert.equal(lines[1].source, "user-explicit");
      assert.equal(lines[1].client, "forget-log-test");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("records the scope of a delete, so a reversal can be attributed (D-048)", async () => {
    const { path, dir, config } = await tempLog();
    const { store, cleanup } = await tempStore();
    try {
      const saved = await store.save({
        text: "the middle voice is the hard part of Greek",
        source: "user-explicit",
        scope: "amir/greek",
      });
      const { forgetThroughGate } = await import("../src/gate/pipeline.js");
      const res = await forgetThroughGate(store, saved.memory.id, "amir/greek", config);
      assert.equal(res.ok, true);

      const lines = await readLines(path);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].decision, "forgotten");
      assert.equal(lines[0].scope, "amir/greek");
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT log a failed forget — an unknown id is a usage error, not a decision", async () => {
    const { path, dir, config } = await tempLog();
    const { store, cleanup } = await tempStore();
    try {
      const { forgetThroughGate } = await import("../src/gate/pipeline.js");
      const missing = await forgetThroughGate(store, "00000000-0000-0000-0000-000000000000", undefined, config);
      assert.equal(missing.ok, false);
      await assert.rejects(() => fs.readFile(path, "utf8"), "nothing may be written");
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("a REST delete is logged identically to an MCP one", async () => {
    const { path, dir, config } = await tempLog();
    const { store, cleanup } = await tempStore();
    const { startHttpServer } = await import("../src/http.js");
    const running = await startHttpServer({ store, token: "t", port: 0, gateLog: config });
    try {
      const saved = await store.save({ text: "jam ships on Fridays", source: "user-explicit" });
      const res = await fetch(
        `http://${running.host}:${running.port}/v1/memory/${saved.memory.id}`,
        { method: "DELETE", headers: { Authorization: "Bearer t" } },
      );
      assert.equal(res.status, 200);

      const lines = await readLines(path);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].decision, "forgotten");
      assert.equal(lines[0].text, "jam ships on Fridays");
    } finally {
      await running.close();
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
