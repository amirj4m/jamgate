# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/amirj4m/jamgate/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/amirj4m/jamgate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amirj4m/jamgate/releases/tag/v0.1.0
