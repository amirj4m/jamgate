// "Bring your memory with you" — read another AI product's memory export and turn it into
// store-ready `Memory[]` for the SAME gate a live save goes through (D-035).
//
// What the vendors actually ship (researched 2026-07; see README "Bring your memory with you"):
//
//   • claude.ai — the account data export (.zip) contains conversations and account data,
//     NOT your memory. Anthropic's own memory transfer path is TEXT: Settings → Capabilities →
//     "View and edit your memory", and the documented import shape is one entry per line as
//     "[date saved, if available] - memory content".
//   • ChatGPT — the data export (.zip) contains conversations.json, chat.html, user.json,
//     message_feedback.json, model_comparisons.json. Saved memories are NOT in it; they are
//     copied out of Settings → Personalization → Memory → Manage.
//
// So the primary format for BOTH vendors is a human-pasted text/markdown list, and that is what
// this parser is built around. We additionally accept JSON, best-effort, in case a future export
// does carry structured memory entries — and we accept the .zip / extracted folder directly,
// looking only at memory-shaped files inside it.
//
// DELIBERATE LINE: we never mine conversation logs. conversations.json / chat.html and friends
// are recognized and skipped by name, and reported as skipped. Reconstructing facts about a
// person from their raw chat history is exactly the privacy-heavy inference this project exists
// to avoid; the user curated their memory list, and that curated list is what we import.

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { deriveSubject } from "../gate/subject.js";
import type { Memory, MemoryType } from "../store/types.js";
import { readZipEntries, ZipError } from "./zip.js";

export type Vendor = "claude" | "chatgpt";

export const VENDORS: readonly Vendor[] = ["claude", "chatgpt"];

export function isVendor(v: string): v is Vendor {
  return (VENDORS as readonly string[]).includes(v);
}

/** Thrown when a vendor export cannot be turned into memories. The message is written for a
 *  human being told what to do next, not for a stack trace. */
export class VendorImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorImportError";
  }
}

/** One candidate file pulled out of a path, a folder, or a zip. */
export interface VendorSource {
  /** Display name — the path inside the archive/folder, or the file the user pointed at. */
  name: string;
  content: string;
}

export interface VendorParseResult {
  memories: Memory[];
  /** The files we actually read memories out of. */
  readFiles: string[];
  /** Conversation logs we recognized and deliberately did NOT mine. */
  skippedConversations: string[];
}

/** File extensions worth opening. Everything else in an export (images, audio) is ignored. */
const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt", ".markdown", ".text"]);

/** Don't slurp a multi-hundred-megabyte conversations.json into memory just to skip it. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Known vendor files that are conversation logs or account metadata — never memory. Matched on
 *  the basename, case-insensitively. Listing them explicitly is what makes "we do not mine your
 *  chats" a checked behavior rather than a promise. */
const CONVERSATION_FILES = new Set([
  "conversations.json",
  "conversation.json",
  "chat.html",
  "chat.json",
  "shared_conversations.json",
  "message_feedback.json",
  "model_comparisons.json",
  "projects.json",
]);

const ACCOUNT_FILES = new Set(["user.json", "users.json"]);

/** A basename that plausibly holds curated memory/profile entries. */
const MEMORY_HINT = /memor|preference|profile|personaliz|user[-_ ]?context|model[-_ ]?set[-_ ]?context/i;

// ───────────────────────────── loading: file | folder | zip ─────────────────────────────

/**
 * Read the candidate text files out of whatever the user pointed at: a single file, an
 * extracted export folder, or the export .zip itself.
 */
