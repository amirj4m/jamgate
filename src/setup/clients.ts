import { join } from "node:path";

/**
 * Client registry for `jamgate setup` (the One-Click Install phase).
 *
 * Everything in this module is PURE: it maps a target MCP client + platform + run mode to
 * the config-file path and the exact server entry we would write. The IO (detecting installs,
 * reading/merging/writing files, shelling out to `claude mcp add`) lives in `runner.ts` and
 * is driven off these definitions. Keeping the mapping pure is what makes the whole setup
 * flow unit-testable against a fake home directory without ever touching real user configs.
 *
 * Every client here is verified against the vendor's OFFICIAL docs (see DECISIONS D-046): the
 * config path, the container key, the transport support, and — critically — the EXACT entry
 * shape, because a wrong field name silently produces a broken config. Agents whose config
 * lives in a non-JSON format (Codex CLI → TOML, Goose/Continue → YAML) are deliberately NOT
 * here: we have no safe way to merge into those without a parser dependency, so the README
 * points to manual config for them instead of shipping something we can't merge losslessly.
 */

/** The MCP clients Jamgate knows how to wire itself into. */
export type ClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "windsurf"
  | "gemini-cli"
  | "vscode"
  | "cline"
  | "roo"
  | "opencode"
  | "zed";

/** How Jamgate should talk to the client: the local stdio default, or opt-in remote HTTP. */
export type Mode = "stdio" | "remote";

/**
 * The per-client "entry shape". Clients broadly agree on `command`/`args` for stdio and
 * `url`/`headers` for HTTP, but the details differ enough that a wrong field breaks the config:
 *  - `plain`        — Cursor, Zed: bare `{command,args}` stdio; `{url,headers}` remote.
 *  - `claude-code`  — tags transport with `type` and carries an empty `env` (matches how
 *                     `claude mcp add` records entries, so re-runs read as already-configured).
 *  - `gemini`       — stdio `{command,args}`; Streamable-HTTP remote uses `httpUrl` (NOT `url`;
 *                     `url` means SSE in Gemini CLI).
 *  - `vscode`       — every entry carries an explicit `type` (`stdio`/`http`), per VS Code.
 *  - `cline`        — remote transport is `type:"streamableHttp"` (camelCase).
 *  - `roo`          — remote transport is `type:"streamable-http"` (hyphenated — NOT Cline's).
 *  - `opencode`     — `command` is a single array `["npx","jamgate"]`, `type` is `local`/`remote`,
 *                     and every entry carries `enabled:true`.
 *  - `windsurf`     — remote uses `serverUrl` (Windsurf's field name) rather than `url`.
 */
export type EntryShape =
  | "plain"
  | "claude-code"
  | "gemini"
  | "vscode"
  | "cline"
  | "roo"
  | "opencode"
  | "windsurf";

/** A single MCP server entry. Loosely typed because the exact fields differ per client (see
 *  {@link EntryShape}); we only ever construct these ourselves via {@link buildEntry}, so the
 *  freedom is contained. `command` is a string for most clients but an array for OpenCode. */
export interface ServerEntry {
  type?: string;
  command?: string | string[];
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  url?: string;
  httpUrl?: string;
  serverUrl?: string;
  headers?: Record<string, string>;
}

