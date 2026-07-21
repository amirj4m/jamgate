import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import { importCommand, parseImportArgs } from "../src/backup/cli.js";
import {
  extractFromJson,
  extractFromText,
  inferType,
  loadVendorSources,
  parseVendorExport,
  VendorImportError,
} from "../src/backup/vendor.js";
import { readZipEntries, ZipError } from "../src/backup/zip.js";
import { tempStore } from "./helpers.js";

function sink() {
  let buf = "";
  return { write: (s: string) => (buf += s), get: () => buf };
}

/** A realistic minimal claude.ai memory list: the "[date saved] - memory content" shape
 *  Anthropic's own memory import documents, wrapped in the markdown a user would paste. */
const CLAUDE_MEMORY_MD = `# Claude memory export

## Memories

- 2026-03-14 - Prefers TypeScript over JavaScript for new projects
- 2026-03-02 - Lives in Berlin
- Uses a strict no-dependencies policy in personal projects
`;

/** A realistic minimal ChatGPT saved-memories list, as copied out of Settings →
 *  Personalization → Memory → Manage (dates render in parentheses). */
const CHATGPT_MEMORY_TXT = `Saved memories:

Prefers concise answers without preamble (saved 2026-01-09)
Is a backend engineer working mostly in Go (saved 2025-11-30)
hi
`;

/** Build a valid zip in-process so the reader is tested against real bytes. STORE and DEFLATE
 *  are the only two methods a vendor export uses, and both are covered here. */
function makeZip(files: Array<{ name: string; content: string; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const raw = Buffer.from(f.content, "utf8");
    const data = f.deflate ? deflateRawSync(raw) : raw;
    const method = f.deflate ? 8 : 0;
    const name = Buffer.from(f.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc32 — our reader does not verify it
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, eocd]);
}

async function tempDir(prefix = "jamgate-vendor-"): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

describe("vendor memory text parsing", () => {
  it("parses dated bullet lines and keeps the original date", () => {
    const entries = extractFromText(CLAUDE_MEMORY_MD);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].text, "Prefers TypeScript over JavaScript for new projects");
    assert.equal(entries[0].createdAt?.slice(0, 10), "2026-03-14");
    assert.equal(entries[2].text, "Uses a strict no-dependencies policy in personal projects");
    assert.equal(entries[2].createdAt, undefined, "an undated line simply has no date");
  });

  it("ignores headings, rules, section labels, code fences and too-short lines", () => {
    const entries = extractFromText(
      "# Heading\n\nMemories:\n---\n```\n2026-01-01 - inside a fence\n```\nok\n- Works as a teacher\n",
    );
    assert.deepEqual(
      entries.map((e) => e.text),
      ["Works as a teacher"],
    );
  });

  it("understands a trailing (saved <date>) suffix", () => {
    const entries = extractFromText(CHATGPT_MEMORY_TXT);
    assert.equal(entries.length, 2, '"hi" is below the gate\'s minimum length');
    assert.equal(entries[0].text, "Prefers concise answers without preamble");
    assert.equal(entries[0].createdAt?.slice(0, 10), "2026-01-09");
  });

  it("strips an unparseable date prefix rather than leaving it in the memory text", () => {
    const [e] = extractFromText("14/03/2026 - Drinks only decaf after 3pm");
    assert.equal(e.text, "Drinks only decaf after 3pm");
  });

  it("treats any other prose line as a candidate memory (hence --dry-run)", () => {
    // We cannot tell a stray footer from a real memory, so a hand-pasted file's leftovers do
    // become candidates. They are candidates only: the gate still judges them, and --dry-run
    // shows the user exactly what would land before anything is written.
    const entries = extractFromText("- Prefers tea\nExported from Claude on 2026-07-01.\n");
    assert.equal(entries.length, 2);
  });

  it("infers type conservatively: preference, identity, or nothing at all", () => {
    assert.equal(inferType("Prefers dark mode"), "preference");
    assert.equal(inferType("Lives in Berlin"), "identity");
    assert.equal(inferType("The deployment runs on a droplet"), undefined);
  });
});

