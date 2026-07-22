import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  CLIENTS,
  buildEntry,
  type ClientDef,
  type ClientId,
  type Mode,
  type ServerEntry,
} from "./clients.js";
import { planMerge } from "./merge.js";

/**
 * The IO layer of `jamgate setup` / `jamgate status`. Given a platform + environment (both
 * injectable so tests run entirely against a temp home), it detects installed MCP clients,
 * wires Jamgate into each safely, and reports per-client outcomes.
 *
 * Safety guarantees (see DECISIONS D-030):
 *  - Idempotent: a second run changes nothing.
 *  - Never clobbers other servers or other fields — only the `jamgate` key is managed.
 *  - Backs up any config file to `<file>.jamgate-backup` before overwriting it.
 *  - `--dry-run` computes and reports every change without writing anything.
 */

/** The suffix appended to a config file to hold its pre-write backup. */
export const BACKUP_SUFFIX = ".jamgate-backup";

/** Adapter over the `claude` CLI so the runner can prefer `claude mcp add` when present while
 *  staying unit-testable (tests inject a fake, or omit it to force the JSON-merge path). */
export interface ClaudeCli {
  /** Is the `claude` binary available to run? */
  isAvailable(): Promise<boolean>;
  /** Add the jamgate server at user scope. Resolves ok:false (with stderr) on any failure so
   *  the runner can fall back to a direct JSON merge rather than leaving the client unwired. */
  add(spec: ClaudeAddSpec): Promise<{ ok: boolean; stderr?: string }>;
  /** The command line that {@link add} would run, for `--dry-run` reporting. */
  previewCommand(spec: ClaudeAddSpec): string;
}

export interface ClaudeAddSpec {
  mode: Mode;
  url?: string;
  token?: string;
}

export type Outcome =
  | "configured"
  | "already-configured"
  | "updated"
  | "not-found"
  | "skipped"
  | "error";

export interface ClientResult {
  id: ClientId;
  label: string;
  path: string | null;
  transport: Mode;
  outcome: Outcome;
  /** How the write was performed (present only when we configured/updated). */
  method?: "claude-cli" | "json-merge";
  /** True when a pre-existing config file was backed up before writing. */
  backedUp: boolean;
  /** True when this was a preview (`--dry-run`) and nothing was written. */
  dryRun: boolean;
  /** Human-readable reason for not-found / skipped / error, or extra context. */
  detail?: string;
}

export interface SetupOptions {
  mode: Mode;
  url?: string;
  token?: string;
  dryRun: boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Optional `claude` CLI adapter; when available it is preferred for Claude Code. */
  claudeCli?: ClaudeCli;
  /** Restrict the run to specific clients (defaults to all). */
  only?: ClientId[];
}

/** Does a wired entry describe a remote (HTTP) transport? Remote entries carry a URL field —
 *  `url`, or a client-specific alias (`httpUrl` for Gemini, `serverUrl` for Windsurf) — whereas
 *  stdio entries carry `command`. Used only for status reporting. */
