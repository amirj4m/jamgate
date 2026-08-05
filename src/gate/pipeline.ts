// The shared save pipeline (D-049).
//
// A save has to pass the SAME gate no matter which transport it arrives on — the MCP
// `save_memory` tool (stdio or HTTP) and the REST `POST /v1/memory` endpoint both funnel
// through here. Factoring it out is what guarantees they can never drift: one prefilter, one
// subject derivation, one `store.save`, one gate-log append. The transports keep only their
// own concerns — argument shape and response formatting.

import { prefilter } from "./prefilter.js";
import { deriveSubject } from "./subject.js";
import { appendGateLog, resolveGateLogConfig, type GateDecision, type GateLogConfig } from "./log.js";
import {
  isMemorySource,
  isMemoryType,
  MEMORY_SOURCES,
  MEMORY_TYPES,
  type ClientInfo,
  type ForgetResult,
  type MemorySource,
  type MemoryStore,
  type MemoryType,
  type SaveResult,
} from "../store/types.js";

/** The already-extracted arguments of a save, transport-independent. `text` is a validated
 *  non-empty string by the time it reaches here; the transport handles missing/misnamed fields
 *  (and the `content`/`memory` aliases, D-039) before calling. */
export interface GateSaveInput {
  text: string;
  type?: string;
  subject?: string;
  source?: string;
  /** The namespace to save into (D-048). Undefined/empty → the default scope. */
  scope?: string;
  /** Server-observed provenance from the MCP handshake (D-024); undefined over REST. */
  client?: ClientInfo;
}

/**
 * How a save ended, in three kinds so each transport can render the right reply:
 *
 *  - `invalid_argument` — the CALL was malformed (an unknown `type`/`source`). This is a usage
 *    error, not a verdict about the memory (D-037): nothing is judged, nothing is logged as a
 *    gate decision, and the transport answers with an error (tool `isError` / HTTP 400).
 *  - `rejected` — the prefilter judged the CONTENT and turned it away (junk, a credential, …).
 *    The request was well-formed, so this is a normal answer, and it IS logged.
 *  - ok — the call reached the stateful gate; `result` carries its action.
 */
export type GateSaveOutcome =
  | { ok: false; kind: "invalid_argument"; reason: string }
  | { ok: false; kind: "rejected"; reason: string }
  | { ok: true; result: SaveResult; notices: string[] };

/**
 * Run one save through the full gate: cheap prefilter (junk/secret/pleasantry/…), best-effort
 * subject derivation, the stateful store gate (dedup / supersession / conflict / near-duplicate,
 * all scoped per D-048), and the local gate-decision log. Best-effort, non-throwing logging is
 * inherited from {@link appendGateLog}; a rejection is logged too (with the text redacted when
 * the prefilter flagged a credential, D-042).
 */
export async function saveThroughGate(
  store: MemoryStore,
  input: GateSaveInput,
  gateLog: GateLogConfig = resolveGateLogConfig(),
): Promise<GateSaveOutcome> {
  // Validate the enums BEFORE judging the content (D-037, D-054). The `type` the caller sends
  // decides the memory's lifespan, so an unrecognized value is not a harmless typo — it used
  // to fall through `computeExpiresAt` as "no TTL" and become a permanent record. Refuse it
  // and name the accepted values; the caller is the only party that can correct the call.
  if (input.type !== undefined && !isMemoryType(input.type)) {
    return {
      ok: false,
      kind: "invalid_argument",
      reason:
        `unknown type ${JSON.stringify(input.type)} — must be one of ` +
        `${MEMORY_TYPES.join(", ")}. Nothing was saved and the gate did not judge this call. ` +
        `The type sets how long the memory lives, so it is never guessed`,
    };
  }
  if (input.source !== undefined && !isMemorySource(input.source)) {
    return {
      ok: false,
      kind: "invalid_argument",
      reason:
        `unknown source ${JSON.stringify(input.source)} — must be one of ` +
        `${MEMORY_SOURCES.join(", ")}. Nothing was saved and the gate did not judge this call. ` +
        `The source sets how much the gate trusts this memory against a conflicting one`,
    };
  }

  const verdict = prefilter(input.text, { type: input.type });
  if (!verdict.ok) {
    await appendGateLog(
      {
        decision: "rejected",
        reason: verdict.reason,
        type: input.type,
        subject: input.subject,
        source: input.source,
        scope: input.scope,
        client: input.client?.name,
        text: verdict.redact ? `[redacted: ${input.text.length} characters]` : input.text,
      },
      gateLog,
    );
    return { ok: false, kind: "rejected", reason: verdict.reason ?? "rejected" };
  }

  // Use the caller's subject when given; else derive one conservatively (D-027).
  const subject =
    input.subject && input.subject.trim() !== "" ? input.subject : deriveSubject(input.text);

  const result = await store.save({
    text: input.text,
    type: input.type as MemoryType | undefined,
    source: (input.source as MemorySource | undefined) ?? "agent-inferred",
    subject,
    scope: input.scope,
    client: input.client,
  });

  const decision: GateDecision = result.action === "created" ? "saved" : result.action;
  await appendGateLog(
    {
      decision,
      type: result.memory.type,
      subject: result.memory.subject,
      source: result.memory.source,
      scope: result.memory.scope,
      client: result.memory.client?.name,
      text: result.memory.text,
    },
    gateLog,
  );

  return { ok: true, result, notices: shortLifespanNotices(result) };
}

