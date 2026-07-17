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
