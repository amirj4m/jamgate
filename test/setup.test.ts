import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEntry,
  clientById,
  cursorDeeplink,
  cursorDeeplinkConfig,
} from "../src/setup/clients.js";
import { deepEqual, planMerge } from "../src/setup/merge.js";
import {
  BACKUP_SUFFIX,
  runSetup,
  runStatus,
  type ClaudeCli,
} from "../src/setup/runner.js";

/** A throwaway home directory for a single test, with cleanup. */
async function tempHome(): Promise<{ home: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const home = await fs.mkdtemp(join(tmpdir(), "jamgate-setup-"));
  return {
    home,
    // A minimal env — only the vars the runner reads. Never the real process.env.
    env: { HOME: home },
    cleanup: () => fs.rm(home, { recursive: true, force: true }),
  };
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** A fake `claude` CLI that records calls instead of shelling out. */
function fakeClaudeCli(overrides: Partial<ClaudeCli> = {}): ClaudeCli & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    isAvailable: overrides.isAvailable ?? (async () => true),
    add:
      overrides.add ??
      (async (spec) => {
        calls.push(spec);
        return { ok: true };
      }),
    previewCommand: overrides.previewCommand ?? ((spec) => `claude mcp add (${spec.mode})`),
  };
}

describe("buildEntry / server entry shapes", () => {
  it("builds a bare npx stdio entry for Cursor", () => {
    const entry = buildEntry(clientById("cursor"), { mode: "stdio" });
    assert.deepEqual(entry, { command: "npx", args: ["jamgate"] });
  });

  it("matches Claude Code's native stdio shape (type + empty env) for idempotency", () => {
    const entry = buildEntry(clientById("claude-code"), { mode: "stdio" });
    assert.deepEqual(entry, { command: "npx", args: ["jamgate"], type: "stdio", env: {} });
  });

  it("builds a remote entry with a bearer header", () => {
    const entry = buildEntry(clientById("cursor"), {
      mode: "remote",
      url: "https://mem.example.com/mcp",
      token: "secret",
    });
    assert.deepEqual(entry, {
      url: "https://mem.example.com/mcp",
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("throws when remote mode is missing a url", () => {
    assert.throws(() => buildEntry(clientById("cursor"), { mode: "remote" }), /requires a url/);
  });
});

describe("client config paths", () => {
  const env = { HOME: "/home/u", APPDATA: "C:\\Users\\u\\AppData\\Roaming", XDG_CONFIG_HOME: "" };

  it("resolves Claude Desktop per platform", () => {
    const cd = clientById("claude-desktop");
    assert.equal(
      cd.configPath("darwin", env),
      "/home/u/Library/Application Support/Claude/claude_desktop_config.json",
    );
    assert.equal(
      cd.configPath("linux", { HOME: "/home/u" }),
      "/home/u/.config/Claude/claude_desktop_config.json",
    );
    // `node:path.join` uses the runtime OS separator, so normalise before comparing (in
    // production platform always equals the runtime, so this only matters for this cross-check).
    const win = cd.configPath("win32", env)!.replace(/\\/g, "/");
    assert.equal(win, "C:/Users/u/AppData/Roaming/Claude/claude_desktop_config.json");
  });

  it("resolves Cursor and Windsurf under home", () => {
    assert.equal(clientById("cursor").configPath("linux", { HOME: "/home/u" }), "/home/u/.cursor/mcp.json");
    assert.equal(
      clientById("windsurf").configPath("linux", { HOME: "/home/u" }),
      "/home/u/.codeium/windsurf/mcp_config.json",
    );
  });
});

describe("cursor deeplink", () => {
  it("base64-encodes the bare server config (round-trips)", () => {
    const link = cursorDeeplink();
    assert.match(link, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=jamgate&config=/);
    const b64 = new URL(link).searchParams.get("config")!;
    const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    assert.deepEqual(decoded, { command: "npx", args: ["jamgate"] });
    assert.deepEqual(decoded, cursorDeeplinkConfig());
  });
});

describe("deepEqual", () => {
  it("compares nested objects and arrays structurally", () => {
    assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
    assert.ok(!deepEqual([1, 2], [1, 2, 3]));
  });
});

describe("planMerge", () => {
  const entry = { command: "npx", args: ["jamgate"] };

  it("creates mcpServers when the config is absent", () => {
    const plan = planMerge(undefined, "jamgate", entry);
    assert.equal(plan.status, "created");
    assert.ok(plan.changed);
    assert.deepEqual(plan.config, { mcpServers: { jamgate: entry } });
  });

  it("preserves other servers and other top-level fields", () => {
    const existing = {
      theme: "dark",
      mcpServers: { other: { command: "x" } },
    };
    const plan = planMerge(existing, "jamgate", entry);
    assert.equal(plan.status, "configured");
    assert.deepEqual(plan.config, {
      theme: "dark",
      mcpServers: { other: { command: "x" }, jamgate: entry },
    });
    // The input object is not mutated.
    assert.equal((existing.mcpServers as any).jamgate, undefined);
  });

  it("is a no-op when an identical entry is already present", () => {
    const existing = { mcpServers: { jamgate: { command: "npx", args: ["jamgate"] } } };
    const plan = planMerge(existing, "jamgate", entry);
    assert.equal(plan.status, "already-configured");
    assert.ok(!plan.changed);
  });

  it("updates when an existing jamgate entry differs", () => {
    const existing = { mcpServers: { jamgate: { command: "node", args: ["old.js"] } } };
    const plan = planMerge(existing, "jamgate", entry);
    assert.equal(plan.status, "updated");
    assert.ok(plan.changed);
    assert.deepEqual((plan.config.mcpServers as any).jamgate, entry);
  });

  it("treats a malformed (non-object) config as a fresh start", () => {
    const plan = planMerge("not an object", "jamgate", entry);
    assert.equal(plan.status, "created");
    assert.deepEqual(plan.config, { mcpServers: { jamgate: entry } });
  });
});

describe("runSetup (against a temp home)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const c of cleanups) await c();
  });

  it("configures a detected Cursor install and writes mcp.json", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.mkdir(join(home, ".cursor"), { recursive: true });

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["cursor"],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "configured");
    assert.equal(results[0].method, "json-merge");

    const cfg = await readJson(join(home, ".cursor", "mcp.json"));
    assert.deepEqual(cfg.mcpServers.jamgate, { command: "npx", args: ["jamgate"] });
  });

  it("is idempotent: a second run reports already-configured and writes no backup", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.mkdir(join(home, ".cursor"), { recursive: true });
    const opts = { mode: "stdio" as const, dryRun: false, platform: "linux" as const, env, only: ["cursor" as const] };

    await runSetup(opts);
    const second = await runSetup(opts);
    assert.equal(second[0].outcome, "already-configured");
    assert.ok(!(await exists(join(home, ".cursor", "mcp.json" + BACKUP_SUFFIX))));
  });

  it("backs up the existing file before overwriting a differing entry", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const cursorDir = join(home, ".cursor");
    await fs.mkdir(cursorDir, { recursive: true });
    const cfgPath = join(cursorDir, "mcp.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { jamgate: { command: "old" }, keep: { command: "k" } } }),
      "utf8",
    );

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["cursor"],
    });
    assert.equal(results[0].outcome, "updated");
    assert.ok(results[0].backedUp);

    const backup = await readJson(cfgPath + BACKUP_SUFFIX);
    assert.deepEqual(backup.mcpServers.jamgate, { command: "old" });
    const cfg = await readJson(cfgPath);
    // Our entry updated, the unrelated server preserved.
    assert.deepEqual(cfg.mcpServers.jamgate, { command: "npx", args: ["jamgate"] });
    assert.deepEqual(cfg.mcpServers.keep, { command: "k" });
  });

  it("dry-run writes nothing", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.mkdir(join(home, ".cursor"), { recursive: true });

    const results = await runSetup({
      mode: "stdio",
      dryRun: true,
      platform: "linux",
      env,
      only: ["cursor"],
    });
    assert.equal(results[0].outcome, "configured");
    assert.ok(results[0].dryRun);
    assert.ok(!(await exists(join(home, ".cursor", "mcp.json"))));
  });

  it("reports not-found for an absent client", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["cursor"],
    });
    assert.equal(results[0].outcome, "not-found");
  });

  it("skips clients without HTTP transport in remote mode, wires those that have it", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.mkdir(join(home, ".cursor"), { recursive: true });
    await fs.mkdir(join(home, ".config", "Claude"), { recursive: true });

    const results = await runSetup({
      mode: "remote",
      url: "https://mem.example.com/mcp",
      token: "tok",
      dryRun: false,
      platform: "linux",
      env,
      only: ["cursor", "claude-desktop"],
    });
    const cursor = results.find((r) => r.id === "cursor")!;
    const desktop = results.find((r) => r.id === "claude-desktop")!;
    assert.equal(cursor.outcome, "configured");
    assert.equal(desktop.outcome, "skipped");

    const cfg = await readJson(join(home, ".cursor", "mcp.json"));
    assert.deepEqual(cfg.mcpServers.jamgate, {
      url: "https://mem.example.com/mcp",
      headers: { Authorization: "Bearer tok" },
    });
    // Nothing was written for the skipped client.
    assert.ok(!(await exists(join(home, ".config", "Claude", "claude_desktop_config.json"))));
  });

  it("prefers the claude CLI for a fresh Claude Code add, without touching the file", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const cli = fakeClaudeCli();

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      claudeCli: cli,
    });
    assert.equal(results[0].outcome, "configured");
    assert.equal(results[0].method, "claude-cli");
    assert.equal(cli.calls.length, 1);
    // The CLI owns the file in this path — we did not write ~/.claude.json ourselves.
    assert.ok(!(await exists(join(home, ".claude.json"))));
  });

  it("falls back to JSON merge when the claude CLI add fails", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    // Client is 'installed' (config file present) but the CLI add errors.
    await fs.writeFile(join(home, ".claude.json"), JSON.stringify({ mcpServers: {} }), "utf8");
    const cli = fakeClaudeCli({ add: async () => ({ ok: false, stderr: "boom" }) });

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      claudeCli: cli,
    });
    assert.equal(results[0].outcome, "configured");
    assert.equal(results[0].method, "json-merge");
    const cfg = await readJson(join(home, ".claude.json"));
    assert.deepEqual(cfg.mcpServers.jamgate, {
      command: "npx",
      args: ["jamgate"],
      type: "stdio",
      env: {},
    });
  });

  it("uses JSON merge for Claude Code when no CLI is available", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.writeFile(join(home, ".claude.json"), JSON.stringify({ existing: true }), "utf8");

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      // No claudeCli passed → detection falls to the config file, write falls to JSON merge.
    });
    assert.equal(results[0].outcome, "configured");
    assert.equal(results[0].method, "json-merge");
    const cfg = await readJson(join(home, ".claude.json"));
    assert.equal(cfg.existing, true); // preserved
    assert.equal(cfg.mcpServers.jamgate.command, "npx");
  });
});