export async function loadVendorSources(
  path: string,
): Promise<{ sources: VendorSource[]; explicitFile: boolean }> {
  let stat;
  try {
    stat = await fs.stat(path);
  } catch (e) {
    throw new VendorImportError(`could not read ${path} — ${(e as Error).message}`);
  }

  if (stat.isDirectory()) return { sources: await loadFromDirectory(path), explicitFile: false };

  if (extname(path).toLowerCase() === ".zip" || (await looksLikeZip(path))) {
    return { sources: await loadFromZip(path), explicitFile: false };
  }

  if (stat.size > MAX_FILE_BYTES) {
    throw new VendorImportError(
      `${path} is ${Math.round(stat.size / 1e6)} MB — too large to be a memory list. ` +
        `If this is a conversation log, note that Jamgate never mines chat history.`,
    );
  }
  return {
    sources: [{ name: path, content: await fs.readFile(path, "utf8") }],
    explicitFile: true,
  };
}

async function looksLikeZip(path: string): Promise<boolean> {
  let fh;
  try {
    fh = await fs.open(path, "r");
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

async function loadFromDirectory(dir: string, depth = 0): Promise<VendorSource[]> {
  if (depth > 4) return [];
  const out: VendorSource[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await loadFromDirectory(full, depth + 1)));
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const { size } = await fs.stat(full);
    // Oversized files are still surfaced by name so the report can say we skipped them.
    out.push({ name: full, content: size > MAX_FILE_BYTES ? "" : await fs.readFile(full, "utf8") });
  }
  return out;
}

