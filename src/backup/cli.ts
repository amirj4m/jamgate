// Terminal front-end for `jamgate export` and `jamgate import` (D-033).
//
// export → dump the store as JSON (stdout or a file) for backup / migrating machines /
//          moving a local store onto a server. stdout stays pure JSON so it can be piped;
//          the human-readable summary goes to stderr.
// import → read an export file and replay EVERY record through the same quality gate a live
//          save uses (dedup, supersession, conflict guard, near-duplicate) — never a blind
//          append — and print a per-outcome report. Original timestamps/provenance are kept.
//
// Both respect JAMGATE_STORE (via the default FileStore) and exit nonzero only on a real
// failure (bad flags, unreadable/ malformed file, unwritable output). Flagged conflicts and
// possible-duplicates are reported, not treated as errors — the import itself succeeded.

import { promises as fs } from "node:fs";
import { FileStore } from "../store/fileStore.js";
import { CURRENT_SCHEMA_VERSION } from "../store/schema.js";
import { resolveDupThreshold } from "../embeddings/embedder.js";
import type { Memory, SaveResult } from "../store/types.js";
import { VERSION } from "../version.js";
import { ImportValidationError, parseImportFile } from "./parse.js";
import {
  isVendor,
  loadVendorSources,
  parseVendorExport,
  VendorImportError,
  VENDORS,
  type Vendor,
  type VendorParseResult,
} from "./vendor.js";

/** The export envelope: the on-disk `{ schemaVersion, memories }` shape plus provenance about
 *  the export itself. `jamgate import` reads it back (and also accepts a bare array). */
export interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  generator: string;
  memories: Memory[];
}

/** Build the default store for a backup operation. No embedder is loaded — export/import are
 *  lightweight local file operations, and near-duplicate detection on import reuses whatever
 *  embeddings the export file already carries (D-033). JAMGATE_STORE / JAMGATE_DUP_THRESHOLD
 *  are still honored. */
function backupStore(env: NodeJS.ProcessEnv = process.env): FileStore {
  return new FileStore(env.JAMGATE_STORE, { dupThreshold: resolveDupThreshold(env) });
}

interface ExportArgs {
  output?: string;
  activeOnly: boolean;
  error?: string;
}

/** Parse `export` flags: `--output <file>` / `-o <file>`, `--active-only`. */
export function parseExportArgs(argv: readonly string[]): ExportArgs {
  let output: string | undefined;
  let activeOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output" || arg === "-o") {
      output = argv[++i];
      if (!output) return { activeOnly, error: `${arg} requires a file path argument` };
    } else if (arg === "--active-only") {
      activeOnly = true;
    } else {
      return { activeOnly, error: `unknown argument "${arg}"` };
    }
  }
  return { output, activeOnly };
}

/** Entry point for `jamgate export`. Returns a process exit code. */
export async function exportCommand(
  argv: readonly string[],
  deps: {
    env?: NodeJS.ProcessEnv;
    out?: (s: string) => void;
    err?: (s: string) => void;
    store?: FileStore;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s: string) => process.stdout.write(s));
  const err = deps.err ?? ((s: string) => process.stderr.write(s));

  const parsed = parseExportArgs(argv);
  if (parsed.error) {
    err(`jamgate export: ${parsed.error}\n`);
    return 1;
  }

  const store = deps.store ?? backupStore(env);
  const all = await store.exportAll();
  const memories = parsed.activeOnly ? all.filter((m) => m.status === "active") : all;

  const envelope: ExportEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: `jamgate/${VERSION}`,
    memories,
  };
  const json = JSON.stringify(envelope, null, 2);

  const activeCount = memories.filter((m) => m.status === "active").length;
  const supersededCount = memories.length - activeCount;
  const scope = parsed.activeOnly ? "active only" : `${activeCount} active, ${supersededCount} superseded`;
  const storePath = store.storePath;

  try {
    if (parsed.output) {
      await fs.writeFile(parsed.output, json + "\n", "utf8");
      err(`jamgate export: ${memories.length} memories (${scope}) → ${parsed.output}\n`);
      err(`  store: ${storePath}\n`);
    } else {
      out(json + "\n");
      err(`jamgate export: ${memories.length} memories (${scope}) from ${storePath}\n`);
    }
  } catch (e) {
    err(`jamgate export: could not write ${parsed.output} — ${(e as Error).message}\n`);
    return 1;
  }
  return 0;
}

interface ImportArgs {
  file?: string;
  dryRun: boolean;
  from?: Vendor;
  error?: string;
}

/** Parse `import` args: a positional `<file>`, `--dry-run`, and `--from <vendor>` for reading
 *  another product's memory export (D-035). Without `--from` the file must be our own format. */
