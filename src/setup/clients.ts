import { join } from "node:path";

/**
 * Client registry for `jamgate setup` (the One-Click Install phase).
 *
 * Everything in this module is PURE: it maps a target MCP client + platform + run mode to
 * the config-file path and the exact server entry we would write. The IO (detecting installs,
 * reading/merging/writing files, shelling out to `claude mcp add`) lives in `runner.ts` and
 * is driven off these definitions. Keeping the mapping pure is what makes the whole setup
 * flow unit-testable against a fake home directory without ever touching real user configs.
 */

/** The MCP clients Jamgate knows how to wire itself into. */
export type ClientId = "claude-code" | "claude-desktop" | "cursor" | "windsurf";

/** How Jamgate should talk to the client: the local stdio default, or opt-in remote HTTP. */
export type Mode = "stdio" | "remote";

/** A single MCP server entry, in the shape a given client's config expects. Clients agree on
 *  `command`/`args` for stdio and `url`/`headers` for HTTP; Claude Code additionally tags the
 *  transport with `type`, which we include only for that client to match its native schema. */
export interface ServerEntry {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface ClientDef {
  id: ClientId;
  label: string;
  /** The key under `mcpServers` in every one of these clients' config files. */
  readonly serverKey: "jamgate";
  /** Whether the client can talk MCP over Streamable HTTP (i.e. supports `--remote`). Clients
   *  that only do stdio are skipped in remote mode with a clear reason rather than mis-wired. */
  supportsRemote: boolean;
  /** Absolute path to the client's MCP config file for this platform/env, or null if the
   *  client has no config-file install path we support on this platform. */
  configPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null;
  /** Directories/paths whose existence signals the client is installed. Any hit counts. */
  detectPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[];
}

/** Resolve the user's home directory from the environment (test-injectable). */
function home(env: NodeJS.ProcessEnv): string | null {
  return env.HOME || env.USERPROFILE || null;
}

/** Resolve the base config directory used by Claude Desktop, per platform. */
function claudeDesktopDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const h = home(env);
  if (platform === "darwin") {
    return h ? join(h, "Library", "Application Support", "Claude") : null;
  }
  if (platform === "win32") {
    return env.APPDATA ? join(env.APPDATA, "Claude") : null;
  }
  // Linux and everything else follow the XDG base-dir spec.
  const base = env.XDG_CONFIG_HOME || (h ? join(h, ".config") : null);
  return base ? join(base, "Claude") : null;
}

export const CLIENTS: readonly ClientDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    serverKey: "jamgate",
    supportsRemote: true,
    configPath(_platform, env) {
      const h = home(env);
      return h ? join(h, ".claude.json") : null;
    },
    detectPaths(_platform, env) {
      const h = home(env);
      // The config file itself is the strongest signal; the CLI is detected separately in the
      // runner (it may be on PATH before the file exists on a very fresh install).
      return h ? [join(h, ".claude.json")] : [];
    },
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    serverKey: "jamgate",
    // Claude Desktop installs local (stdio) servers natively; remote servers go through the
    // connectors UI / mcp-remote, not a plain HTTP entry, so we don't claim remote support.
    supportsRemote: false,
    configPath(platform, env) {
      const dir = claudeDesktopDir(platform, env);
      return dir ? join(dir, "claude_desktop_config.json") : null;
    },
    detectPaths(platform, env) {
      const dir = claudeDesktopDir(platform, env);
      return dir ? [dir] : [];
    },
  },
  {
    id: "cursor",
    label: "Cursor",
    serverKey: "jamgate",
    supportsRemote: true,
    configPath(_platform, env) {
      const h = home(env);
      return h ? join(h, ".cursor", "mcp.json") : null;
    },
    detectPaths(_platform, env) {
      const h = home(env);
      return h ? [join(h, ".cursor")] : [];
    },
  },
  {
    id: "windsurf",
    label: "Windsurf",
    serverKey: "jamgate",
    // Windsurf's remote support is SSE-based (`serverUrl`) rather than Streamable HTTP; rather
    // than write an entry we haven't verified round-trips, we wire stdio only.
    supportsRemote: false,
    configPath(_platform, env) {
      const h = home(env);
      return h ? join(h, ".codeium", "windsurf", "mcp_config.json") : null;
    },
    detectPaths(_platform, env) {
      const h = home(env);
      return h ? [join(h, ".codeium", "windsurf")] : [];
    },
  },
];

export function clientById(id: ClientId): ClientDef {
  const def = CLIENTS.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown client id: ${id}`);
  return def;
}

export interface EntryParams {
  mode: Mode;
  /** Remote MCP endpoint URL, required when mode is "remote". */
  url?: string;
  /** Bearer token for the remote endpoint, required when mode is "remote". */
  token?: string;
}

/**
 * Build the server entry to write for a given client and mode. The stdio entry runs the
 * published package with `npx jamgate` so it always tracks the installed version; the remote
 * entry points at the user's self-hosted HTTP endpoint with a bearer header. Claude Code gets
 * an explicit `type` to match how its own `claude mcp add` records entries.
 */
export function buildEntry(client: ClientDef, params: EntryParams): ServerEntry {
  if (params.mode === "remote") {
    if (!params.url) throw new Error("remote mode requires a url");
    const headers: Record<string, string> = {};
    if (params.token) headers.Authorization = `Bearer ${params.token}`;
    const entry: ServerEntry = { url: params.url };
    if (Object.keys(headers).length > 0) entry.headers = headers;
    if (client.id === "claude-code") entry.type = "http";
    return entry;
  }
  const entry: ServerEntry = { command: "npx", args: ["jamgate"] };
  // Claude Code records stdio servers as {type, command, args, env}. Match that shape exactly
  // so an entry written by `claude mcp add` is recognised as already-configured on re-run
  // (otherwise the empty `env` would read as a spurious diff and re-"update" every run).
  if (client.id === "claude-code") {
    entry.type = "stdio";
    entry.env = {};
  }
  return entry;
}

/**
 * The bare per-server config object Cursor's one-click deeplink base64-encodes. Cursor's
 * deeplink takes the server config WITHOUT the `mcpServers` wrapper (verified against Cursor's
 * install-links docs), so this mirrors {@link buildEntry} for Cursor but is exposed separately
 * for the README badge generator and its test.
 */
export function cursorDeeplinkConfig(params: EntryParams = { mode: "stdio" }): ServerEntry {
  return buildEntry(clientById("cursor"), params);
}

/**
 * Generate Cursor's official one-click install deeplink for Jamgate. Shape verified against
 * Cursor docs: `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64>`
 * where `<base64>` is the base64 of the bare server config JSON.
 */
export function cursorDeeplink(params: EntryParams = { mode: "stdio" }): string {
  const config = cursorDeeplinkConfig(params);
  const base64 = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=jamgate&config=${base64}`;
}
