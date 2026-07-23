import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileStore } from "../src/store/fileStore.js";
import type { Memory } from "../src/store/types.js";
import { CURRENT_SCHEMA_VERSION } from "../src/store/schema.js";
import {
  exportCommand,
  importCommand,
  type ExportEnvelope,
} from "../src/backup/cli.js";
import { ImportValidationError, parseImportFile } from "../src/backup/parse.js";
import { tempStore } from "./helpers.js";

/** Collect writes to an out/err sink so a command's output can be asserted. */
function sink() {
  let buf = "";
  return { write: (s: string) => (buf += s), get: () => buf };
}

describe("import file parsing (pure)", () => {
  it("parses our export envelope", () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      memories: [{ text: "jam uses Linux", source: "user-explicit", status: "active" }],
    });
    const recs = parseImportFile(raw);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].text, "jam uses Linux");
  });

  it("parses a bare JSON array of records", () => {
    const recs = parseImportFile(JSON.stringify([{ text: "jam lives in Berlin" }]));
    assert.equal(recs.length, 1);
    assert.equal(recs[0].text, "jam lives in Berlin");
  });

  it("defaults missing fields on a minimal record but keeps text", () => {
    const [r] = parseImportFile(JSON.stringify([{ text: "  jam uses Linux  " }]));
    assert.equal(r.text, "jam uses Linux", "text is trimmed");
    assert.equal(r.source, "agent-inferred", "source defaults");
    assert.equal(r.status, "active", "status defaults to active");
    assert.match(r.id, /^[0-9a-f-]{36}$/, "a fresh id is minted when absent");
    assert.equal(new Date(r.createdAt).toISOString(), r.createdAt, "createdAt is a real ISO time");
  });

  it("preserves provenance fields when present (no reset)", () => {
    const original: Partial<Memory> = {
      id: "fixed-id-123",
      text: "building a language app",
      type: "project",
      subject: "current-project",
      source: "user-confirmed",
      status: "active",
      createdAt: "2025-01-02T03:04:05.000Z",
      updatedAt: "2025-01-02T03:04:05.000Z",
      client: { name: "cursor", version: "1.2.3" },
      embedding: [0.1, 0.2, 0.3],
    };
    const [r] = parseImportFile(JSON.stringify([original]));
    assert.equal(r.id, "fixed-id-123");
    assert.equal(r.type, "project");
    assert.equal(r.subject, "current-project");
    assert.equal(r.source, "user-confirmed");
    assert.equal(r.createdAt, "2025-01-02T03:04:05.000Z");
    assert.deepEqual(r.client, { name: "cursor", version: "1.2.3" });
    assert.deepEqual(r.embedding, [0.1, 0.2, 0.3]);
  });

  it("rejects invalid JSON", () => {
    assert.throws(() => parseImportFile("not json {{{"), ImportValidationError);
  });

  it("rejects a wrong top-level shape", () => {
    assert.throws(() => parseImportFile(JSON.stringify({ foo: 1 })), ImportValidationError);
  });

  it("rejects a record missing text", () => {
    assert.throws(() => parseImportFile(JSON.stringify([{ nope: "x" }])), ImportValidationError);
    assert.throws(() => parseImportFile(JSON.stringify([{ text: "   " }])), ImportValidationError);
  });
});

