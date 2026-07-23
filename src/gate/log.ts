// Local-only gate decision log (Phase 3, item 3).
//
// Every save runs through the gate and comes out with a decision: saved, duplicate,
// superseded, conflict, possible_duplicate, or rejected — each with a reason. Appending
// those decisions to a local JSONL file gives us real, labelled data to later train the
// thin "is this worth keeping?" classifier (D-004) on actual usage instead of guesses.
//
// STRICTLY LOCAL. This log never leaves the machine — same local-first promise as the
// store (D-010). It lives next to the store (~/.jamgate/gate.log by default), is
// size-capped with single-file rotation so it can't grow without bound, and logging can be
// turned off entirely (JAMGATE_GATE_LOG=off). Logged text is truncated to keep lines small
// (so appends stay atomic on POSIX) and to bound the footprint. Logging is best-effort: a
// failure to write the log must NEVER fail or slow the user's save, so all errors are
// swallowed to stderr.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_SCOPE } from "../store/scope.js";

export type GateDecision =
  | "saved"
  | "duplicate"
  | "superseded"
  | "conflict"
  | "possible_duplicate"
  | "rejected";

export interface GateLogEntry {
  decision: GateDecision;
  /** Why the gate decided this — the prefilter reason, or a short note on the outcome. */
  reason?: string;
  type?: string;
  subject?: string;
  source?: string;
  /** The namespace this decision happened in (D-048). Logged only for a non-default scope,
   *  so single-tenant logs keep their exact pre-namespace shape. */
  scope?: string;
  /** The MCP client name from the handshake (D-024), if known. */
  client?: string;
  /** The memory text (truncated). This is the classifier's main training signal. */
  text: string;
}

export interface GateLogConfig {
  /** Absolute path to the log file, or null to disable logging. */
  path: string | null;
  /** Rotate once the file exceeds this many bytes. */
  maxBytes: number;
  /** Truncate logged text to this many characters. */
  maxTextChars: number;
}

const DEFAULT_PATH = join(homedir(), ".jamgate", "gate.log");
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_MAX_TEXT_CHARS = 500;

/** Resolve logging config from the environment (all overridable). `JAMGATE_GATE_LOG` sets
 *  the path; `off`/`none`/`0` disables. `JAMGATE_GATE_LOG_MAX_BYTES` caps the size. */
export function resolveGateLogConfig(env: NodeJS.ProcessEnv = process.env): GateLogConfig {
  const raw = env.JAMGATE_GATE_LOG?.trim();
  const disabled = raw !== undefined && ["off", "none", "0", ""].includes(raw.toLowerCase());
  // The log belongs NEXT TO THE STORE. Defaulting to the home directory broke every
  // hardened deployment: under systemd `ProtectHome=true` / `ProtectSystem=strict` the
  // service cannot write `~/.jamgate`, so every append failed and the audit trail was
  // silently empty — exactly when a production bug needed it (D-037). Follow JAMGATE_STORE
  // when it is set; an explicit JAMGATE_GATE_LOG still wins over both.
  const path = disabled
    ? null
    : raw && raw.length > 0
      ? raw
      : env.JAMGATE_STORE
        ? join(dirname(env.JAMGATE_STORE), "gate.log")
        : DEFAULT_PATH;

  const maxBytesRaw = Number(env.JAMGATE_GATE_LOG_MAX_BYTES);
  const maxBytes =
    Number.isFinite(maxBytesRaw) && maxBytesRaw > 0 ? maxBytesRaw : DEFAULT_MAX_BYTES;

  return { path, maxBytes, maxTextChars: DEFAULT_MAX_TEXT_CHARS };
}

/**
 * Append one gate decision to the log. Best-effort and non-throwing: any error is
 * swallowed to stderr so logging can never break a save. Rotates the log to `<path>.1`
 * (overwriting the previous rotation) once it exceeds `maxBytes`, bounding disk use to
 * roughly 2× the cap.
 */
export async function appendGateLog(
  entry: GateLogEntry,
  config: GateLogConfig = resolveGateLogConfig(),
): Promise<void> {
  if (config.path === null) return; // logging disabled
  try {
    const dir = dirname(config.path);
    await fs.mkdir(dir, { recursive: true });
    await rotateIfNeeded(config.path, config.maxBytes);

    const record = {
      ts: new Date().toISOString(),
      decision: entry.decision,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.type ? { type: entry.type } : {}),
      ...(entry.subject ? { subject: entry.subject } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      // Only record a non-default scope, so a single-tenant log line is byte-for-byte what
      // it was before namespaces (D-048).
      ...(entry.scope && entry.scope !== DEFAULT_SCOPE ? { scope: entry.scope } : {}),
      ...(entry.client ? { client: entry.client } : {}),
      text: truncate(entry.text, config.maxTextChars),
    };
    await fs.appendFile(config.path, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    // Never let a diagnostic log break the actual save.
    console.error("jamgate: gate log write failed (ignored):", err);
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Rotate `path` → `path.1` when it grows past `maxBytes`. Single-file rotation keeps the
 *  most recent two generations; older data is intentionally discarded (this is a rolling
 *  training buffer, not an audit log). */
async function rotateIfNeeded(path: string, maxBytes: number): Promise<void> {
  try {
    const { size } = await fs.stat(path);
    if (size >= maxBytes) await fs.rename(path, `${path}.1`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // no file yet → nothing to rotate
  }
}
