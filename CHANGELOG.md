# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.4] - 2026-07-21

### Fixed

- **`save_memory` now accepts the memory under `content` or `memory`, not only `text`**
  (DECISIONS D-039). Live evidence closed yesterday's mystery: the claude.ai/Cowork client sends
  the memory as `content`, so our handler saw no `text` at all — which is what produced the
  empty-text "too short" that 0.7.2 made legible. The text is now resolved from `text`, then
  `content`, then `memory`, taking the first non-empty string; the gate judges it exactly as if
  it had arrived under `text`. `text` stays canonical, still wins when both are present, and the
  aliases are noted in the tool description so agents keep preferring it. When none of the three
  carries a usable string, the 0.7.2 error is unchanged — clear, and naming every key received.

## [0.7.3] - 2026-07-21

### Fixed

- **A remote session now recovers by itself when the server restarts** (DECISIONS D-038).
  Reported from real use: a claude.ai conversation had a working session, the self-hosted service
  restarted for a deploy, and every later `save_memory` in that same conversation failed with
  "session expired" / "Not connected" — the client never re-handshaked, even when asked to
  reconnect. Sessions live in process memory, so a restart invalidates every session id in the
  wild; the MCP Streamable HTTP spec makes **HTTP 404** the signal that tells a client to start a
  new session, and we were answering **400**. A client reads 400 as "that request was malformed",
  so it had nothing to recover from. An unknown or expired `Mcp-Session-Id` now gets a
  spec-compliant 404 on POST, GET and DELETE, and conforming clients (claude.ai) re-initialize
  transparently — the user sees nothing.
- **A missing session id is no longer confused with an expired one.** A request with no
  `Mcp-Session-Id` that isn't an `initialize` is still 400, per the same section of the spec —
  that one really is malformed and must not be told to retry with a new session.
- **The auth gate can't mask the 404.** A valid token with a dead session gets the 404, not a
  401; a *wrong* token with a dead session is still 401, so an expired session never becomes an
  oracle for unauthenticated callers.
- **An `initialize` that still carries a stale session id is accepted** and issued a fresh id,
  rather than being refused mid-recovery.

## [0.7.2] - 2026-07-21

### Fixed

- **`save_memory` no longer answers "too short" for a memory that never arrived** (DECISIONS
  D-037). Reported from real use against a remote instance: the gate "rejected everything with
  'too short' — even a ~1700-character memory". The text argument had not reached the gate;
  `String(args.text ?? "")` turned a missing or misnamed `text` into `""` and the prefilter judged
  the empty string. A missing, empty or non-string `text` now returns a proper MCP error result
  (`isError: true`) that names the required field **and the argument keys that actually arrived**,
  so a client can correct itself. Nothing is saved, and it is not recorded as a gate decision — a
  usage error is not a verdict.
- **A non-string `text` can no longer be stored as `"[object Object]"`.** A client wrapping the
  memory in a content block (`text: { type: "text", text: "…" }`) previously stringified straight
  through the gate and was saved, reported as a success.
- **Rejection reasons now state the measured length** — `too short (2 characters, minimum 4)`
  instead of a bare `too short`, so a caller can compare it against what it sent.
- **The gate log defaults next to the store**, following `JAMGATE_STORE`, instead of
  `~/.jamgate/gate.log`. Under systemd `ProtectHome=true`/`ProtectSystem=strict` every append had
  been failing with ENOENT, leaving the audit trail empty exactly when a production bug needed it.
  An explicit `JAMGATE_GATE_LOG` (including `off`) still wins.


## [0.7.1] - 2026-07-21

### Fixed

- **Recall now scores the whole memory — text *and* `subject` *and* `type` — not just the text**
  (DECISIONS D-036). A real miss prompted this: asking for "my projects" returned *"No matching
  memories"* while the store held a `type: "project"` / `subject: "jamgate-project"` record whose
  text never used the word. Subject keys are split into words (`current-project` →
  `current project`) and weighted like text tokens; a query naming a memory's type adds a small
  `0.15` boost, above the relevance floor but always below a genuine word match. Deterministic,
  dependency-free, and additive — memories without a subject or type score exactly as before, so
  nothing that used to be found stops being found. Regression tests cover it end-to-end through
  the store.

## [0.7.0] - 2026-07-21

