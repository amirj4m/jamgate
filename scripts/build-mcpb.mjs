#!/usr/bin/env node
/**
 * Build the Claude Desktop one-click bundle (jamgate.mcpb).
 *
 * An .mcpb (MCP Bundle, formerly .dxt) is a zip of a self-contained local MCP server plus a
 * manifest.json (spec: github.com/modelcontextprotocol/mcpb, MANIFEST.md v0.3). Claude Desktop
 * installs it in one click. This script stages the compiled server + its PRODUCTION deps (the
 * optional @huggingface/transformers peer is deliberately omitted, so the bundle behaves like a
 * base install: fuzzy recall, no ML runtime to download), writes the manifest, and packs it with
 * the official `@anthropic-ai/mcpb` CLI.
 *
 * Reproducible and headless: `npm run build && node scripts/build-mcpb.mjs`. Output: build/jamgate.mcpb.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const buildDir = join(root, "build");
const stageDir = join(buildDir, "mcpb");
const out = join(buildDir, "jamgate.mcpb");

if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("build/index.js missing — run `npm run build` first.");
  process.exit(1);
}

console.log("• staging bundle at", stageDir);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Compiled server + the metadata a Node package needs at runtime.
cpSync(join(root, "dist"), join(stageDir, "dist"), { recursive: true });
cpSync(join(root, "README.md"), join(stageDir, "README.md"));
cpSync(join(root, "LICENSE"), join(stageDir, "LICENSE"));

// A trimmed package.json (production deps only) so the staged install resolves correctly.
const stagePkg = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  bin: pkg.bin,
  dependencies: pkg.dependencies,
};
writeFileSync(join(stageDir, "package.json"), JSON.stringify(stagePkg, null, 2) + "\n");

console.log("• installing production dependencies (no dev, no optional)");
execFileSync(
  "npm",
  ["install", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: stageDir, stdio: "inherit" },
);

// The MCPB manifest (v0.3). server.type "node" + mcp_config tells Claude Desktop how to launch.
const manifest = {
  manifest_version: "0.3",
  name: pkg.name,
  display_name: "Jamgate",
  version: pkg.version,
  description: pkg.description,
  long_description:
    "A neutral, cross-agent memory quality gate delivered as an MCP server. Any agent " +
    "(Claude Desktop, Claude Code, Cursor, …) reads from and writes to one shared, clean " +
    "memory of the user; a write-time gate keeps it deduplicated, time-aware and " +
    "contradiction-free. Local-first: this bundle runs on fuzzy recall with no external " +
    "services or ML downloads.",
  author: { name: pkg.author || "jam" },
  homepage: pkg.homepage,
  documentation: pkg.homepage,
  repository: pkg.repository,
  license: pkg.license,
  keywords: pkg.keywords,
  server: {
    type: "node",
    entry_point: "dist/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/dist/index.js"],
    },
  },
  tools: [
    { name: "save_memory", description: "Save a durable memory about the user through the quality gate." },
    { name: "recall_memory", description: "Recall stored memories about the user relevant to a query." },
    { name: "forget_memory", description: "Delete a stored memory by its id." },
  ],
  compatibility: {
    runtimes: { node: ">=20" },
  },
};
writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("• packing with @anthropic-ai/mcpb");
execFileSync("npx", ["-y", "@anthropic-ai/mcpb@latest", "pack", stageDir, out], {
  cwd: root,
  stdio: "inherit",
});

console.log("\n✓ built", out);