describe("vendor JSON parsing (best-effort)", () => {
  it("extracts records from a structured memory list", () => {
    const entries = extractFromJson({
      memories: [
        { content: "Prefers metric units", created_at: "2026-02-01T10:00:00Z" },
        { content: "Works at a co-op bakery", create_time: 1767225600 },
      ],
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].createdAt, "2026-02-01T10:00:00.000Z");
    assert.equal(entries[1].createdAt?.slice(0, 4), "2026", "epoch seconds become a real date");
  });

  it("extracts a bare string list under a memory-ish key, and ignores unrelated arrays", () => {
    const entries = extractFromJson({
      saved_memories: ["Allergic to walnuts", "Prefers window seats"],
      tags: ["blue", "green"],
    });
    assert.deepEqual(
      entries.map((e) => e.text),
      ["Allergic to walnuts", "Prefers window seats"],
    );
  });

  it("rejects a malformed .json memory file loudly", () => {
    assert.throws(
      () => parseVendorExport("chatgpt", [{ name: "memory.json", content: "{not json" }]),
      VendorImportError,
    );
  });
});

describe("vendor source selection", () => {
  it("never mines conversation logs and says so when nothing else is there", () => {
    const sources = [
      { name: "conversations.json", content: '[{"title":"chat"}]' },
      { name: "chat.html", content: "<html></html>" },
      { name: "user.json", content: '{"email":"a@b.c"}' },
    ];
    try {
      parseVendorExport("chatgpt", sources);
      assert.fail("expected a VendorImportError");
    } catch (e) {
      assert.ok(e instanceof VendorImportError);
      assert.match(e.message, /no memory file found/);
      assert.match(e.message, /never mines chat history/);
      assert.match(e.message, /Personalization/, "tells the user where memories actually live");
    }
  });

  it("picks memory-shaped files out of an export and reports the skipped logs", () => {
    const result = parseVendorExport("claude", [
      { name: "data/conversations.json", content: "[]" },
      { name: "data/memory.md", content: CLAUDE_MEMORY_MD },
      { name: "data/notes.md", content: "- Not a memory file" },
    ]);
    assert.equal(result.memories.length, 3);
    assert.deepEqual(result.readFiles, ["data/memory.md"]);
    assert.deepEqual(result.skippedConversations, ["data/conversations.json"]);
  });

  it("trusts an explicitly named file even without a memory-ish name", () => {
    const result = parseVendorExport(
      "claude",
      [{ name: "/tmp/pasted.txt", content: "- Prefers tea over coffee" }],
      { explicitFile: true },
    );
    assert.equal(result.memories.length, 1);
  });

  it("maps entries onto our schema: user-confirmed, vendor provenance, derived subject", () => {
    const { memories } = parseVendorExport("claude", [
      { name: "memory.md", content: CLAUDE_MEMORY_MD },
    ]);
    const [prefs, berlin] = memories;
    assert.equal(prefs.source, "user-confirmed", "the user curated these in the source product");
    assert.equal(prefs.status, "active");
    assert.deepEqual(prefs.client, { name: "import:claude.ai" });
    assert.equal(prefs.type, "preference");
    assert.equal(prefs.createdAt.slice(0, 10), "2026-03-14", "the original date is preserved");
    assert.equal(berlin.subject, "location", "the gate's subject rules run on import too");
    assert.match(prefs.id, /^[0-9a-f-]{36}$/);
  });
});

describe("zip reading", () => {
  it("reads stored and deflated entries", () => {
    const zip = makeZip([
      { name: "export/memory.md", content: CLAUDE_MEMORY_MD },
      { name: "export/conversations.json", content: "[]", deflate: true },
    ]);
    const entries = readZipEntries(zip);
    assert.deepEqual(entries.map((e) => e.name), ["export/memory.md", "export/conversations.json"]);
    assert.equal(entries[0].read().toString("utf8"), CLAUDE_MEMORY_MD);
    assert.equal(entries[1].read().toString("utf8"), "[]");
  });

  it("refuses a file that is not a zip", () => {
    assert.throws(() => readZipEntries(Buffer.from("definitely not a zip archive")), ZipError);
  });
});