**Bring your memory with you.** `jamgate import --from claude|chatgpt` reads the memory list you
exported from another AI product and replays it through the same quality gate a live save goes
through — day-one memory on a new setup instead of a cold start. You download your own export,
yourself; Jamgate only ever reads a local file (see DECISIONS D-035).

### Added

- **`jamgate import --from claude <path>` / `--from chatgpt <path>`** — parse a vendor memory
  export into Jamgate's schema and import it **through the gate** (exact-duplicate dedup,
  time-aware supersession, the trust/contradiction guard, near-duplicate detection). Never a blind
  append. `--dry-run` is supported and prints exactly what would land.
  - Accepts the export **.zip**, an **extracted folder**, or a single **`.md`/`.txt`/`.json`**
    file. Inside an archive or folder, only memory-shaped files are opened.
  - Parses the text shape both vendors actually give you — one memory per line, optional date, as
    `2026-03-14 - Prefers TypeScript` or `Prefers concise answers (saved 2026-01-09)`. Bullets,
    headings, horizontal rules and code fences are handled. Structured memory JSON is read
    best-effort if a future export ships it.
  - Maps entries conservatively: `source: user-confirmed` (you curated them in the source
    product), `type` inferred only when obvious (`preference`/`identity`, else untyped), original
    timestamps preserved, subject derived by the same rules live saves use, and provenance stamped
    as `import:claude.ai` / `import:chatgpt`.
  - Reports which files were read and which were skipped, on top of the existing per-record report.
- **Dependency-free ZIP reader** (`src/backup/zip.ts`) — enough of the format to look inside a
  vendor export (STORE + DEFLATE via `node:zlib`); ZIP64/encrypted archives are refused with a
  clear message instead of parsed halfway. No new runtime dependencies.

### Notes

- **Conversation logs are never mined.** `conversations.json`, `chat.html`,
  `message_feedback.json`, `model_comparisons.json` and friends are recognized by name, skipped,
  and reported as skipped. Reconstructing facts about a person from raw chat history is exactly the
  low-consent inference this project exists to push back on.
- **Format confidence, checked July 2026:** neither vendor's bulk account data export contains
  memory entries — Claude's export holds conversations and account data, ChatGPT's holds
  `conversations.json`, `chat.html`, `user.json`, `message_feedback.json`,
  `model_comparisons.json`. Both products keep memory in their own settings UI with a documented
  copy-out path, and Anthropic's documented memory-transfer shape is
  `[date saved, if available] - memory content`. The text parser is therefore built on a
  **verified** format; the JSON path is explicitly **best-effort** for exports we could not verify,
  and fails loudly rather than guessing.
- `jamgate import <file>` without `--from` is unchanged — it still expects Jamgate's own export.

## [0.6.0] - 2026-07-20

MCP OAuth for remote mode: a self-hosted Jamgate instance can now be added to **claude.ai** and
the **Claude mobile app** as a custom connector. Those clients only speak the standard MCP
authorization flow (OAuth 2.1 + PKCE) — they can't take a static bearer token — so Jamgate now
implements that flow itself, acting as its own authorization server with your `JAMGATE_TOKEN` as
the one credential. No external identity provider, no new runtime dependencies (see DECISIONS
D-034).

### Added

