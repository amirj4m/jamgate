import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEntry,
  clientById,
  CLIENTS,
  cursorDeeplink,
  cursorDeeplinkConfig,
  type ClientId,
} from "../src/setup/clients.js";
import { deepEqual, planMerge } from "../src/setup/merge.js";
import {
  BACKUP_SUFFIX,
  runSetup,
  runStatus,
  type ClaudeCli,
} from "../src/setup/runner.js";
import { parseSetupArgs } from "../src/setup/cli.js";

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

describe("parseSetupArgs", () => {
  it("parses --force (default off)", () => {
    assert.equal(parseSetupArgs([], {}).force, false);
    assert.equal(parseSetupArgs(["--force"], {}).force, true);
  });

  it("keeps --force independent of transport (stdio default)", () => {
    const parsed = parseSetupArgs(["--force"], {});
    assert.equal(parsed.mode, "stdio");
    assert.equal(parsed.force, true);
    assert.equal(parsed.error, undefined);
  });
});

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

  // --- Transport-downgrade guard (D-047) ---------------------------------------------------

  /** Seed Claude Code's config with a remote (HTTP) jamgate wiring and return its path. */
  async function seedRemoteClaudeCode(home: string): Promise<string> {
    const path = join(home, ".claude.json");
    await fs.writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          jamgate: { type: "http", url: "https://mem.example.com/mcp", headers: { Authorization: "Bearer tok" } },
          keep: { command: "k" },
        },
      }),
      "utf8",
    );
    return path;
  }

  it("preserves a remote wiring on a plain (stdio) run instead of downgrading it", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await seedRemoteClaudeCode(home);

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      // No CLI: the JSON-merge path is where the guard lives; it must fire before any write.
    });
    assert.equal(results[0].outcome, "preserved");
    assert.equal(results[0].transport, "remote");
    assert.match(results[0].detail ?? "", /--remote/);
    assert.match(results[0].detail ?? "", /--force/);

    // The file is untouched (still remote, neighbour intact) and no backup was spawned.
    const cfg = await readJson(path);
    assert.equal(cfg.mcpServers.jamgate.url, "https://mem.example.com/mcp");
    assert.deepEqual(cfg.mcpServers.keep, { command: "k" });
    assert.ok(!(await exists(path + BACKUP_SUFFIX)));
  });

  it("does not let the claude CLI overwrite a remote wiring on a plain run", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    await seedRemoteClaudeCode(home);
    const cli = fakeClaudeCli();

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      claudeCli: cli,
    });
    assert.equal(results[0].outcome, "preserved");
    // The guard fires before we ever reach the CLI add path.
    assert.equal(cli.calls.length, 0);
  });

  it("upgrades a stdio wiring to remote automatically (the desired flow)", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = join(home, ".claude.json");
    await fs.writeFile(
      path,
      JSON.stringify({ mcpServers: { jamgate: { command: "npx", args: ["jamgate"], type: "stdio", env: {} } } }),
      "utf8",
    );

    const results = await runSetup({
      mode: "remote",
      url: "https://mem.example.com/mcp",
      token: "tok",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
    });
    assert.equal(results[0].outcome, "updated");
    const cfg = await readJson(path);
    assert.deepEqual(cfg.mcpServers.jamgate, {
      type: "http",
      url: "https://mem.example.com/mcp",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("--force overrides the guard and downgrades a remote wiring to stdio", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await seedRemoteClaudeCode(home);

    const results = await runSetup({
      mode: "stdio",
      dryRun: false,
      platform: "linux",
      env,
      only: ["claude-code"],
      force: true,
    });
    assert.equal(results[0].outcome, "updated");
    assert.ok(results[0].backedUp);
    const cfg = await readJson(path);
    assert.deepEqual(cfg.mcpServers.jamgate, { command: "npx", args: ["jamgate"], type: "stdio", env: {} });
    assert.deepEqual(cfg.mcpServers.keep, { command: "k" }); // neighbour preserved
  });

  it("leaves same-transport idempotency unchanged (remote re-run is already-configured)", async () => {
    const { home, env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = join(home, ".claude.json");
    // Seed an empty config so Claude Code is detected without a CLI on the first run.
    await fs.writeFile(path, JSON.stringify({ mcpServers: {} }), "utf8");
    const opts = {
      mode: "remote" as const,
      url: "https://mem.example.com/mcp",
      token: "tok",
      dryRun: false,
      platform: "linux" as const,
      env,
      only: ["claude-code" as const],
    };
    await runSetup(opts);
    // Drop the first run's legitimate backup so we can assert the second run writes nothing.
    await fs.rm(path + BACKUP_SUFFIX, { force: true });
    const second = await runSetup(opts);
    assert.equal(second[0].outcome, "already-configured");
    assert.ok(!(await exists(path + BACKUP_SUFFIX)));
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

  it("honors JAMGATE_STORE when reporting the store path", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const report = await runStatus({
      platform: "linux",
      env: { ...env, JAMGATE_STORE: "/custom/mem.json" },
    });
    assert.equal(report.storePath, "/custom/mem.json");
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

// ---------------------------------------------------------------------------
// Expanded agent coverage (D-046): Gemini CLI, VS Code, Cline, Roo, OpenCode, Zed,
// plus the Windsurf remote upgrade. Each agent's exact entry shape / container key is
// verified against its official docs; these tests lock those shapes in and exercise the
// full detect → merge → write → idempotency → backup path against a temp home.
// ---------------------------------------------------------------------------

/** The stdio entry each newly-supported client should produce, keyed by container. */
const NEW_STDIO: ReadonlyArray<{
  id: ClientId;
  container: string;
  entry: Record<string, unknown>;
}> = [
  { id: "gemini-cli", container: "mcpServers", entry: { command: "npx", args: ["jamgate"] } },
  { id: "vscode", container: "servers", entry: { type: "stdio", command: "npx", args: ["jamgate"] } },
  { id: "cline", container: "mcpServers", entry: { command: "npx", args: ["jamgate"] } },
  { id: "roo", container: "mcpServers", entry: { command: "npx", args: ["jamgate"] } },
  { id: "opencode", container: "mcp", entry: { type: "local", command: ["npx", "jamgate"], enabled: true } },
  { id: "zed", container: "context_servers", entry: { command: "npx", args: ["jamgate"] } },
];

/** The remote entry each client should produce (all newly-supported clients speak HTTP). */
const NEW_REMOTE: ReadonlyArray<{
  id: ClientId;
  container: string;
  entry: Record<string, unknown>;
}> = [
  { id: "gemini-cli", container: "mcpServers", entry: { httpUrl: URL_REMOTE(), headers: BEARER() } },
  { id: "vscode", container: "servers", entry: { type: "http", url: URL_REMOTE(), headers: BEARER() } },
  { id: "cline", container: "mcpServers", entry: { type: "streamableHttp", url: URL_REMOTE(), headers: BEARER() } },
  { id: "roo", container: "mcpServers", entry: { type: "streamable-http", url: URL_REMOTE(), headers: BEARER() } },
  { id: "opencode", container: "mcp", entry: { type: "remote", url: URL_REMOTE(), enabled: true, headers: BEARER() } },
  { id: "zed", container: "context_servers", entry: { url: URL_REMOTE(), headers: BEARER() } },
  { id: "windsurf", container: "mcpServers", entry: { serverUrl: URL_REMOTE(), headers: BEARER() } },
];

function URL_REMOTE(): string {
  return "https://mem.example.com/mcp";
}
function BEARER(): Record<string, string> {
  return { Authorization: "Bearer tok" };
}

/** Create every detection path a client looks for, so `runSetup` treats it as installed. */
async function markInstalled(id: ClientId, env: NodeJS.ProcessEnv): Promise<string> {
  const def = clientById(id);
  for (const p of def.detectPaths("linux", env)) await fs.mkdir(p, { recursive: true });
  return def.configPath("linux", env)!;
}

describe("buildEntry — expanded agent shapes", () => {
  for (const { id, entry } of NEW_STDIO) {
    it(`builds the documented stdio entry for ${id}`, () => {
      assert.deepEqual(buildEntry(clientById(id), { mode: "stdio" }), entry);
    });
  }

  for (const { id, entry } of NEW_REMOTE) {
    it(`builds the documented remote entry for ${id}`, () => {
      const built = buildEntry(clientById(id), {
        mode: "remote",
        url: URL_REMOTE(),
        token: "tok",
      });
      assert.deepEqual(built, entry);
    });
  }

  it("omits headers on a token-less remote entry (byte-stable re-runs)", () => {
    const built = buildEntry(clientById("gemini-cli"), { mode: "remote", url: URL_REMOTE() });
    assert.deepEqual(built, { httpUrl: URL_REMOTE() });
  });
});

describe("client config paths — expanded agents", () => {
  const env = { HOME: "/home/u" };

  it("resolves Gemini / OpenCode / Zed under XDG on Linux", () => {
    assert.equal(clientById("gemini-cli").configPath("linux", env), "/home/u/.gemini/settings.json");
    assert.equal(
      clientById("opencode").configPath("linux", env),
      "/home/u/.config/opencode/opencode.json",
    );
    assert.equal(clientById("zed").configPath("linux", env), "/home/u/.config/zed/settings.json");
  });

  it("resolves VS Code / Cline / Roo under the Code user dir", () => {
    assert.equal(clientById("vscode").configPath("linux", env), "/home/u/.config/Code/User/mcp.json");
    assert.equal(
      clientById("cline").configPath("linux", env),
      "/home/u/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    );
    assert.equal(
      clientById("roo").configPath("linux", env),
      "/home/u/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json",
    );
  });

  it("resolves the VS Code user dir per platform (mac/win)", () => {
    const mac = clientById("vscode").configPath("darwin", env);
    assert.equal(mac, "/home/u/Library/Application Support/Code/User/mcp.json");
    const win = clientById("vscode")
      .configPath("win32", { HOME: "/home/u", APPDATA: "C:\\Users\\u\\AppData\\Roaming" })!
      .replace(/\\/g, "/");
    assert.equal(win, "C:/Users/u/AppData/Roaming/Code/User/mcp.json");
  });

  it("honors XDG_CONFIG_HOME for the XDG-based clients", () => {
    const xenv = { HOME: "/home/u", XDG_CONFIG_HOME: "/cfg" };
    assert.equal(clientById("zed").configPath("linux", xenv), "/cfg/zed/settings.json");
    assert.equal(clientById("opencode").configPath("linux", xenv), "/cfg/opencode/opencode.json");
    assert.equal(clientById("vscode").configPath("linux", xenv), "/cfg/Code/User/mcp.json");
  });
});

describe("runSetup — expanded agents (against a temp home)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const c of cleanups) await c();
  });

  for (const { id, container, entry } of NEW_STDIO) {
    it(`configures a detected ${id} install into ${container}`, async () => {
      const { env, cleanup } = await tempHome();
      cleanups.push(cleanup);
      const path = await markInstalled(id, env);

      const results = await runSetup({ mode: "stdio", dryRun: false, platform: "linux", env, only: [id] });
      assert.equal(results[0].outcome, "configured");
      assert.equal(results[0].method, "json-merge");

      const cfg = await readJson(path);
      assert.deepEqual(cfg[container].jamgate, entry);
    });

    it(`is idempotent for ${id} (second run writes no backup)`, async () => {
      const { env, cleanup } = await tempHome();
      cleanups.push(cleanup);
      const path = await markInstalled(id, env);
      const opts = { mode: "stdio" as const, dryRun: false, platform: "linux" as const, env, only: [id] };

      await runSetup(opts);
      const second = await runSetup(opts);
      assert.equal(second[0].outcome, "already-configured");
      assert.ok(!(await exists(path + BACKUP_SUFFIX)));
    });

    it(`backs up and preserves neighbours when updating ${id}`, async () => {
      const { env, cleanup } = await tempHome();
      cleanups.push(cleanup);
      const path = await markInstalled(id, env);
      // Seed a stale jamgate entry plus an unrelated server under the same container.
      await fs.mkdir(join(path, ".."), { recursive: true });
      await fs.writeFile(
        path,
        JSON.stringify({ [container]: { jamgate: { command: "old" }, keep: { command: "k" } } }),
        "utf8",
      );

      const results = await runSetup({ mode: "stdio", dryRun: false, platform: "linux", env, only: [id] });
      assert.equal(results[0].outcome, "updated");
      assert.ok(results[0].backedUp);

      const backup = await readJson(path + BACKUP_SUFFIX);
      assert.deepEqual(backup[container].jamgate, { command: "old" });
      const cfg = await readJson(path);
      assert.deepEqual(cfg[container].jamgate, entry);
      assert.deepEqual(cfg[container].keep, { command: "k" }); // neighbour preserved
    });
  }

  for (const { id, container, entry } of NEW_REMOTE) {
    it(`wires ${id} over remote HTTP into ${container}`, async () => {
      const { env, cleanup } = await tempHome();
      cleanups.push(cleanup);
      const path = await markInstalled(id, env);

      const results = await runSetup({
        mode: "remote",
        url: URL_REMOTE(),
        token: "tok",
        dryRun: false,
        platform: "linux",
        env,
        only: [id],
      });
      assert.equal(results[0].outcome, "configured");
      const cfg = await readJson(path);
      assert.deepEqual(cfg[container].jamgate, entry);
    });
  }

  it("refuses to clobber a shared config that isn't plain JSON (Zed with comments)", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await markInstalled("zed", env);
    const original = '// Zed settings\n{\n  "theme": "One Dark",\n  "context_servers": {}\n}\n';
    await fs.writeFile(path, original, "utf8");

    const results = await runSetup({ mode: "stdio", dryRun: false, platform: "linux", env, only: ["zed"] });
    assert.equal(results[0].outcome, "skipped");
    assert.match(results[0].detail ?? "", /manually/);
    // The user's commented settings.json is left exactly as-is, and no backup was spawned.
    assert.equal(await fs.readFile(path, "utf8"), original);
    assert.ok(!(await exists(path + BACKUP_SUFFIX)));
  });

  it("still creates a fresh shared config when none exists (OpenCode)", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await markInstalled("opencode", env);
    // No file yet — a fresh create is safe even for a shared config.
    const results = await runSetup({ mode: "stdio", dryRun: false, platform: "linux", env, only: ["opencode"] });
    assert.equal(results[0].outcome, "configured");
    const cfg = await readJson(path);
    assert.deepEqual(cfg.mcp.jamgate, { type: "local", command: ["npx", "jamgate"], enabled: true });
  });

  it("reports not-found for an absent expanded agent", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const results = await runSetup({ mode: "stdio", dryRun: false, platform: "linux", env, only: ["zed"] });
    assert.equal(results[0].outcome, "not-found");
  });
});

describe("runStatus — expanded agents", () => {
  const cleanups: Array<() => Promise<void>> = [];
  after(async () => {
    for (const c of cleanups) await c();
  });

  it("covers all ten supported clients", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const report = await runStatus({ platform: "linux", env });
    assert.equal(report.clients.length, CLIENTS.length);
    assert.equal(report.clients.length, 10);
    for (const c of CLIENTS) {
      assert.ok(report.clients.some((r) => r.id === c.id), `missing ${c.id} in status`);
    }
  });

  it("detects an OpenCode remote wiring as http transport", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await markInstalled("opencode", env);
    await fs.writeFile(
      path,
      JSON.stringify({ mcp: { jamgate: { type: "remote", url: "https://x/mcp", enabled: true } } }),
      "utf8",
    );
    const report = await runStatus({ platform: "linux", env });
    const oc = report.clients.find((c) => c.id === "opencode")!;
    assert.ok(oc.wired);
    assert.equal(oc.transport, "http");
  });

  it("detects a Zed stdio wiring under context_servers", async () => {
    const { env, cleanup } = await tempHome();
    cleanups.push(cleanup);
    const path = await markInstalled("zed", env);
    await fs.writeFile(
      path,
      JSON.stringify({ context_servers: { jamgate: { command: "npx", args: ["jamgate"] } } }),
      "utf8",
    );
    const report = await runStatus({ platform: "linux", env });
    const zed = report.clients.find((c) => c.id === "zed")!;
    assert.ok(zed.wired);
    assert.equal(zed.transport, "stdio");
  });
});