function isRemoteEntry(entry: Record<string, unknown>): boolean {
  return "url" in entry || "httpUrl" in entry || "serverUrl" in entry;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Read + JSON-parse a config file. Returns undefined if the file is absent, and the special
 *  { __malformed: true } marker if it exists but isn't valid JSON (so we still back it up). */
async function readConfig(
  path: string,
): Promise<{ existing: unknown; malformed: boolean; fileExists: boolean }> {
  if (!(await pathExists(path))) return { existing: undefined, malformed: false, fileExists: false };
  const raw = await fs.readFile(path, "utf8");
  if (raw.trim() === "") return { existing: undefined, malformed: false, fileExists: true };
  try {
    return { existing: JSON.parse(raw), malformed: false, fileExists: true };
  } catch {
    return { existing: undefined, malformed: true, fileExists: true };
  }
}

/** Atomically-ish write: back up any existing file, then write pretty JSON with a trailing
 *  newline (matches how these editors format their own configs). */
async function writeConfig(
  path: string,
  config: Record<string, unknown>,
  fileExists: boolean,
): Promise<boolean> {
  await fs.mkdir(dirname(path), { recursive: true });
  let backedUp = false;
  if (fileExists) {
    await fs.copyFile(path, path + BACKUP_SUFFIX);
    backedUp = true;
  }
  await fs.writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return backedUp;
}

/** Is the given client installed on this machine? A config file/dir existing is the signal;
 *  Claude Code additionally counts as present when the `claude` CLI is available. */
async function isDetected(
  client: ClientDef,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  claudeCli?: ClaudeCli,
): Promise<boolean> {
  for (const p of client.detectPaths(platform, env)) {
    if (await pathExists(p)) return true;
  }
  if (client.id === "claude-code" && claudeCli && (await claudeCli.isAvailable())) return true;
  return false;
}

async function configureClient(
  client: ClientDef,
  opts: Required<Pick<SetupOptions, "mode" | "dryRun">> &
    Pick<SetupOptions, "url" | "token" | "claudeCli">,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<ClientResult> {
  const base: ClientResult = {
    id: client.id,
    label: client.label,
    path: client.configPath(platform, env),
    transport: opts.mode,
    outcome: "not-found",
    backedUp: false,
    dryRun: opts.dryRun,
  };

  // Remote mode only applies to clients that actually speak Streamable HTTP.
  if (opts.mode === "remote" && !client.supportsRemote) {
    return {
      ...base,
      outcome: "skipped",
      detail: "no verified HTTP transport — install stdio instead, or use a connector",
    };
  }

  if (!(await isDetected(client, platform, env, opts.claudeCli))) {
    return { ...base, outcome: "not-found", detail: "client not detected on this machine" };
  }

  const path = base.path;
  if (!path) {
    return { ...base, outcome: "skipped", detail: "no supported config path on this platform" };
  }

  const entry: ServerEntry = buildEntry(client, {
    mode: opts.mode,
    url: opts.url,
    token: opts.token,
  });

  // Decide the outcome from the current file state first (uniform across CLI and merge paths).
  const { existing, malformed, fileExists } = await readConfig(path);

  // Safety guard for SHARED config files (Gemini/Zed/OpenCode): if the file exists but doesn't
  // parse as strict JSON (almost always `//` comments), we must NOT rewrite it — doing so would
  // clobber the user's entire settings down to just our entry. Skip with a clear pointer instead.
  // Dedicated MCP-only files (Cursor, Cline, …) keep the tolerant "rewrite malformed" behaviour,
  // since there the backup already covers the only thing at risk.
  if (client.sharedConfig && malformed && fileExists) {
    return {
      ...base,
      outcome: "skipped",
      detail: `existing config isn't plain JSON (comments?) — add jamgate to ${client.containerKey} manually to keep it intact`,
    };
  }

  const plan = planMerge(existing, client.serverKey, entry, client.containerKey);

  if (plan.status === "already-configured") {
    return { ...base, outcome: "already-configured" };
  }

  const outcome: Outcome = plan.status === "updated" ? "updated" : "configured";

  // Prefer `claude mcp add` for a FRESH Claude Code add when the CLI is present; updates and
  // every other case go through the deterministic JSON merge (which cleanly replaces our key).
  const useCli =
    client.id === "claude-code" &&
    opts.claudeCli !== undefined &&
    plan.status !== "updated" &&
    (await opts.claudeCli.isAvailable());

  if (opts.dryRun) {
    const detail =
      useCli && opts.claudeCli
        ? `would run: ${opts.claudeCli.previewCommand({ mode: opts.mode, url: opts.url, token: opts.token })}`
        : malformed
          ? "would rewrite malformed config (original backed up)"
          : `would write ${path}`;
    return {
      ...base,
      outcome,
      method: useCli ? "claude-cli" : "json-merge",
      detail,
    };
  }

  if (useCli && opts.claudeCli) {
    const res = await opts.claudeCli.add({ mode: opts.mode, url: opts.url, token: opts.token });
    if (res.ok) {
      return { ...base, outcome, method: "claude-cli" };
    }
    // CLI failed for some reason — fall through to the JSON merge so the client still gets wired.
  }

  const backedUp = await writeConfig(path, plan.config, fileExists);
  return { ...base, outcome, method: "json-merge", backedUp };
}

/** Run `jamgate setup` across all (or a subset of) clients. */
export async function runSetup(opts: SetupOptions): Promise<ClientResult[]> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const clients = CLIENTS.filter((c) => !opts.only || opts.only.includes(c.id));

  const results: ClientResult[] = [];
  for (const client of clients) {
    try {
      results.push(
        await configureClient(
          client,
          {
            mode: opts.mode,
            dryRun: opts.dryRun,
            url: opts.url,
            token: opts.token,
            claudeCli: opts.claudeCli,
          },
          platform,
          env,
        ),
      );
    } catch (err) {
      results.push({
        id: client.id,
        label: client.label,
        path: client.configPath(platform, env),
        transport: opts.mode,
        outcome: "error",
        backedUp: false,
        dryRun: opts.dryRun,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export interface ClientStatus {
  id: ClientId;
  label: string;
  path: string | null;
  detected: boolean;
  wired: boolean;
  /** The transport of the wired entry, if any ("stdio" | "http"). */
  transport?: string;
}

export interface StatusReport {
  clients: ClientStatus[];
  /** Where the default memory store lives. */
  storePath: string;
}

/** Inspect where Jamgate is wired and where its store lives, without changing anything. */
export async function runStatus(opts: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  claudeCli?: ClaudeCli;
  storePath?: string;
} = {}): Promise<StatusReport> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const clients: ClientStatus[] = [];
  for (const client of CLIENTS) {
    const path = client.configPath(platform, env);
    const detected = await isDetected(client, platform, env, opts.claudeCli);
    let wired = false;
    let transport: string | undefined;
    if (path) {
      const { existing } = await readConfig(path);
      const servers =
        existing && typeof existing === "object" && existing !== null
          ? (existing as Record<string, unknown>)[client.containerKey]
          : undefined;
      const entry =
        servers && typeof servers === "object" && servers !== null
          ? (servers as Record<string, unknown>)[client.serverKey]
          : undefined;
      if (entry && typeof entry === "object") {
        wired = true;
        transport = isRemoteEntry(entry as Record<string, unknown>) ? "http" : "stdio";
      }
    }
    clients.push({ id: client.id, label: client.label, path, detected, wired, transport });
  }

  // Mirror the store's own path resolution (FileStore: JAMGATE_STORE ?? ~/.jamgate/memory.json)
  // so status reports where memories actually live.
  const storePath =
    opts.storePath ??
    env.JAMGATE_STORE ??
    join(env.HOME || env.USERPROFILE || homedir(), ".jamgate", "memory.json");
  return { clients, storePath };
}