/**
 * Delete one memory and record the deletion in the SAME log as the saves (D-056).
 *
 * `forget` used to write nothing. The gate log is the training corpus for the future
 * classifier (D-025), and a corpus that records every acceptance and no reversal teaches the
 * wrong lesson twice over: it presents memories the user later threw away as good examples,
 * and it hides the correction signal entirely. Auditing the real store made the gap concrete —
 * 24 production log-writes had no surviving record and the log offered no explanation for a
 * single one of them, so the log could not be reconciled with the store at all.
 *
 * Only a SUCCESSFUL delete is logged, and it carries the deleted memory's own text and
 * metadata (which is why `forget` hands the record back). A not-found or ambiguous id is a
 * usage error about an identifier, not a decision about a memory — same line D-037 draws.
 */
export async function forgetThroughGate(
  store: MemoryStore,
  idOrPrefix: string,
  scope: string | undefined,
  gateLog: GateLogConfig = resolveGateLogConfig(),
): Promise<ForgetResult> {
  const result = await store.forget(idOrPrefix, scope);
  if (result.ok && result.memory) {
    const m = result.memory;
    await appendGateLog(
      {
        decision: "forgotten",
        type: m.type,
        subject: m.subject,
        source: m.source,
        scope: m.scope,
        client: m.client?.name,
        text: m.text,
      },
      gateLog,
    );
  }
  return result;
}

/** A human-sourced memory must never go dark silently (D-055). */
const SHORT_LIFESPAN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Warnings the transport must show the caller alongside a successful save.
 *
 * Today there is exactly one, and it comes from real data: auditing the production store found
 * that 17 of 39 live records — 44% — were expired and invisible to recall. All were `state`
 * (a 2-day TTL) and twelve were `user-explicit`: a human had said "remember this" and the
 * memory was unreachable two days later, with nothing in the log, the reply or recall to say
 * so. One capture session's worth of someone's financial life went dark unannounced.
 *
 * The TTL itself is right (RULES §4) and refusing the combination would be wrong — a genuinely
 * short-lived fact explicitly given is legitimate. What was wrong is the SILENCE. So the save
 * still happens exactly as asked, and the caller is told the expiry date and how to make it
 * durable, while it still has the context to decide.
 *
 * Scoped to human-sourced saves (`user-explicit` / `user-confirmed`) because those are the ones
 * where a human's intent is on record; an agent-inferred state note expiring is the system
 * working as designed and does not need a line of output every time.
 */
function shortLifespanNotices(result: SaveResult): string[] {
  const m = result.memory;
  if (result.action !== "created" && result.action !== "superseded") return [];
  if (m.source !== "user-explicit" && m.source !== "user-confirmed") return [];
  if (!m.expiresAt) return [];
  const lifespanMs = new Date(m.expiresAt).getTime() - new Date(m.createdAt).getTime();
  if (!Number.isFinite(lifespanMs) || lifespanMs > SHORT_LIFESPAN_MS) return [];
  return [
    `This was saved as type "${m.type}", which expires on ${m.expiresAt.slice(0, 10)} — ` +
      `after that it stays on disk but is hidden from recall, and is eventually compacted. ` +
      `It came from "${m.source}", so if the user meant it to LAST, re-save it as "identity" ` +
      `or "preference" (never expire) or "project" (months). If it really is a passing state, ` +
      `nothing to do.`,
  ];
}
