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
import type {
  ClientInfo,
  MemorySource,
  MemoryStore,
  MemoryType,
  SaveResult,
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

/** A prefilter rejection (nothing stored), or the store's `SaveResult` on a call that reached
 *  the stateful gate. Mirrors the two ways a save ends so each transport can render its own reply. */
export type GateSaveOutcome =
  | { ok: false; reason: string }
  | { ok: true; result: SaveResult };

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
    return { ok: false, reason: verdict.reason ?? "rejected" };
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

  return { ok: true, result };
}