async function loadFromZip(path: string): Promise<VendorSource[]> {
  let entries;
  try {
    entries = readZipEntries(await fs.readFile(path));
  } catch (e) {
    if (e instanceof ZipError) throw new VendorImportError(`${path}: ${e.message}`);
    throw e;
  }
  return entries
    .filter((e) => TEXT_EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map((e) => ({
      name: e.name,
      content: e.size > MAX_FILE_BYTES ? "" : e.read().toString("utf8"),
    }));
}

// ───────────────────────────────────── parsing ─────────────────────────────────────

/**
 * Turn loaded sources into gate-ready memories.
 * `explicitFile` is true when the user pointed at ONE file — then we trust their aim and parse
 * it even if its name carries no "memory" hint (but still refuse a known conversation log).
 */
export function parseVendorExport(
  vendor: Vendor,
  sources: readonly VendorSource[],
  opts: { explicitFile?: boolean } = {},
): VendorParseResult {
  const skippedConversations: string[] = [];
  const candidates: VendorSource[] = [];

  for (const s of sources) {
    const base = basename(s.name).toLowerCase();
    if (CONVERSATION_FILES.has(base)) {
      skippedConversations.push(s.name);
      continue;
    }
    if (ACCOUNT_FILES.has(base)) continue;
    if (opts.explicitFile || MEMORY_HINT.test(base)) candidates.push(s);
  }

  if (candidates.length === 0) {
    throw new VendorImportError(noMemoryFileMessage(vendor, skippedConversations));
  }

  const memories: Memory[] = [];
  const readFiles: string[] = [];
  for (const c of candidates) {
    const entries = c.content.trim() ? parseSource(c) : [];
    if (entries.length === 0) continue;
    readFiles.push(c.name);
    for (const e of entries) memories.push(toMemory(e, vendor));
  }

  if (memories.length === 0) {
    throw new VendorImportError(
      `no memory entries found in ${candidates.map((c) => c.name).join(", ")}. ` +
        expectedShape(vendor),
    );
  }
  return { memories, readFiles, skippedConversations };
}

/** A memory statement plus, when the source carried one, the date it was originally saved. */
interface RawEntry {
  text: string;
  createdAt?: string;
}

function parseSource(source: VendorSource): RawEntry[] {
  const trimmed = source.content.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (extname(source.name).toLowerCase() === ".json" || looksJson) {
    try {
      return extractFromJson(JSON.parse(trimmed));
    } catch (e) {
      if (e instanceof SyntaxError && extname(source.name).toLowerCase() === ".json") {
        throw new VendorImportError(`${source.name} is not valid JSON (${e.message})`);
      }
      // A .md that merely starts with "[" is still a text list — fall through.
    }
  }
  return extractFromText(source.content);
}

// ── text: the shape both vendors' UIs actually give you ──

const BULLET = /^\s*(?:[-*•‣>]+|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const SECTION_LABEL = /^\s*[A-Za-z][A-Za-z ]{0,38}:\s*$/;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/** Leading-date forms we strip and keep: ISO, "March 14, 2026", "14/03/2026". A trailing
 *  "(saved 2026-03-14)" is handled too — the ChatGPT memory list renders dates that way. */
const LEADING_DATE = new RegExp(
  `^\\s*[\\[(]?\\s*(` +
    `\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?Z?)?` +
    `|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}` +
    `|\\d{1,2}/\\d{1,2}/\\d{4}` +
    `)\\s*[\\])]?\\s*(?:[-–—:|]\\s*)?`,
  "i",
);

const TRAILING_DATE = new RegExp(
  `\\s*[\\[(]\\s*(?:saved|added|updated)?\\s*[:\\s]?\\s*(` +
    `\\d{4}-\\d{2}-\\d{2}(?:[T ][\\d:.]+Z?)?` +
    `|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}` +
    `)\\s*[\\])]\\s*$`,
  "i",
);

export function extractFromText(raw: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let inFence = false;

  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line.trim() || HEADING.test(line) || RULE.test(line) || SECTION_LABEL.test(line)) continue;

    let text = line.replace(BULLET, "").trim();
    let createdAt: string | undefined;

    // A matched date prefix/suffix is always stripped from the statement, even when it is not
    // parseable (e.g. an ambiguous 14/03/2026) — leaving it in would pollute the memory text.
    const lead = LEADING_DATE.exec(text);
    if (lead) {
      createdAt = toIso(lead[1]);
      text = text.slice(lead[0].length).trim();
    }
    if (!createdAt) {
      const trail = TRAILING_DATE.exec(text);
      if (trail) {
        createdAt = toIso(trail[1]);
        text = text.slice(0, trail.index).trim();
      }
    }

    text = text.replace(/^["'“”]|["'“”]$/g, "").trim();
    if (text.length < 4) continue; // same floor the live gate's prefilter uses
    entries.push(createdAt ? { text, createdAt } : { text });
  }
  return entries;
}

// ── json: best-effort, for exports that do carry structured entries ──

const TEXT_KEYS = ["text", "content", "memory", "value", "statement", "fact", "summary", "body"];
const DATE_KEYS = [
  "created_at", "createdAt", "create_time", "saved_at", "savedAt", "updated_at", "updatedAt",
  "update_time", "timestamp", "date", "time",
];
const MEMORY_KEYS =
  /^(memories|memory|entries|saved_memories|savedMemories|user_memories|model_set_context|modelSetContext|facts|preferences|profile|items)$/i;

/** Walk arbitrary JSON and collect anything shaped like a memory entry. Deliberately tolerant:
 *  we cannot pin a schema we have not been able to verify, so we look for the shapes a memory
 *  list plausibly takes and fail loudly when we find none. */
export function extractFromJson(root: unknown): RawEntry[] {
  const out: RawEntry[] = [];
  walk(root, "", 0, out);
  return out;
}

function walk(node: unknown, key: string, depth: number, out: RawEntry[]): void {
  if (depth > 8 || node == null) return;

  if (Array.isArray(node)) {
    for (const el of node) {
      if (typeof el === "string") {
        // A bare string list only counts under a memory-ish key — otherwise every string
        // array in an unrelated file would become "memories".
        const text = el.trim();
        if (MEMORY_KEYS.test(key) && text.length >= 4) out.push({ text });
      } else if (el && typeof el === "object") {
        const entry = recordToEntry(el as Record<string, unknown>);
        if (entry) out.push(entry);
        else walk(el, key, depth + 1, out);
      }
    }
    return;
  }

  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && MEMORY_KEYS.test(k)) {
        // `{ "memory": "..." }` — a single statement rather than a list.
        for (const e of extractFromText(v)) out.push(e);
        continue;
      }
      walk(v, k, depth + 1, out);
    }
  }
}