export interface ClientDef {
  id: ClientId;
  label: string;
  /** The key under which every one of these clients nests our entry inside its container. */
  readonly serverKey: "jamgate";
  /** The top-level container key our entry goes under: `mcpServers` for most, but `servers`
   *  (VS Code), `context_servers` (Zed), or `mcp` (OpenCode). */
  containerKey: string;
  /** The exact JSON entry shape this client expects (see {@link EntryShape}). */
  shape: EntryShape;
  /** Whether the client can talk MCP over Streamable HTTP (i.e. supports `--remote`). Clients
   *  that only do stdio are skipped in remote mode with a clear reason rather than mis-wired. */
  supportsRemote: boolean;
  /** True when our entry lives inside a SHARED, multi-purpose config file (the user's whole
   *  editor/CLI settings — Gemini, Zed, OpenCode) rather than a dedicated MCP-only file. For
   *  shared configs the runner REFUSES to overwrite a file it can't parse as strict JSON (a
   *  `//`-commented settings.json would otherwise be clobbered down to just our entry), and
   *  skips with a "configure manually" reason instead. */
  sharedConfig?: boolean;
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

/** The XDG config base (`$XDG_CONFIG_HOME` or `~/.config`), used by the CLIs/editors that
 *  follow the spec on macOS + Linux (Gemini, OpenCode, Zed). */
function xdgConfig(env: NodeJS.ProcessEnv): string | null {
  const h = home(env);
  return env.XDG_CONFIG_HOME || (h ? join(h, ".config") : null);
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
  const base = xdgConfig(env);
  return base ? join(base, "Claude") : null;
}

/** VS Code's per-user data directory (`.../Code/User`), where the user-level `mcp.json` lives
 *  and under which VS Code extensions (Cline, Roo) keep their `globalStorage`. Stable "Code"
 *  only — Insiders/VSCodium use a different folder and are left to manual config. */
function vscodeUserDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const h = home(env);
  if (platform === "darwin") {
    return h ? join(h, "Library", "Application Support", "Code", "User") : null;
  }
  if (platform === "win32") {
    return env.APPDATA ? join(env.APPDATA, "Code", "User") : null;
  }
  const base = xdgConfig(env);
  return base ? join(base, "Code", "User") : null;
}

/** Zed's config base: `~/.config/zed` on macOS + Linux (Zed uses XDG even on macOS),
 *  `%APPDATA%\Zed` on Windows. */
function zedDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform === "win32") {
    return env.APPDATA ? join(env.APPDATA, "Zed") : null;
  }
  const base = xdgConfig(env);
  return base ? join(base, "zed") : null;
}