describe("loading a vendor export from disk", () => {
  it("reads a .zip the vendor emailed you", async () => {
    const dir = await tempDir();
    try {
      const zipPath = join(dir, "chatgpt-export.zip");
      await fs.writeFile(
        zipPath,
        makeZip([
          { name: "conversations.json", content: "[]", deflate: true },
          { name: "memory.txt", content: CHATGPT_MEMORY_TXT },
        ]),
      );
      const { sources, explicitFile } = await loadVendorSources(zipPath);
      assert.equal(explicitFile, false, "an archive is not an explicitly named memory file");
      const result = parseVendorExport("chatgpt", sources, { explicitFile });
      assert.equal(result.memories.length, 2);
      assert.deepEqual(result.skippedConversations, ["conversations.json"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reads an extracted export folder", async () => {
    const dir = await tempDir();
    try {
      await fs.mkdir(join(dir, "export"));
      await fs.writeFile(join(dir, "export", "conversations.json"), "[]");
      await fs.writeFile(join(dir, "export", "memory.md"), CLAUDE_MEMORY_MD);
      const { sources, explicitFile } = await loadVendorSources(dir);
      const result = parseVendorExport("claude", sources, { explicitFile });
      assert.equal(result.memories.length, 3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("jamgate import --from <vendor>", () => {
  it("parses the flag and rejects an unknown vendor", () => {
    assert.equal(parseImportArgs(["--from", "claude", "m.md"]).from, "claude");
    assert.match(parseImportArgs(["--from", "gemini", "m.md"]).error ?? "", /unknown --from vendor/);
    assert.match(parseImportArgs(["--from"]).error ?? "", /--from requires a vendor/);
    assert.equal(parseImportArgs(["backup.json"]).from, undefined, "native import is untouched");
  });

  it("imports a claude memory list through the gate and reports what it read", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await tempDir();
    try {
      const file = join(dir, "claude-memory.md");
      await fs.writeFile(file, CLAUDE_MEMORY_MD);
      const out = sink();
      const err = sink();
      const code = await importCommand(["--from", "claude", file], {
        store,
        out: out.write,
        err: err.write,
      });
      assert.equal(code, 0, err.get());
      assert.match(out.get(), /source: claude export/);
      assert.match(out.get(), /imported: 3 \(3 new/);
      const stored = await store.exportAll();
      assert.equal(stored.length, 3);
      assert.ok(stored.every((m) => m.source === "user-confirmed"));
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("--dry-run writes nothing to the store", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await tempDir();
    try {
      const file = join(dir, "memory.txt");
      await fs.writeFile(file, CHATGPT_MEMORY_TXT);
      const out = sink();
      const code = await importCommand(["--from", "chatgpt", file, "--dry-run"], {
        store,
        out: out.write,
        err: sink().write,
      });
      assert.equal(code, 0);
      assert.match(out.get(), /dry run/);
      assert.match(out.get(), /would import: 2/);
      assert.equal((await store.exportAll()).length, 0, "nothing was written");
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("applies the gate: an already-known fact is a duplicate, a newer one supersedes", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await tempDir();
    try {
      await store.save({
        text: "Lives in Berlin",
        subject: "location",
        source: "user-confirmed",
      });
      const file = join(dir, "memory.md");
      await fs.writeFile(
        file,
        "- 2026-03-02 - Lives in Berlin\n- 2026-06-01 - Lives in Amsterdam now\n",
      );
      const out = sink();
      const code = await importCommand(["--from", "claude", file], {
        store,
        out: out.write,
        err: sink().write,
      });
      assert.equal(code, 0);
      assert.match(out.get(), /duplicates skipped:  1/);
      assert.match(out.get(), /superseded/);
      const active = (await store.exportAll()).filter((m) => m.status === "active");
      assert.deepEqual(active.map((m) => m.text), ["Lives in Amsterdam now"]);
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails with an actionable message when the export has no memory file", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await tempDir();
    try {
      const zipPath = join(dir, "claude-export.zip");
      await fs.writeFile(zipPath, makeZip([{ name: "conversations.json", content: "[]" }]));
      const err = sink();
      const code = await importCommand(["--from", "claude", zipPath], {
        store,
        out: sink().write,
        err: err.write,
      });
      assert.equal(code, 1);
      assert.match(err.get(), /does not contain your memory entries/);
      assert.match(err.get(), /View and edit your memory/);
      assert.equal((await store.exportAll()).length, 0);
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails cleanly on a missing path", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const err = sink();
      const code = await importCommand(["--from", "chatgpt", "/nope/missing.md"], {
        store,
        out: sink().write,
        err: err.write,
      });
      assert.equal(code, 1);
      assert.match(err.get(), /could not read/);
    } finally {
      await cleanup();
    }
  });
});
