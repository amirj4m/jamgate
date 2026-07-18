import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClientId, Mode } from "./clients.js";
import {
  runSetup,
  runStatus,
  type ClaudeAddSpec,
  type ClaudeCli,
  type ClientResult,
  type SetupOptions,
} from "./runner.js";

/**
 * Terminal front-end for `jamgate setup` and `jamgate status`: parse argv, run the (pure-ish)
 * runner, and print a clear per-client report. Kept separate from `runner.ts` so the wiring
 * logic can be unit-tested without going through argv parsing or console output.
 */

const execFileAsync = promisify(execFile);

const VALID_CLIENTS: readonly ClientId[] = ["claude-code", "claude-desktop", "cursor", "windsurf"];

export interface ParsedSetupArgs {
  mode: Mode;
  url?: string;
  token?: string;
  dryRun: boolean;
  only?: ClientId[];
  /** A fatal argument error to report instead of running. */
  error?: string;
}

/** Parse `setup` flags: `--dry-run`, `--remote <url>`, `--token <token>`, `--client <id>...`. */
export function parseSetupArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedSetupArgs {
  let dryRun = false;
  let url: string | undefined;
  let token: string | undefined = env.JAMGATE_TOKEN;
  const only: ClientId[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--remote") {
      url = argv[++i];
      if (!url) return { mode: "remote", dryRun, error: "--remote requires a URL argument" };
    } else if (arg === "--token") {
      token = argv[++i];
      if (!token) return { mode: "stdio", dryRun, error: "--token requires a value" };
    } else if (arg === "--client") {
      const id = argv[++i] as ClientId;
      if (!VALID_CLIENTS.includes(id)) {
        return {
          mode: "stdio",
          dryRun,
          error: `unknown --client "${id}" (expected one of: ${VALID_CLIENTS.join(", ")})`,
        };
      }
      only.push(id);
    } else {
      return { mode: "stdio", dryRun, error: `unknown argument "${arg}"` };
    }
  }

  const mode: Mode = url ? "remote" : "stdio";
  if (mode === "remote" && !token) {
    return {
      mode,
      url,
      dryRun,
      error:
        "remote mode requires a bearer token — pass --token <token> or set JAMGATE_TOKEN " +
        "(it must match the token the remote jamgate server runs with)",
    };
  }

  return { mode, url, token, dryRun, only: only.length ? only : undefined };
}

/** The real `claude` CLI adapter. `isAvailable` probes `claude --version`; `add` shells out to
 *  `claude mcp add --scope user`. Both swallow failures into a boolean so the runner can fall
 *  back to a direct JSON merge rather than leaving Claude Code unwired. */
export const realClaudeCli: ClaudeCli = {
  async isAvailable() {
    try {
      await execFileAsync("claude", ["--version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  },
  async add(spec) {
    try {
      await execFileAsync("claude", claudeAddArgs(spec), { timeout: 30_000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, stderr: err instanceof Error ? err.message : String(err) };
    }
  },
  previewCommand(spec) {
    return `claude ${claudeAddArgs(spec).join(" ")}`;
  },
};

/** Build the argv for `claude mcp add` for a given transport (shared by add + previewCommand). */
function claudeAddArgs(spec: ClaudeAddSpec): string[] {
  if (spec.mode === "remote") {
    const args = ["mcp", "add", "--scope", "user", "--transport", "http", "jamgate", spec.url ?? ""];
    if (spec.token) args.push("--header", `Authorization: Bearer ${spec.token}`);
    return args;
  }
  return ["mcp", "add", "--scope", "user", "jamgate", "--", "npx", "jamgate"];
}

const SYMBOL: Record<ClientResult["outcome"], string> = {
  configured: "✓",
  updated: "✓",
  "already-configured": "•",
  "not-found": "–",
  skipped: "–",
  error: "✗",
};

function describe(r: ClientResult): string {
  const verb = r.dryRun ? "would be " : "";
  switch (r.outcome) {
    case "configured":
      return `${r.dryRun ? "would configure" : "configured"} (${r.transport})`;
    case "updated":
      return `${r.dryRun ? "would update" : "updated"} (${r.transport})`;
    case "already-configured":
      return "already configured";
    case "not-found":
      return "not found";
    case "skipped":
      return `${verb}skipped`;
    case "error":
      return "error";
  }
}

/** Format the setup report as lines of terminal text. */
export function formatSetupReport(results: ClientResult[], opts: { dryRun: boolean }): string {
  const lines: string[] = [];
  lines.push(opts.dryRun ? "jamgate setup — dry run (no files written)\n" : "jamgate setup\n");
  for (const r of results) {
    let line = `  ${SYMBOL[r.outcome]} ${r.label.padEnd(15)} ${describe(r)}`;
    if (r.detail && (r.outcome === "not-found" || r.outcome === "skipped" || r.outcome === "error")) {
      line += ` — ${r.detail}`;
    }
    lines.push(line);
    if (r.path && (r.outcome === "configured" || r.outcome === "updated")) {
      const via = r.method === "claude-cli" ? "claude mcp add" : r.path;
      lines.push(`      ${r.dryRun ? "target" : "via"}: ${via}${r.backedUp ? " (backup written)" : ""}`);
    }
  }
  const configured = results.filter((r) => r.outcome === "configured" || r.outcome === "updated");
  const already = results.filter((r) => r.outcome === "already-configured");
  lines.push("");
  if (opts.dryRun) {
    lines.push(
      `  ${configured.length} client(s) would change, ${already.length} already configured. ` +
        "Re-run without --dry-run to apply.",
    );
  } else {
    lines.push(
      `  Done: ${configured.length} configured, ${already.length} already configured. ` +
        "Restart your client(s) to pick up jamgate.",
    );
  }
  return lines.join("\n");
}

/** Format the status report as lines of terminal text. */
export function formatStatusReport(
  report: Awaited<ReturnType<typeof runStatus>>,
): string {
  const lines: string[] = ["jamgate status\n"];
  for (const c of report.clients) {
    const mark = c.wired ? "✓" : c.detected ? "•" : "–";
    const state = c.wired
      ? `wired (${c.transport})`
      : c.detected
        ? "detected, not wired"
        : "not found";
    lines.push(`  ${mark} ${c.label.padEnd(15)} ${state}`);
    if (c.wired && c.path) lines.push(`      ${c.path}`);
  }
  lines.push("");
  lines.push(`  store: ${report.storePath}`);
  return lines.join("\n");
}

/** Entry point for `jamgate setup`. Returns a process exit code. */
export async function setupCommand(
  argv: readonly string[],
  deps: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    claudeCli?: ClaudeCli;
    log?: (msg: string) => void;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((m: string) => console.log(m));
  const parsed = parseSetupArgs(argv, env);
  if (parsed.error) {
    log(`jamgate setup: ${parsed.error}`);
    return 1;
  }

  const options: SetupOptions = {
    mode: parsed.mode,
    url: parsed.url,
    token: parsed.token,
    dryRun: parsed.dryRun,
    only: parsed.only,
    platform: deps.platform,
    env,
    claudeCli: deps.claudeCli ?? realClaudeCli,
  };
  const results = await runSetup(options);
  log(formatSetupReport(results, { dryRun: parsed.dryRun }));
  return 0;
}

/** Entry point for `jamgate status`. Returns a process exit code. */
export async function statusCommand(
  deps: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    claudeCli?: ClaudeCli;
    log?: (msg: string) => void;
  } = {},
): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const report = await runStatus({
    env: deps.env,
    platform: deps.platform,
    claudeCli: deps.claudeCli ?? realClaudeCli,
  });
  log(formatStatusReport(report));
  return 0;
}