function recordToEntry(o: Record<string, unknown>): RawEntry | undefined {
  let text: string | undefined;
  for (const k of TEXT_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim().length >= 4) {
      text = v.trim();
      break;
    }
  }
  if (!text) return undefined;

  for (const k of DATE_KEYS) {
    const iso = toIso(o[k]);
    if (iso) return { text, createdAt: iso };
  }
  return { text };
}

/** Normalize whatever a vendor calls a date into an ISO string, or undefined if it isn't one.
 *  Numbers are epoch seconds (ChatGPT's `create_time`) or milliseconds. Unparseable input is
 *  dropped rather than guessed at — the record then simply gets "imported now". */
function toIso(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v !== "string" || !v.trim()) return undefined;
  const ms = Date.parse(v.trim());
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// ───────────────────────────────── mapping to our schema ─────────────────────────────────

/** Strong, unambiguous identity markers. Checked first: "lives in Berlin" is identity even
 *  though a preference verb may appear later in the sentence. */
const IDENTITY = /\b(name is|named|goes by|call me|lives? in|living in|based in|resides?|works? (?:as|at|for)|is an? |pronouns|speaks?|nationality|born in|birthday)\b/i;

/** Preference markers. Anything else stays UNTYPED on purpose — a wrong type is worse than
 *  no type, and untyped memories are still recalled, just never auto-expired. */
const PREFERENCE = /\b(prefers?|preferred|likes?|dislikes?|loves?|hates?|favou?rite|enjoys?|wants?|avoids?|instead of|always|never)\b/i;

export function inferType(text: string): MemoryType | undefined {
  if (IDENTITY.test(text)) return "identity";
  if (PREFERENCE.test(text)) return "preference";
  return undefined;
}

/** Provenance stamp for imported records: which product the memory came out of. */
export function vendorClientName(vendor: Vendor): string {
  return vendor === "claude" ? "import:claude.ai" : "import:chatgpt";
}

function toMemory(entry: RawEntry, vendor: Vendor): Memory {
  const created = entry.createdAt ?? new Date().toISOString();
  const memory: Memory = {
    id: randomUUID(),
    text: entry.text,
    // The user curated these entries in the source product — that is a confirmation, not an
    // agent's inference. It is NOT "user-explicit": they did not dictate them to Jamgate.
    source: "user-confirmed",
    status: "active",
    createdAt: created,
    updatedAt: created,
    client: { name: vendorClientName(vendor) },
  };
  const type = inferType(entry.text);
  if (type) memory.type = type;
  const subject = deriveSubject(entry.text);
  if (subject) memory.subject = subject;
  return memory;
}

// ───────────────────────────────────── messages ─────────────────────────────────────

function expectedShape(vendor: Vendor): string {
  const where =
    vendor === "claude"
      ? "Settings → Capabilities → “View and edit your memory”"
      : "Settings → Personalization → Memory → “Manage memories”";
  return (
    `Expected one memory per line, optionally dated, e.g.:\n` +
    `  2026-03-14 - Prefers TypeScript over JavaScript\n` +
    `  - Lives in Berlin\n` +
    `Copy your memory list from ${where} into a .md or .txt file and import that.`
  );
}

function noMemoryFileMessage(vendor: Vendor, skipped: readonly string[]): string {
  const product = vendor === "claude" ? "Claude" : "ChatGPT";
  const seen =
    skipped.length > 0
      ? `\nFound conversation logs (${skipped.join(", ")}) — Jamgate never mines chat history.`
      : "";
  return (
    `no memory file found. ${product}'s account data export does not contain your memory ` +
    `entries — as of July 2026 they are only available from the app's own memory settings.` +
    seen +
    `\n${expectedShape(vendor)}`
  );
}