export const CLIENTS: readonly ClientDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    serverKey: "jamgate",
    containerKey: "mcpServers",
    shape: "claude-code",
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
    containerKey: "mcpServers",
    shape: "plain",
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
    containerKey: "mcpServers",
    shape: "plain",
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
    containerKey: "mcpServers",
    // Windsurf (Cascade) now officially documents Streamable HTTP for remote servers, using its
    // own `serverUrl` field + a `headers` object (D-046). We wire that in remote mode.
    shape: "windsurf",
    supportsRemote: true,
    configPath(_platform, env) {
      const h = home(env);
      return h ? join(h, ".codeium", "windsurf", "mcp_config.json") : null;
    },
    detectPaths(_platform, env) {
      const h = home(env);
      return h ? [join(h, ".codeium", "windsurf")] : [];
    },
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    serverKey: "jamgate",
    containerKey: "mcpServers",
    // Remote is Streamable HTTP via `httpUrl` (Gemini reserves plain `url` for SSE).
    shape: "gemini",
    supportsRemote: true,
    // settings.json is Gemini's whole CLI config, not an MCP-only file.
    sharedConfig: true,
    configPath(_platform, env) {
      const h = home(env);
      return h ? join(h, ".gemini", "settings.json") : null;
    },
    detectPaths(_platform, env) {
      const h = home(env);
      return h ? [join(h, ".gemini")] : [];
    },
  },
  {
    id: "vscode",
    label: "VS Code (Copilot)",
    serverKey: "jamgate",
    // VS Code's container key is `servers`, not `mcpServers`, and every entry carries a `type`.
    containerKey: "servers",
    shape: "vscode",
    supportsRemote: true,
    configPath(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir ? join(dir, "mcp.json") : null;
    },
    detectPaths(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir ? [dir] : [];
    },
  },
  {
    id: "cline",
    label: "Cline",
    serverKey: "jamgate",
    containerKey: "mcpServers",
    // Remote transport tag is the camelCase `streamableHttp` (NOT Roo's hyphenated form).
    shape: "cline",
    supportsRemote: true,
    configPath(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir
        ? join(dir, "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : null;
    },
    detectPaths(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir ? [join(dir, "globalStorage", "saoudrizwan.claude-dev")] : [];
    },
  },
  {
    id: "roo",
    label: "Roo Code",
    serverKey: "jamgate",
    containerKey: "mcpServers",
    // Remote transport tag is the hyphenated `streamable-http` (NOT Cline's camelCase form).
    shape: "roo",
    supportsRemote: true,
    configPath(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir
        ? join(dir, "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json")
        : null;
    },
    detectPaths(platform, env) {
      const dir = vscodeUserDir(platform, env);
      return dir ? [join(dir, "globalStorage", "rooveterinaryinc.roo-cline")] : [];
    },
  },
  {
    id: "opencode",
    label: "OpenCode",
    serverKey: "jamgate",
    // OpenCode nests servers under `mcp`, with a single `command` array and an `enabled` flag.
    containerKey: "mcp",
    shape: "opencode",
    supportsRemote: true,
    // opencode.json holds providers/models/etc., not just MCP servers.
    sharedConfig: true,
    configPath(_platform, env) {
      const base = xdgConfig(env);
      return base ? join(base, "opencode", "opencode.json") : null;
    },
    detectPaths(_platform, env) {
      const base = xdgConfig(env);
      return base ? [join(base, "opencode")] : [];
    },
  },
  {
    id: "zed",
    label: "Zed",
    serverKey: "jamgate",
    // Zed's container key is `context_servers`; its custom-server entry is a bare {command,args}.
    containerKey: "context_servers",
    shape: "plain",
    supportsRemote: true,
    // settings.json is Zed's entire editor config (and commonly `//`-commented).
    sharedConfig: true,
    configPath(platform, env) {
      const dir = zedDir(platform, env);
      return dir ? join(dir, "settings.json") : null;
    },
    detectPaths(platform, env) {
      const dir = zedDir(platform, env);
      return dir ? [dir] : [];
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

/** The bearer `Authorization` header for the remote endpoint, or undefined when no token. */
function authHeaders(token?: string): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/**
 * Build the server entry to write for a given client and mode. The stdio entry runs the
 * published package with `npx jamgate` so it always tracks the installed version; the remote
 * entry points at the user's self-hosted HTTP endpoint with a bearer header. Each client's
 * exact field names come straight from its official docs — see {@link EntryShape}.
 */
export function buildEntry(client: ClientDef, params: EntryParams): ServerEntry {
  const remote = params.mode === "remote";
  if (remote && !params.url) throw new Error("remote mode requires a url");
  const headers = authHeaders(params.token);

  switch (client.shape) {
    case "claude-code":
      if (remote) return withHeaders({ type: "http", url: params.url }, headers);
      // Match `claude mcp add`'s recorded shape exactly (type + empty env) so an entry it wrote
      // is recognised as already-configured on re-run rather than read as a spurious diff.
      return { command: "npx", args: ["jamgate"], type: "stdio", env: {} };

    case "gemini":
      // Streamable HTTP is `httpUrl` in Gemini CLI; plain `url` would select SSE instead.
      if (remote) return withHeaders({ httpUrl: params.url }, headers);
      return { command: "npx", args: ["jamgate"] };

    case "vscode":
      if (remote) return withHeaders({ type: "http", url: params.url }, headers);
      return { type: "stdio", command: "npx", args: ["jamgate"] };

    case "cline":
      if (remote) return withHeaders({ type: "streamableHttp", url: params.url }, headers);
      return { command: "npx", args: ["jamgate"] };

    case "roo":
      if (remote) return withHeaders({ type: "streamable-http", url: params.url }, headers);
      return { command: "npx", args: ["jamgate"] };

    case "opencode":
      if (remote) return withHeaders({ type: "remote", url: params.url, enabled: true }, headers);
      return { type: "local", command: ["npx", "jamgate"], enabled: true };

    case "windsurf":
      // Windsurf's remote URL field is `serverUrl`, not `url`.
      if (remote) return withHeaders({ serverUrl: params.url }, headers);
      return { command: "npx", args: ["jamgate"] };

    case "plain":
    default:
      if (remote) return withHeaders({ url: params.url }, headers);
      return { command: "npx", args: ["jamgate"] };
  }
}

/** Attach a `headers` object to an entry only when there is one (keeps token-less remote entries
 *  free of an empty `headers` key so they stay byte-identical across re-runs). */
function withHeaders(entry: ServerEntry, headers?: Record<string, string>): ServerEntry {
  if (headers) entry.headers = headers;
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