describe("jamgate export", () => {
  it("emits a schemaVersion envelope with all records to stdout", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", subject: "operating-system", source: "user-explicit" });
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-confirmed" });
      // Supersede location → one superseded record on file.
      await store.save({ text: "jam lives in Amsterdam", subject: "location", source: "user-confirmed" });

      const out = sink();
      const err = sink();
      const code = await exportCommand([], { store, out: out.write, err: err.write });
      assert.equal(code, 0);

      const env = JSON.parse(out.get()) as ExportEnvelope;
      assert.equal(env.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.match(env.generator, /^jamgate\//);
      assert.equal(new Date(env.exportedAt).toISOString(), env.exportedAt);
      assert.equal(env.memories.length, 3, "active + superseded are both exported");
      assert.equal(env.memories.filter((m) => m.status === "superseded").length, 1);
    } finally {
      await cleanup();
    }
  });

  it("--active-only omits superseded records", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-confirmed" });
      await store.save({ text: "jam lives in Amsterdam", subject: "location", source: "user-confirmed" });

      const out = sink();
      const code = await exportCommand(["--active-only"], { store, out: out.write, err: sink().write });
      assert.equal(code, 0);
      const env = JSON.parse(out.get()) as ExportEnvelope;
      assert.equal(env.memories.length, 1);
      assert.equal(env.memories[0].status, "active");
      assert.equal(env.memories[0].text, "jam lives in Amsterdam");
    } finally {
      await cleanup();
    }
  });

  it("writes to a file with --output and keeps stdout clean", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-exp-"));
    const outFile = join(dir, "backup.json");
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      const out = sink();
      const code = await exportCommand(["--output", outFile], { store, out: out.write, err: sink().write });
      assert.equal(code, 0);
      assert.equal(out.get(), "", "stdout stays empty when writing to a file");
      const env = JSON.parse(await fs.readFile(outFile, "utf8")) as ExportEnvelope;
      assert.equal(env.memories.length, 1);
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("jamgate import (through the gate)", () => {
  /** Export the given store to a temp file and return the file path + a cleanup hook. */
  async function exportToFile(store: FileStore, activeOnly = false) {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-imp-"));
    const file = join(dir, "export.json");
    const args = activeOnly ? ["--active-only", "--output", file] : ["--output", file];
    await exportCommand(args, { store, out: sink().write, err: sink().write });
    return { file, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
  }

  it("round-trips: export → import into an empty store equals the original actives", async () => {
    const source = await tempStore();
    const target = await tempStore();
    try {
      await source.store.save({ text: "jam uses Linux", subject: "operating-system", source: "user-explicit" });
      await source.store.save({ text: "jam lives in Berlin", subject: "location", source: "user-confirmed" });
      await source.store.save({ text: "jam lives in Amsterdam", subject: "location", source: "user-confirmed" });

      const { file, cleanup } = await exportToFile(source.store);
      try {
        const code = await importCommand([file], { store: target.store, out: sink().write, err: sink().write });
        assert.equal(code, 0);

        const before = (await source.store.exportAll())
          .filter((m) => m.status === "active")
          .map((m) => m.text)
          .sort();
        const after = (await target.store.exportAll())
          .filter((m) => m.status === "active")
          .map((m) => m.text)
          .sort();
        assert.deepEqual(after, before);
      } finally {
        await cleanup();
      }
    } finally {
      await source.cleanup();
      await target.cleanup();
    }
  });

  it("preserves original createdAt on imported records", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-imp-"));
    const file = join(dir, "in.json");
    try {
      await fs.writeFile(
        file,
        JSON.stringify([
          { text: "jam started jamgate", source: "user-explicit", createdAt: "2024-03-04T05:06:07.000Z" },
        ]),
      );
      await importCommand([file], { store, out: sink().write, err: sink().write });
      const [rec] = await store.exportAll();
      assert.equal(rec.createdAt, "2024-03-04T05:06:07.000Z", "createdAt is not reset on import");
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("skips exact duplicates already in the store", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam uses Linux", source: "user-explicit" });
      const report = await store.importBatch([
        { text: "jam uses Linux", source: "user-explicit", status: "active", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", id: "x" },
      ]);
      assert.equal(report.outcomes[0].action, "duplicate");
      assert.equal((await store.exportAll()).length, 1, "no second copy is written");
    } finally {
      await cleanup();
    }
  });

  it("applies time-aware supersession for an equal-trust newer fact", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam works at old corp", subject: "employer", source: "user-confirmed" });
      const report = await store.importBatch([
        { text: "jam works at new corp", subject: "employer", source: "user-confirmed", status: "active", createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z", id: "y" },
      ]);
      assert.equal(report.outcomes[0].action, "superseded");
      const actives = (await store.exportAll()).filter((m) => m.status === "active").map((m) => m.text);
      assert.deepEqual(actives, ["jam works at new corp"]);
    } finally {
      await cleanup();
    }
  });

  it("flags a lower-trust conflict and does not import it", async () => {
    const { store, cleanup } = await tempStore();
    try {
      await store.save({ text: "jam lives in Berlin", subject: "location", source: "user-explicit" });
      const report = await store.importBatch([
        { text: "jam lives in Tokyo", subject: "location", source: "agent-inferred", status: "active", createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:00:00.000Z", id: "z" },
      ]);
      assert.equal(report.outcomes[0].action, "conflict");
      const actives = (await store.exportAll()).filter((m) => m.status === "active").map((m) => m.text);
      assert.deepEqual(actives, ["jam lives in Berlin"], "the trusted fact stands, the conflict is not stored");
    } finally {
      await cleanup();
    }
  });

  it("skips superseded history records rather than re-activating them", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const report = await store.importBatch([
        { text: "an old retired fact", source: "user-confirmed", status: "superseded", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z", id: "old" },
        { text: "a live fact", source: "user-confirmed", status: "active", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", id: "new" },
      ]);
      assert.equal(report.skippedSuperseded, 1);
      const all = await store.exportAll();
      assert.equal(all.length, 1);
      assert.equal(all[0].text, "a live fact");
    } finally {
      await cleanup();
    }
  });

  it("--dry-run reports outcomes but writes nothing", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-imp-"));
    const file = join(dir, "in.json");
    try {
      await fs.writeFile(file, JSON.stringify([{ text: "a brand new fact", source: "user-explicit" }]));
      const out = sink();
      const code = await importCommand([file, "--dry-run"], { store, out: out.write, err: sink().write });
      assert.equal(code, 0);
      assert.match(out.get(), /dry run/);
      assert.equal((await store.exportAll()).length, 0, "the store is untouched by a dry run");
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("exits nonzero on a malformed file and touches nothing", async () => {
    const { store, cleanup } = await tempStore();
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-imp-"));
    const file = join(dir, "bad.json");
    try {
      await fs.writeFile(file, "definitely not json {{{");
      const err = sink();
      const code = await importCommand([file], { store, out: sink().write, err: err.write });
      assert.equal(code, 1);
      assert.match(err.get(), /not a valid export/);
      assert.equal((await store.exportAll()).length, 0);
    } finally {
      await cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("exits nonzero when the file is missing", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const code = await importCommand(["/no/such/file.json"], { store, out: sink().write, err: sink().write });
      assert.equal(code, 1);
    } finally {
      await cleanup();
    }
  });
});