describe("runStatus (against a temp home)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const c of cleanups) await c();
  });

  it("reports wired vs detected vs not-found and the store path", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    // Cursor wired, Windsurf present-but-unwired, others absent.
    await fs.mkdir(join(home, ".cursor"), { recursive: true });
    await fs.writeFile(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { jamgate: { command: "npx", args: ["jamgate"] } } }),
      "utf8",
    );
    await fs.mkdir(join(home, ".codeium", "windsurf"), { recursive: true });

    const report = await runStatus({ platform: "linux", env });
    const cursor = report.clients.find((c) => c.id === "cursor")!;
    const windsurf = report.clients.find((c) => c.id === "windsurf")!;
    const desktop = report.clients.find((c) => c.id === "claude-desktop")!;

    assert.ok(cursor.wired);
    assert.equal(cursor.transport, "stdio");
    assert.ok(windsurf.detected && !windsurf.wired);
    assert.ok(!desktop.detected);
    assert.equal(report.storePath, join(home, ".jamgate", "memory.json"));
  });

  it("reports http transport for a remote-wired client", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await fs.mkdir(join(home, ".cursor"), { recursive: true });
    await fs.writeFile(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { jamgate: { url: "https://x/mcp" } } }),
      "utf8",
    );
    const report = await runStatus({ platform: "linux", env });
    assert.equal(report.clients.find((c) => c.id === "cursor")!.transport, "http");
  });
});
