# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-07-18

Deploy button: a third rung on the install ladder (local setup → **deploy button** → own
server) so a non-technical user can click a button, log into a hosting platform, and get their
**own** Jamgate instance with a URL and token — no terminal. We host nothing: the instance and
its data live in the user's own platform account (see DECISIONS D-031).

### Added

- **`GET /healthz`** — an unauthenticated liveness endpoint on the HTTP transport that returns
  `200 {"status":"ok","version":...}` before the auth gate. It exposes only liveness and version,
  never any memory, session, or config data, so deploy platforms can health-check the container.
- **Platform `$PORT` support** — `--http` now honors the `$PORT` env that PaaS hosts (Railway,
  Render, …) inject, falling back to `JAMGATE_PORT`, then `8420`. An explicit `--port` /
  `JAMGATE_PORT` still wins.
- **`Dockerfile` + `.dockerignore`** — a multi-stage `node:22-alpine` image (build stage compiles
  TypeScript; runtime stage carries prod-only deps + `dist/`), running as the non-root `node`
  user. Runs Remote mode: binds `0.0.0.0`, keeps the store on a `/data` volume
  (`JAMGATE_STORE=/data/memory.json`), honors `$PORT`, and ships a Node-based `HEALTHCHECK`
  against `/healthz`. A base install (fuzzy recall) — the optional embeddings peer is omitted.
- **Render blueprint** — [`render.yaml`](./render.yaml): a Docker web service with a generated
  `JAMGATE_TOKEN`, a 1 GB persistent disk at `/data`, and `/healthz` health checks. The
  "Deploy to Render" button reads it from the repo, so it works with only a platform login.
- **Railway config** — [`railway.json`](./railway.json) pins the Dockerfile build, `/healthz`
  check, and restart policy. The one-click "Deploy on Railway" button needs a one-time template
  publish (volumes/secrets are template-level on Railway); the exact remaining steps are
  documented in the README.
- **README "Deploy your own (no terminal needed)"** — the buttons, honest cost (~$5–7/mo paid to
  the platform, not us), where the data lives, how to read the URL + token after deploy, and how
  to connect desktops (`npx jamgate setup --remote <url> --token <t>`) and phones (custom
  connector).

### Changed

- The MCP `serverInfo.version` and the new `/healthz` payload now share one `VERSION` constant
  (`src/version.ts`) instead of a hardcoded string, so they can't drift.

### Tests

- +7 tests: `/healthz` returns status + version without auth, leaks no memory, and rejects
  non-GET methods; `$PORT` is honored with the correct precedence vs `--port` / `JAMGATE_PORT`.
  131 → 138 total.

## [0.3.0] - 2026-07-18

One-click install: go from zero to wired across every MCP client on your machine with a
single command, plus zero-CLI on-ramps for Cursor and Claude Desktop. No new runtime
dependencies — the helper is pure Node stdlib.

### Added

- **`jamgate setup`** — detects installed MCP clients (Claude Code, Claude Desktop, Cursor,
  Windsurf) and wires Jamgate into each. Safe by construction: idempotent (a second run
  changes nothing), never touches any server entry but its own, and backs up each config
  file to `<file>.jamgate-backup` before writing. `--dry-run` previews every change without
  writing; `--remote <url> --token <t>` writes HTTP-transport entries for clients that speak
  Streamable HTTP (others are skipped with a reason). On Claude Code it uses `claude mcp add`
  when the CLI is present, else merges `~/.claude.json` directly.
- **`jamgate status`** — reports which clients are wired (and over which transport) and where
  the memory store lives.
- **Cursor deeplink** — an "Add to Cursor" badge in the README installs Jamgate in one click
  via `cursor://anysphere.cursor-deeplink/mcp/install` (base64 payload verified to round-trip).
- **Claude Desktop `.mcpb` bundle** — a reproducible builder (`scripts/build-mcpb.mjs`,
  MCPB manifest v0.3, packed headlessly with `@anthropic-ai/mcpb`) produces `jamgate.mcpb`,
  shipped as a GitHub release asset for one-click install. The bundle omits the optional
  embeddings peer, so it behaves like a base install (fuzzy recall); verified to boot on
  stdio and answer `initialize` + `tools/list` from its bundled dependencies.

### Changed

- README Quick start is now **Option A — `npx jamgate setup` (recommended)** / **Option B —
  per-client manual** (the manual config blocks are kept for transparency).

### Tests

- +24 tests over the setup module (entry shapes, per-platform config paths, Cursor deeplink
  round-trip, pure JSON merge including no-clobber/idempotency/malformed input, and the IO
  runner against a temp home — configure, re-run, backup, dry-run, not-found, remote skip,
  the claude-CLI path and its fallback, and status). 107 → 131 total.

## [0.2.0] - 2026-07-18

Adds an **optional** self-hosted remote mode so one Jamgate instance can serve all of a
single person's MCP clients — the Claude phone app, claude.ai, Claude Code, any Streamable
HTTP client — from one shared memory. stdio stays the default; the local-first story is
unchanged.

### Added