export function parseImportArgs(argv: readonly string[]): ImportArgs {
  let file: string | undefined;
  let dryRun = false;
  let from: Vendor | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--from") {
      const v = argv[++i];
      if (!v) return { dryRun, error: `--from requires a vendor (${VENDORS.join(" | ")})` };
      if (!isVendor(v)) {
        return { dryRun, error: `unknown --from vendor "${v}" (expected ${VENDORS.join(" | ")})` };
      }
      from = v;
    } else if (arg.startsWith("-")) {
      return { dryRun, from, error: `unknown argument "${arg}"` };
    } else if (file === undefined) {
      file = arg;
    } else {
      return { dryRun, from, error: `unexpected extra argument "${arg}"` };
    }
  }
  if (!file) return { dryRun, from, error: "import requires a file path: jamgate import <file>" };
  return { file, dryRun, from };
}

/** Entry point for `jamgate import`. Returns a process exit code (nonzero only on failure). */
export async function importCommand(
  argv: readonly string[],
  deps: {
    env?: NodeJS.ProcessEnv;
    out?: (s: string) => void;
    err?: (s: string) => void;
    store?: FileStore;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s: string) => process.stdout.write(s));
  const err = deps.err ?? ((s: string) => process.stderr.write(s));

  const parsed = parseImportArgs(argv);
  if (parsed.error) {
    err(`jamgate import: ${parsed.error}\n`);
    return 1;
  }

  const file = parsed.file as string;
  let records: Memory[];
  let vendorNotes: string[] = [];

  if (parsed.from) {
    // Another product's memory export: parse it into our schema, then hand it to exactly the
    // same gate below. Vendor records get no special treatment once they're normalized.
    try {
      const { sources, explicitFile } = await loadVendorSources(file);
      const result = parseVendorExport(parsed.from, sources, { explicitFile });
      records = result.memories;
      vendorNotes = vendorSummary(parsed.from, result);
    } catch (e) {
      if (e instanceof VendorImportError) {
        err(`jamgate import --from ${parsed.from}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  } else {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e) {
      err(`jamgate import: could not read ${file} — ${(e as Error).message}\n`);
      return 1;
    }
    try {
      records = parseImportFile(raw);
    } catch (e) {
      if (e instanceof ImportValidationError) {
        err(`jamgate import: ${file} is not a valid export — ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  const store = deps.store ?? backupStore(env);
  const report = await store.importBatch(records, { dryRun: parsed.dryRun });
  out(formatImportReport(report, { file, total: records.length, notes: vendorNotes }));
  return 0;
}

/** Lines describing what a vendor export actually gave us — which files were read, and which
 *  conversation logs were deliberately left alone. */
function vendorSummary(vendor: Vendor, result: VendorParseResult): string[] {
  const lines = [`  source: ${vendor} export — read ${result.readFiles.join(", ")}`];
  if (result.skippedConversations.length > 0) {
    lines.push(
      `  not read: ${result.skippedConversations.join(", ")} (conversation logs are never mined)`,
    );
  }
  return lines;
}

/** Render the import outcome as a human-readable report: counts + one line per flagged record. */
export function formatImportReport(
  report: { outcomes: SaveResult[]; skippedSuperseded: number; dryRun: boolean },
  ctx: { file: string; total: number; notes?: readonly string[] },
): string {
  const count = (action: SaveResult["action"]) =>
    report.outcomes.filter((o) => o.action === action).length;
  const created = count("created");
  const superseded = count("superseded");
  const duplicates = count("duplicate");
  const conflicts = count("conflict");
  const possible = count("possible_duplicate");

  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? `jamgate import — dry run of ${ctx.file} (no changes written)\n`
      : `jamgate import — ${ctx.file}\n`,
  );
  for (const note of ctx.notes ?? []) lines.push(note);
  const headerLines = lines.length;

  // Per-record detail for the outcomes an operator must act on.
  for (const o of report.outcomes) {
    if (o.action === "conflict") {
      const trusted = (o.conflictsWith ?? []).map((m) => `"${m.text}" (${m.source})`).join(", ");
      lines.push(
        `  ⚠ conflict   "${o.memory.text}" — subject "${o.memory.subject}" already held by a ` +
          `more-trusted memory: ${trusted}. Not imported.`,
      );
    } else if (o.action === "possible_duplicate") {
      const near = (o.possibleDuplicates ?? [])
        .map((d) => `"${d.memory.text}" (~${d.similarity.toFixed(2)})`)
        .join(", ");
      lines.push(
        `  ≈ near-dup   "${o.memory.text}" looks like an existing memory: ${near}. Not imported.`,
      );
    } else if (o.action === "superseded") {
      const old = (o.retired ?? []).map((m) => `"${m.text}"`).join(", ");
      lines.push(`  ↻ superseded "${o.memory.text}" retired ${old}`);
    }
  }
  if (lines.length > headerLines || headerLines > 1) lines.push("");

  const imported = created + superseded;
  lines.push(
    `  ${report.dryRun ? "would import" : "imported"}: ${imported} ` +
      `(${created} new, ${superseded} via supersession)`,
  );
  lines.push(`  duplicates skipped:  ${duplicates}`);
  lines.push(`  conflicts flagged:   ${conflicts}`);
  lines.push(`  near-duplicates:     ${possible}`);
  if (report.skippedSuperseded > 0) {
    lines.push(`  superseded history skipped: ${report.skippedSuperseded}`);
  }
  lines.push(`  records in file:     ${ctx.total}`);
  return lines.join("\n") + "\n";
}
