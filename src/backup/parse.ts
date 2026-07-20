// Parse + validate + normalize an export file into store-ready `Memory[]` (D-033).
//
// `jamgate import` must accept both our own export envelope (`{ schemaVersion, memories }`,
// same shape the store writes on disk) AND a bare JSON array of records, and it must reject a
// malformed file loudly (exit nonzero) instead of feeding junk into the gate. Normalization is
// lenient about MISSING optional fields — a hand-written `[{ "text": "..." }]` is valid and gets
// sensible defaults — but strict about the one thing every memory needs: non-empty `text`.
//
// Provenance is preserved, never reset: a record's own id, createdAt/updatedAt, source, subject,
// type, expiresAt, supersession pointers, client and embedding all carry through untouched when
// present. Only genuinely absent fields are defaulted, so a round-trip export→import is faithful.

import { randomUUID } from "node:crypto";
import type {
  ClientInfo,
  Memory,
  MemorySource,
  MemoryStatus,
  MemoryType,
} from "../store/types.js";

/** Thrown when an import file is not shaped like an export (bad JSON, wrong top-level shape, or a
 *  record missing required `text`). The CLI turns this into a nonzero exit and writes nothing. */
export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

const SOURCES: readonly MemorySource[] = ["agent-inferred", "user-confirmed", "user-explicit"];
const STATUSES: readonly MemoryStatus[] = ["active", "superseded"];
const TYPES: readonly MemoryType[] = ["identity", "project", "preference", "state"];

/**
 * Parse a raw file body into normalized, store-ready memories.
 * Accepts either `{ ..., memories: [...] }` (our envelope / the on-disk shape) or a bare `[...]`.
 * Throws `ImportValidationError` on any malformed input, so the caller can fail the whole import
 * atomically before touching the store.
 */
export function parseImportFile(raw: string): Memory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ImportValidationError(`not valid JSON (${(err as Error).message})`);
  }

  let rawRecords: unknown;
  if (Array.isArray(parsed)) {
    rawRecords = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { memories?: unknown }).memories)
  ) {
    rawRecords = (parsed as { memories: unknown[] }).memories;
  } else {
    throw new ImportValidationError(
      'expected a JSON array of memories, or an object with a "memories" array',
    );
  }

  return (rawRecords as unknown[]).map((r, i) => normalizeRecord(r, i));
}

/** Validate one record and fill defaults for any missing fields, preserving everything present. */
function normalizeRecord(raw: unknown, index: number): Memory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ImportValidationError(`record #${index} is not a JSON object`);
  }
  const o = raw as Record<string, unknown>;

  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) {
    throw new ImportValidationError(`record #${index} is missing a non-empty "text" field`);
  }

  const createdAt = isoOr(o.createdAt);
  const now = new Date().toISOString();
  const created = createdAt ?? now;

  const memory: Memory = {
    id: typeof o.id === "string" && o.id.trim() ? o.id : randomUUID(),
    text,
    source: SOURCES.includes(o.source as MemorySource)
      ? (o.source as MemorySource)
      : "agent-inferred",
    status: STATUSES.includes(o.status as MemoryStatus) ? (o.status as MemoryStatus) : "active",
    createdAt: created,
    updatedAt: isoOr(o.updatedAt) ?? created,
  };

  // Optional fields: carry through only when present and well-typed, so provenance survives.
  if (TYPES.includes(o.type as MemoryType)) memory.type = o.type as MemoryType;
  if (typeof o.subject === "string" && o.subject.trim()) memory.subject = o.subject;
  const expiresAt = isoOr(o.expiresAt);
  if (expiresAt) memory.expiresAt = expiresAt;
  if (typeof o.supersededBy === "string" && o.supersededBy) memory.supersededBy = o.supersededBy;
  const supersededAt = isoOr(o.supersededAt);
  if (supersededAt) memory.supersededAt = supersededAt;
  const client = normalizeClient(o.client);
  if (client) memory.client = client;
  if (Array.isArray(o.embedding) && o.embedding.every((n) => typeof n === "number")) {
    memory.embedding = o.embedding as number[];
  }

  return memory;
}

/** A `{ name, version? }` client block, or undefined if the input isn't one. */
function normalizeClient(raw: unknown): ClientInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) return undefined;
  return typeof o.version === "string" ? { name: o.name, version: o.version } : { name: o.name };
}

/** Return `v` when it is a string parseable as a real date, else undefined. Keeps a malformed
 *  timestamp from silently becoming `Invalid Date` downstream. */
function isoOr(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  return Number.isNaN(Date.parse(v)) ? undefined : v;
}