- **Remote mode (Streamable HTTP transport)** — `jamgate --http [--port 8420]` (or
  `JAMGATE_HTTP=1` / `JAMGATE_PORT`) serves MCP over the SDK's
  `StreamableHTTPServerTransport` at `/mcp`, with per-session management so multiple clients
  connect concurrently. `createServer(store)` is now shared between the stdio and HTTP paths,
  so handshake-based client provenance works identically over HTTP. Binds to `127.0.0.1` by
  default (`JAMGATE_HOST` to override).
- **Bearer-token auth** — remote mode requires `JAMGATE_TOKEN` and refuses to start without
  it. Every request is gated; a missing or wrong token is a `401`. The comparison is
  constant-time (`crypto.timingSafeEqual`, length-independent) so the token can't be
  recovered from response timing.
- **Concurrent HTTP sessions share one store safely** — multiple simultaneous sessions write
  through the one `FileStore`, serialized by the existing lock + re-read-before-write; covered
  by a two-session concurrent-write test.
- **Docs** — a new README "Remote mode (self-hosted)" section (when to use it, the security
  model, a systemd unit, Caddy and nginx snippets, and how to add the server as a custom
  connector in the Claude app and via `claude mcp add --transport http` in Claude Code), plus
  the honest limits (whoever holds the token holds the memory; one instance = one human).

### Notes

- Still 100% self-hosted: no Jamgate cloud, no telemetry. TLS is terminated by a reverse
  proxy (caddy/nginx) by design — Jamgate does not ship in-process TLS.
- Test suite grew from 89 to **107** tests on Node 20.x and 22.x; the base install still has
  a single runtime dependency (`@modelcontextprotocol/sdk`, which provides the HTTP
  transport).
- Design rationale recorded as **D-029** in [`DECISIONS.md`](./DECISIONS.md).

## [0.1.0] - 2026-07-18

First public release: a local-first, cross-agent memory quality gate delivered as an
MCP server. Installable with one command (`npx jamgate`), it exposes `save_memory`,
`recall_memory`, and `forget_memory` over stdio to any MCP-capable agent, and keeps a
single shared memory clean at write time instead of letting it bloat with junk.

### Added

#### Gate core (Phase 1)

- **MCP server** exposing `save_memory` / `recall_memory` / `forget_memory` over stdio.
- **Rule pre-filter** that drops obviously non-durable input before it reaches the store.
- **Exact-duplicate dedup** so identical facts are not stored twice.
- **Time-aware supersession** — every memory is a timestamped event; a newer fact that
  shares a `subject` retires the older one by recency instead of piling up as a
  contradiction.
- **Source-trust conflict guard** — a lower-trust source (an agent's guess) cannot
  silently overwrite a higher-trust fact (something you said explicitly); the gate flags
  the conflict and asks for confirmation.
- **Flat-file store** at `~/.jamgate/memory.json` (override with `JAMGATE_STORE`).

#### Robustness (Phase 2)

- **Atomic, durable writes** — write to a temp file, `fsync`, then rename over the
  target, so an interrupted write never leaves a torn file.
- **Type-based expiry (TTL)** — each memory gets a freshness window from its type
  (identity and preferences never expire; projects ~90 days; volatile state ~2 days),
  overridable via `JAMGATE_TTL_<TYPE>_DAYS`. Expired records stop surfacing in recall but
  are retained for audit until compaction.
- **Concurrency safety** — a lock file with stale-lock detection plus re-read-before-write
  serializes agents that share one store, so no write is lost; a waiter never abandons the
  lock while a live holder still has it, so a heavily loaded machine can't drop a save.
- **Schema versioning** — the store carries a `schemaVersion` (now 2) and older formats
  migrate automatically.

#### Intelligence (Phase 3)

- **Trusted client provenance** — each memory records which MCP client wrote it, captured
  from the `initialize` handshake so a calling agent cannot spoof it.
- **Fuzzy recall** — deterministic, dependency-free relevance (stemming-lite,
  typo-tolerance, trigram similarity) that beats plain word-overlap on plurals and typos.
- **Optional local embeddings** — an opt-in, fully-local semantic layer
  (all-MiniLM-L6-v2 via the `@huggingface/transformers` peer dependency) that adds
  synonym-aware recall and semantic near-duplicate detection, degrading gracefully to
  fuzzy recall when the model is not installed. Tunable via `JAMGATE_EMBEDDINGS` and
  `JAMGATE_DUP_THRESHOLD`.
- **Auto-subject derivation** — when the agent omits a `subject`, the gate conservatively
  derives one from the text so supersession still works.
- **Local decision log** — every gate decision is appended to `~/.jamgate/gate.log`, a
  strictly local, size-capped JSONL buffer (disable with `JAMGATE_GATE_LOG=off`) that
  collects real usage data for a future quality classifier.

### Notes

- 100% local: no network calls, no cloud AI. Even the optional embedding model runs
  entirely on your machine.
- One runtime dependency (`@modelcontextprotocol/sdk`); embeddings are an optional peer
  dependency.
- Verified end-to-end over the MCP protocol and covered by an automated test suite
  (89 tests) running on Node 20.x and 22.x in CI.

[Unreleased]: https://github.com/amirj4m/jamgate/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/amirj4m/jamgate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/amirj4m/jamgate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/amirj4m/jamgate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amirj4m/jamgate/releases/tag/v0.1.0