- **MCP OAuth flow in remote mode**, on by default whenever `--http`/`JAMGATE_HTTP` is set
  (disable with `JAMGATE_OAUTH=off`). Implements the subset of the
  [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
  a claude.ai connector requires:
  - `GET /.well-known/oauth-protected-resource` — RFC 9728 protected-resource metadata pointing
    at this origin's authorization server. A `401` from `/mcp` now carries a `WWW-Authenticate`
    header with `resource_metadata=` so clients discover the flow.
  - `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata advertising the endpoints,
    PKCE **S256** required, `authorization_code` + `refresh_token` grants.
  - `POST /register` — RFC 7591 dynamic client registration; persists `client_id`/`redirect_uris`.
  - `GET`/`POST /authorize` — a minimal, self-contained consent page that asks for your instance
    token **once**, verifies it constant-time, and issues a single-use, PKCE-bound authorization
    code (≤60s).
  - `POST /token` — PKCE code exchange → long-lived (90d) access token + rotating refresh token.
- **`/mcp` accepts either credential** — an issued OAuth access token **or** the static
  `JAMGATE_TOKEN`, so existing Claude Code connections keep working unchanged.
- **`JAMGATE_OAUTH`** (default on) and **`JAMGATE_OAUTH_STORE`** (default `~/.jamgate/oauth.json`)
  configuration variables.
- **25 new tests** covering the metadata shapes, dynamic registration, the full
  authorize→token→`/mcp` round-trip with real PKCE, code single-use / reuse rejection, wrong-token
  rejection, refresh-token rotation, the `WWW-Authenticate` pointer, and static-token backward
  compatibility.

### Security

- PKCE (S256) is mandatory; redirect URIs are matched **exactly** (no open redirect — an
  unregistered `redirect_uri` renders an error page rather than redirecting); authorization codes
  are single-use and expire in ≤60s; access and refresh tokens are stored **hashed** (SHA-256) in
  `oauth.json` and revoked by deleting the entry. All OAuth state uses the same atomic-write +
  file-lock discipline as the memory store. No new runtime dependencies — Node `crypto` + the
  existing HTTP layer only.

## [0.5.0] - 2026-07-20

Backup & migration: `jamgate export` and `jamgate import` so you can back up your memory, move
it between machines, or lift a local store onto a server — one command instead of hand-copying
`memory.json` (see DECISIONS D-033).

### Added

- **`jamgate export [--output <file>] [--active-only]`** — dumps the whole store as a
  `schemaVersion` envelope (`{ schemaVersion, exportedAt, generator, memories }`). Both active
  and superseded records are included by default; `--active-only` keeps just the live facts.
  Writes to a file with `--output`/`-o`, otherwise to **stdout as pure JSON** (pipeable) with a
  human-readable summary on **stderr**. Respects `JAMGATE_STORE`.
- **`jamgate import <file> [--dry-run]`** — reads an export file (our envelope **or** a bare JSON
  array) and replays **every record through the same quality gate** a live save uses — exact-dup
  dedup, time-aware supersession, the contradiction/trust guard, and near-duplicate detection —
  rather than blind-appending. Original `createdAt`/provenance are **preserved**, not reset.
  Prints a per-outcome report (imported / duplicates skipped / superseded / conflicts flagged /
  near-duplicates) and one line per record that needs attention. `--dry-run` reports without
  writing. The whole import is one atomic, locked transaction. A malformed file is rejected with
  a nonzero exit and the store is left untouched.

### Fixed

- **Lost-update flake under concurrent writes** — the store's file lock could be stolen while
  brand-new: acquiring it is `open(wx)` (creates an **empty** file) followed by a separate write
  of the holder's timestamp, and in that window a waiting writer parsed the empty body as
  `Number("") === 0`, judged the fresh lock ancient (`now - 0 > staleMs`), and stole it — so two
  writers ran at once and one write was clobbered. This surfaced intermittently as the concurrent
  HTTP-sessions test persisting 23 of 24 saves and could fail the tag-triggered Publish run. The
  staleness check now treats an empty/non-numeric lock body as *mid-creation* and ages it out by
  the file's **mtime** instead, so a fresh lock is never stolen while a genuinely abandoned one
  still recovers after `staleMs`. Covered by deterministic `isStale` unit tests.

## [0.4.1] - 2026-07-19

### Fixed

- **`jamgate setup` / `status` ran silently through npx** — `npx jamgate setup` exited 0 with
  no report at all. npm installs the bin as a symlink (`node_modules/.bin/jamgate` →
  `dist/index.js`), so `process.argv[1]` was the symlink path while `import.meta.url` was the
  resolved target; the entrypoint guard compared them directly, so `main()` never ran and the
  wizard produced no output. The guard now resolves the realpath of `process.argv[1]` before
  comparing. A regression test runs the built binary through a symlink (the npx path) and
  asserts a non-empty report reaches stdout, so this cannot ship again.

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

[Unreleased]: https://github.com/amirj4m/jamgate/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/amirj4m/jamgate/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/amirj4m/jamgate/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/amirj4m/jamgate/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/amirj4m/jamgate/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/amirj4m/jamgate/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/amirj4m/jamgate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/amirj4m/jamgate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/amirj4m/jamgate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amirj4m/jamgate/releases/tag/v0.1.0
