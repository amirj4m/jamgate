# DECISIONS.md — Jamgate

Decision log. Each entry: what we decided and why. Don't silently reverse these — if
you change one, add a new entry that supersedes it.

---

### D-001 — Build a quality GATE, not another memory store
The storage layer is commoditized and owned by funded teams (mem0 ~59k★, Graphiti
~27k★, Supermemory ~27k★, Cognee ~18k★). Building "another MCP memory server" means
losing to incumbents with distribution. **Why:** the genuinely unsolved problem is
**write-time quality** (the "98% junk" problem). That seam is our only durable opening.

### D-002 — Be neutral and store-agnostic
The gate sits in front of any store, any agent. **Why:** the AI labs are structurally
unwilling to build cross-vendor neutrality (it breaks their lock-in), so a neutral
layer is exactly the thing no well-funded player will build. Neutrality is the wedge.

### D-003 — Goal is impact, not profit
Open-source, MIT. **Why:** the maintainer's aim is to make a dent in the ecosystem.
This removes the hardest problems (moat, revenue, platform risk) and makes "open +
neutral" a strength instead of a liability.

### D-004 — Hybrid decision pipeline (rules + agent intelligence + thin classifier)
Not pure-AI, not pure-rules. **Why:** pure "LLM, extract memories" is precisely what
creates the 98% junk; pure hard-coded rules can't make a semantic judgment. Cheap
rules kill obvious junk → the calling agent (already understands the convo) is the
main free filter → a thin classifier handles only ambiguous cases → uncertainty goes
to the user.

### D-005 — Never screen-scrape; write only at checkpoints
**Why:** continuous/raw capture re-creates the junk problem and is a privacy hazard.
Separate WHERE you sit from WHEN you write.

### D-006 — Two user types: bundled default store vs bring-your-own-store
Normal users get an invisible default store ("memory that just works", never hears
"mem0"); power users plug in their existing store. **Why:** the gate must be usable by
someone who knows nothing about memory backends, while still serving experts.

### D-007 — Every memory carries a `source` field
`agent-inferred` / `user-confirmed` / `user-explicit`, plus a confidence score.
**Why:** lets the system trust user-confirmed memories more, a cheap quality lever.

### D-008 — Volatile layers get short expiry
The 5-layer model (identity → projects → focus → physical → emotional) assigns
freshness by change-speed; identity never expires, mood expires in hours. **Why:**
prevents the store from bloating with stale, sensitive state.

### D-009 — Stack: TypeScript + Node + official MCP SDK; default store SQLite/file
**Why:** the MCP SDK is strongest in TS, the maintainer already knows TS (weather,
learning-city), and a file/SQLite store is the simplest thing that works. mem0 /
Graphiti are later *adapters*, not the core.

### D-010 — Local-first MVP (stdio), zero hosting; cloud later
**Why:** a local MCP server connected to Claude Code / Cowork / Cursor needs no
servers and costs nothing to prove the idea. Hosted/cloud (Cloudflare / Render / Fly
/ VPS) comes only after the gate works locally.

### D-011 — v1 targets MCP surfaces; web chatbots are phase 2
**Why:** MCP agents give clean, agent-filtered capture. ChatGPT/Gemini web need a
fragile extension or evolving connector support — don't let the hardest surface block
the first release.

### D-012 — Works across Claude Code, Cowork, and Cursor
Confirmed Cowork itself supports MCP (this session has many MCP servers connected).
**Why:** one server, every MCP agent — that's the cross-agent promise, provable today.

### D-013 — Use AGENTS.md as the canonical rules file
With CLAUDE.md / GEMINI.md as symlinks (or pointer files) to it. **Why:** AGENTS.md is
the cross-vendor standard (Linux Foundation / Agentic AI Foundation, Dec 2025) — fitting
for a cross-agent project — and one canonical file beats per-tool duplication.

### D-014 — Bootstrap / dogfood plan
Write these rule files halfway by hand, then continue building the project *using the
memory system itself* — à la Linus writing Git with Git. **Why:** it's both a forcing
function for quality and a strong credibility/dogfooding story for an open-source project.

### D-017 — Project name: Jamgate
Chosen 2026-06-19. "jam" is the maintainer's handle, "gate" states the quality-gate
concept directly, and the compound doubles as a pun in the maintainer's first language.
Beats the other candidates (Jamory, Jamjar, Jamkeep, Jamoire, Jamind) on clarity + recall.
("Hermes" was rejected earlier — existing agent, overloaded name.)

### D-015 — Time-aware memory: recency and supersession
Every memory is a **timestamped event, not a standing rule**. The system must tell
two things apart: (a) a *superseded state* — a newer entry about the same subject
automatically replaces the older one because it is newer (e.g. "uses Windows" (Mar)
→ "moved to Linux" (Jun)); no prompt, not labeled a "contradiction" — versus (b) a
*genuine contradiction* — two claims that purport to hold at the **same** time and
cannot both be true → flag / ask. **Why:** the worst real-world failure is an agent
treating an outdated past statement as the user's *current* commitment ("you said X
15 minutes / 4 days ago — why did you change your mind?"). Recency wins; never
confront the user with their own stale words as if they were current. Extends the
contradiction check (§2.3) and the expiry model (§4); both need timestamps to be
first-class.

### D-016 — Reframe: the product is a shared cross-agent memory OF THE USER; the gate is the mechanism
Refines and supersedes the framing in D-001. The purpose is **not** primarily
"decide what is worth keeping" (salience). It is: **one neutral memory of the user —
identity, mood, and above all current work / projects — that every MCP-capable agent
reads from and writes to**, so agents stop being isolated islands and the user never
has to re-brief each one. The write-time quality gate (salience, dedup, contradiction,
expiry) is the *mechanism* that keeps this shared memory clean and trustworthy — not
the headline. **Durable wedge = neutrality (sits in front of ANY store, including
mem0) + write-time selectivity.** Note: Zep/Graphiti already does temporal
contradiction handling via validity windows, but only inside its own heavy graph
store — not as a neutral gate in front of any store — and mem0 has no write-time
scoring, so the neutral-gate-with-selectivity combination is still open. **Stat
correction:** the "98% junk" figure is actually **97.8%** from one mem0 production
audit (github.com/mem0ai/mem0 issue #4573) — cite as one audit, not a universal claim.

### D-018 — Multi-device sync (future): user-held keys + pluggable transport
When cross-device sync is added, keep BOTH privacy and sync by (1) separating the gate
from the sync layer and (2) end-to-end encrypting the notebook with a key only the user
holds — so whatever moves it sees only ciphertext. Transport is pluggable, simplest
first: (a) a sync folder the user already has (Dropbox / iCloud / Syncthing) — zero
server, zero cost, fits local-first; (b) an encrypted relay for convenience later;
(c) the user's own cloud DB (e.g. their own Supabase). **Why:** "data stays in the
user's hands" = the user holds the key, not us. Conflict resolution reuses D-015:
per-subject, newer-by-timestamp wins, so the time-aware design is already merge-ready.
v1 stays single-device; this is a deferred decision, not MVP scope.

### D-019 — Two tiers (local + cloud), sequenced; storage behind an adapter boundary
Offer two ways to run, built in order. (1) **Local / npm first** — install or `npx
jamgate`; data on the user's machine; single device; max privacy; proves the gate and
serves technical early adopters at zero hosting cost. (2) **Hosted cloud later (v2)** —
a website where the user copies a config + key into their agent; data on a known secure
service (e.g. Supabase); works across all devices; near-zero install for everyone — the
most recognized, lowest-friction adoption path. **Why sequenced:** the cloud tier brings
real obligations — GDPR/privacy duties (maintainer is in the EU), security/breach
responsibility, and ongoing hosting cost with no revenue (must decide who funds it).
**Key enabler now:** keep the store behind a clean adapter interface (file / SQLite /
Supabase are interchangeable implementations); the gate and server depend only on that
interface, so adding the cloud store later is a drop-in, not a rewrite. Open v2
sub-decision: our-hosted Supabase (easier for users, more liability for us) vs the
user's own Supabase (less liability, more setup). Extends D-006 and D-010.

---

## Phase 2 — Robustness (user data can never be corrupted; memory retires itself)

### D-020 — Atomic, durable file writes (temp + fsync + rename)
The FileStore never writes the target file in place. It serializes to a temp file in the
**same directory**, `fsync`s it, then `rename`s over the target. **Why:** an in-place
write that is interrupted (crash, power loss, `kill`) leaves a half-written, unparseable
store — catastrophic for a trust project whose whole promise is "your data can't be
corrupted." `rename(2)` is atomic on a POSIX local filesystem, so a reader or a crash
sees either the whole old file or the whole new one, never a torn one; keeping the temp
in the same directory guarantees the rename stays on one filesystem (a cross-device
rename is a copy, not atomic). Windows/network-FS caveats are documented in code. Phase 2.

### D-021 — Type-based TTL / expiry with soft-expire + compaction
Each memory gets an `expiresAt` derived from its `type` at save time, per the 5-layer
model (§4): identity/preference never expire, projects last ~90 days, volatile state
~2 days. Defaults are overridable via env (`JAMGATE_TTL_<TYPE>_DAYS`, value in days or
`never`). Expiry is **soft**: expired records are hidden from recall but not deleted, so
they remain auditable/recoverable. A separate compaction step physically removes records
only once they have been expired past a grace window (default 30 days,
`JAMGATE_COMPACT_GRACE_DAYS`); it runs opportunistically on every save (no scheduler) and
is also exposed as `FileStore.compact()`. **Why:** RULES §2.5/§4 and the forbidden list
require volatile state to expire, but hard-deleting on expiry is destructive and loses
audit trail; soft-expire + delayed compaction retires stale entries by themselves while
staying recoverable. Untyped memories get no expiry — we don't guess a lifespan we can't
justify. Extends D-008.

### D-022 — Concurrency safety: store lock + re-read-before-write
Two MCP server processes can point at the same file (Claude Code and Cursor both on
`~/.jamgate/memory.json`). Every read-modify-write now runs under an advisory lock file
(`<store>.lock`, created with `O_CREAT|O_EXCL`) and re-reads the store fresh inside the
lock, so concurrent writers serialize and no committed write is lost. Stale locks (holder
crashed) are detected by age and stolen. **Why:** without this, two writers read the same
base, both write, last `rename` wins → silent lost update; unacceptable for a trust
project. **Honest limits (documented in `lock.ts`):** correct for processes on one host
sharing a real local filesystem; not safe over NFS/SMB; stale-stealing has a small
inherent race; on lock-acquire timeout it proceeds best-effort rather than fail the
user's save. Sufficient for the local-first MVP (D-010); a hosted backend (D-019) would
use DB transactions instead.

### D-023 — On-disk schema versioning with automatic migration
The store file is now a versioned envelope `{ schemaVersion, memories }` instead of a
bare `Memory[]`. On read, any older shape is migrated in memory (the legacy unversioned
array → current version, backfilling `expiresAt` from type), and the upgrade is persisted
on the next write. Unrecognizable/empty input degrades to an empty store rather than
throwing. **Why:** existing users' files must keep working as the shape evolves, and a
first-class version marker makes every future migration a small, explicit, testable step
instead of a guess. Phase 2.

---

## Phase 3 — Intelligence (from exact-match rules toward semantic understanding, still local-first)

### D-024 — Trusted client provenance from the MCP handshake
Each saved memory carries an optional `client` field ({name, version}) captured **server-
side** from the `clientInfo` in the MCP `initialize` handshake (`server.getClientVersion()`),
NOT from the tool arguments. **Why:** in a shared cross-agent memory, knowing which app
(Claude Code, Cursor, Cowork, …) actually wrote a fact is real audit value — but only if it
can't be spoofed. Taking it from the handshake makes it provenance the calling agent cannot
forge through a tool call. The field is additive/optional, so the schema stays v2-compatible
(absent on pre-Phase-3 records) and no migration is needed. Required a small refactor of
`index.ts` into a testable `createServer(store)` factory so the handshake path is driven over
an in-memory transport in tests. Phase 3.

### D-025 — Local-only gate decision log (training buffer for the thin classifier)
Every gate decision (saved / duplicate / superseded / conflict / possible_duplicate /
rejected, each with reason, type, subject, source, client, and the memory text) is appended
as one JSON line to a local `~/.jamgate/gate.log`. **Why:** D-004 plans a thin "is this worth
keeping?" classifier for ambiguous cases; training it well needs *real* labelled data from
actual usage, not guesses. This log collects exactly that. **STRICTLY LOCAL** — it never
leaves the machine, same promise as the store (D-010, and RULES: never send data to any cloud
AI). It is size-capped with single-file rotation (`<path>.1`) so it can't grow without bound,
truncates logged text to keep lines small (so appends stay atomic on POSIX), and is
disable-able (`JAMGATE_GATE_LOG=off`). Logging is best-effort: a log-write failure must never
break or fail a user's save. Phase 3.

### D-026 — Optional local embeddings (semantic recall + near-duplicate detection)
Integrate `@huggingface/transformers` (Transformers.js) with all-MiniLM-L6-v2 (384-dim) as an
**optional enhancement**, not a base dependency. **Structure:** it is an optional
peerDependency, lazily dynamic-imported; if the package or model is absent the loader returns
null (never throws) and the gate degrades to fuzzy lexical recall (D-028's fuzzy layer). The
base install stays zero-heavy-deps and works fully offline; **CI runs the fuzzy path** (no
model download). Inference is **fully local** — no text ever leaves the machine (RULES: never
send data to any cloud AI). **Two uses when present:** (a) recall blends semantic cosine
similarity with the fuzzy score, earning synonym reach ("automobile" recalls a "car" memory)
that lexical scoring structurally cannot, with a semantic floor so noise can't flood results;
(b) a semantic near-duplicate (cosine above threshold, default 0.88, `JAMGATE_DUP_THRESHOLD`)
that is NOT an exact match returns action `possible_duplicate` with the existing record for the
agent to decide — mirrors the conflict pattern (D-015's guard), **never a silent drop**. A
subject-bearing save intentionally skips near-dup and takes the time-aware supersession path
(supplying a subject signals intent to update). Vectors are stored alongside records in the
JSON (brute-force cosine is fine at this scale); the field is additive/optional so the schema
stays v2-compatible. The store depends only on a small injected `Embedder` interface, so the
pure math (cosine/blend/threshold) and the full semantic wiring are unit-tested in CI with
hand-built vectors and a deterministic mock — no network. **Honest limits:** all-MiniLM is
small; it handles paraphrase and common synonymy well but is weaker on domain jargon and
negation, the near-dup threshold is a heuristic (a numeric-only change like "salary is 100k" →
"120k" can read as a near-dup — hence advisory, returned to the agent, not dropped), and
records written before an embedder was available simply have no vector and fall back to fuzzy.
Phase 3.

### D-027 — Conservative automatic subject derivation
When the agent omits `subject`, derive a best-effort one from the text with deterministic,
ML-free rules: a curated keyword map for common unambiguous subjects (location,
operating-system, email, timezone, name, programming-language, current-project) plus a
possessive/copula noun-phrase extractor ("my favorite color is blue" → "favorite-color").
**Why:** `subject` drives time-aware supersession (D-015) but agents frequently omit it,
leaving memories un-supersedable and letting stale facts pile up. **Deliberately
conservative:** a *wrong* subject would wrongly retire an unrelated memory, so it only assigns
on a confident rule match and otherwise leaves the subject unset — a missing subject is safe,
an invented one is not. Derivation lives in the gate/server layer, keeping the store purely
mechanical. Later, the embedding layer (D-026) or the thin classifier (D-004) can improve this
with semantic subject clustering. Phase 3.

---

## Phase 5 — Remote (optional): one self-hosted instance behind an endpoint, shared by all a person's agents

### D-029 — Optional remote mode: Streamable HTTP + bearer token; one instance = one human
Add an **opt-in** remote transport so a single self-hosted Jamgate instance can serve all of
one person's MCP clients at once — the Claude phone app (custom connector), claude.ai, Claude
Code on a laptop (`--transport http`), a ChatGPT MCP connector — sharing **one** memory. Enabled
only by `jamgate --http [--port 8420]` (or `JAMGATE_HTTP=1` / `JAMGATE_PORT`); **stdio stays the
default** and the local-first story is unchanged. Built on the MCP SDK's
`StreamableHTTPServerTransport` (stateful, per-session), with `createServer(store)` shared between
the stdio and HTTP paths so the handshake-based client provenance (D-024) works identically over
HTTP. Multiple concurrent HTTP sessions share **one** `FileStore`; the Phase 2 lock +
re-read-before-write (D-022) make simultaneous saves safe within the process (covered by a
concurrent-two-session test).
**Auth:** a bearer token via `JAMGATE_TOKEN`, **required** in HTTP mode — the server refuses to
start without it and says so. Every request is gated; a missing/wrong token is a flat `401`. The
comparison is **constant-time** (`crypto.timingSafeEqual`, length-independent) so the token can't
be recovered from response timing.
**TLS is out of process by design** — terminate it at a reverse proxy (caddy/nginx). Jamgate binds
to `127.0.0.1` by default (`JAMGATE_HOST` to override) so the proxy is the only public door; we do
not ship in-process TLS (cert management, renewal, and secure defaults are the proxy's job, and
doing it ourselves would be a worse, home-grown version of a solved problem).
**Honest limits, stated as deliberate scope:** whoever holds the token holds the whole memory, and
there is **no multi-user tenancy — one instance = one human.** Jamgate's memory is *of one person*
(RULES §0, D-016); per-user isolation, RBAC, and audit-per-identity are a different product. A team
that wants shared-but-partitioned memory runs one instance per person. This keeps the security
surface tiny (one secret, one store) and matches the core promise: *your own server, your own
data.* **Why now:** the whole point of the project is "one mind, one memory across every agent"; as
soon as the user has agents on a phone and multiple machines, stdio (one local process per client)
can't be that shared brain — a single reachable endpoint can. Extends D-010/D-019 (local-first
default; storage/transport behind clean seams) toward the hosted tier without taking on the D-019
cloud-tenancy obligations. Phase 5.

## Phase 6 — One-click install: reduce install friction to near-zero for every client

### D-030 — `jamgate setup`/`status`: safe, idempotent auto-wiring across MCP clients
Ship an install helper so a new user goes from zero to wired in one command:
`npx jamgate setup` detects the MCP clients present on the machine (**Claude Code**,
**Claude Desktop**, **Cursor**, **Windsurf**) and adds Jamgate's `mcpServers` entry to each.
`jamgate status` reports where Jamgate is wired and where the store lives.
**Safety is the whole point** — the command is the first thing a stranger runs, so it must never
surprise them:
- **Idempotent.** Outcome is decided from the current file state (`already-configured` /
  `configured` / `updated`); a second run writes nothing.
- **Never clobbers.** Only our own `mcpServers.jamgate` key is ever touched; every other server
  and every other top-level field is preserved (parsed → merged → re-serialized, not string-patched).
- **Backup-first.** Any existing config file is copied to `<file>.jamgate-backup` before a write.
- **`--dry-run`** computes and prints every change without touching disk.
- **`--remote <url> --token <t>`** writes HTTP-transport entries for the clients that speak
  Streamable HTTP (Claude Code, Cursor); clients without a verified HTTP path (Claude Desktop's
  connectors flow, Windsurf's SSE `serverUrl`) are **skipped with a reason** rather than mis-wired —
  honesty over coverage.
**Claude Code** prefers `claude mcp add --scope user` when the CLI is present (the blessed path,
robust to schema drift), and falls back to a direct `~/.claude.json` merge otherwise; the stdio
entry is written in Claude Code's own `{type,command,args,env}` shape so a CLI-added entry reads as
already-configured on re-run. **Architecture:** a pure client registry + pure JSON merge (fully
unit-tested against a fake home, never the real configs) under a thin IO runner and CLI, mirroring
the D-029 split of `parseCliOptions` from the transport. **No new runtime dependencies** — the
zero-dep philosophy (D-010) holds; the whole helper is Node stdlib.
Complemented by two zero-CLI on-ramps: a **Cursor deeplink**
(`cursor://anysphere.cursor-deeplink/mcp/install?name=jamgate&config=<base64 of {command,args}>`,
payload verified to round-trip) as an "Add to Cursor" badge, and a **Claude Desktop `.mcpb`
bundle** (MCPB manifest v0.3, built headlessly with `@anthropic-ai/mcpb`, ships as a GitHub release
asset). The bundle omits the optional embeddings peer, so it behaves like a base install (fuzzy
recall) — verified to boot on stdio and answer `initialize` + `tools/list` from its bundled deps.
Phase 6.

## Phase 7 — Deploy button: a hosted instance for non-technical users, without us hosting

### D-031 — Deploy templates are convenience, not hosting; we never touch user data
Give a non-technical user a third rung on the install ladder (local `npx` setup → **deploy
button** → own VPS): click a button in the README, log into a hosting platform, and get **their
own** Jamgate instance with a URL and token — no terminal, no server knowledge. This closes the
multi-device gap for people who will never run `systemd` + Caddy but do have agents on a phone,
a browser, and a laptop.
**The hard rule that makes this safe: a deploy button is *convenience*, not *hosting*.** The
instance runs in **the user's own account** on **their** platform; the memory store lives on a
disk **they** own and pay for; **Jamgate hosts nothing, proxies nothing, and has no telemetry**.
We never see or touch their data. This is a direct extension of the D-029 "your server, your
data" promise and the D-010 local-first ethos — we are handing the user a pre-filled deploy form,
not a service. The cost (~$5–7/month for a tiny always-on instance + small disk) is paid by the
user to the platform; **we take no cut and run no cloud** (RULES §0: impact, not profit).
**Mechanism.** A **multi-stage `Dockerfile`** (`node:22-alpine`, non-root `node` user, prod-only
deps, base install / fuzzy recall — the embeddings peer is omitted, matching the `.mcpb` bundle).
It runs Remote mode (D-029): binds `0.0.0.0`, keeps the store on a `/data` volume
(`JAMGATE_STORE=/data/memory.json`), and **honors the platform's `$PORT`** — `JAMGATE_PORT` is
left unset in the image precisely so `$PORT` wins (setting it would break port injection). A new
unauthenticated **`GET /healthz`** (200 `{status, version}`, before the auth gate, exposing no
memory) gives platforms a liveness probe.
- **Render** — [`render.yaml`](./render.yaml) is a complete blueprint: Docker web service,
  `healthCheckPath: /healthz`, a generated `JAMGATE_TOKEN` (`generateValue: true`), and a 1 GB
  disk at `/data`. The `render.com/deploy?repo=…` button reads it from the repo, so it **works
  today** with no manual account setup beyond login (a disk forces a paid `starter` instance).
- **Railway** — [`railway.json`](./railway.json) pins the Dockerfile build + `/healthz` + restart
  policy. But Railway **volumes and generated secrets are template-level, not file-level**, and
  the "Deploy on Railway" button needs a *published template* (`railway.com/new/template/<code>`).
  Publishing a template is an interactive workspace step that can't be done headlessly, so the
  button is **prepared but not live**; the exact remaining maintainer clicks (add volume at
  `/data`, add `JAMGATE_TOKEN=${{ secret(32) }}`, Generate Template, publish) are documented in
  the README — **honesty over a button that 404s**.
**No new runtime dependencies** — the Docker image adds only build tooling, and the health
endpoint is Node stdlib (D-010 holds). **Verification honesty:** Docker was not installed on the
build machine, so the image layering was not built; instead the exact runtime env (0.0.0.0 bind,
`$PORT` honored, `/healthz` unauthenticated, `/mcp` 401 without a token) and the `--omit=dev`
production install were verified locally, and the HTTP MCP round-trip is covered by the existing
test suite. Phase 7.

## Phase 8 — Backup & migration: move your memory without hand-copying a file

### D-033 — `export`/`import` are transports for the store; import goes through the gate, never around it
Users need to back up their memory, move it to a new machine, or lift a local store onto a
server. The honest primitive already exists (the store is one JSON file at `JAMGATE_STORE`), but
"scp the file yourself" is fragile: it ignores schema versioning, and merging two stores by hand
means either clobbering or blind-appending — both of which reintroduce exactly the junk the gate
exists to keep out. So we add two subcommands that make backup a first-class, one-command
operation while keeping the quality invariants intact.

**`jamgate export`** dumps the store as the same `{ schemaVersion, memories }` envelope it uses
on disk, plus `exportedAt`/`generator` provenance. It writes pure JSON to **stdout** (so it
pipes) or to a file with `--output`, with the human summary on **stderr** so it never pollutes
the data stream. Active **and** superseded records are included by default (a faithful snapshot
for archival/audit); `--active-only` trims to live facts. Embeddings already on records are kept,
so a near-duplicate check still has something to compare against on import.

**`jamgate import`** is the load half, and its one firm rule is: **an import is a batch of saves,
not a file copy.** Every incoming ACTIVE record is replayed through the *same* gate a live
`save_memory` uses — exact-dup dedup, subject-based time-aware supersession, the trust/contradiction
guard, and semantic near-duplicate detection — so importing can never smuggle in duplicates or
let a low-trust fact silently overwrite a high-trust one. Records already marked `superseded` in
the source are historical audit and are **not** re-activated through the gate; they are counted
and skipped. Provenance is **preserved, not reset**: a record keeps its own id, `createdAt`,
source, subject, type, client and embedding; only records *retired during this import* are
re-stamped (at import time). Every outcome is reported per-record (imported / duplicate /
superseded / conflict / near-duplicate); conflicts and near-duplicates are *flagged for a human*,
never silently resolved — mirroring how the live gate hands ambiguous writes back to the agent.
The whole batch runs under one store lock and a single write, so an import is atomic; `--dry-run`
reports what would happen and writes nothing; a malformed file (bad JSON, wrong shape, a record
with no `text`) is rejected with a nonzero exit before the store is touched. `import` also accepts
a bare JSON array, not just our envelope, so a hand-written or third-party list still works.

Mechanically this reused the gate rather than re-implementing it: the stateful checks in
`FileStore.saveLocked` were extracted into a private `applyGate(candidate, memories, now)` that
mutates an in-memory list without persisting, and both `save()` (one candidate, one write) and
the new `importBatch()` (many candidates, one write) drive it. No behavior change to `save`.

**Concurrency fix found along the way.** Building the import path surfaced the real cause of a
long-standing intermittent flake (the concurrent-HTTP-sessions test persisting 23 of 24 saves,
which had occasionally failed tag-triggered Publish runs). It was **not** the near-duplicate gate
(that path needs embeddings, which neither CI nor a base install loads): it was the file lock.
Acquiring the lock is `open(wx)` — which creates an **empty** file — followed by a *separate*
write of the holder's timestamp. A waiter that checked staleness during that empty window read
`Number("") === 0` and judged the just-born lock ancient (`now - 0 > staleMs`), stole it, and ran
concurrently → one write clobbered another. The staleness check now treats an empty/non-numeric
body as mid-creation and ages the lock out by its **mtime** instead of a phantom timestamp, so a
fresh lock is never stolen while a genuinely abandoned one still recovers after `staleMs`. Proven
by 15 consecutive green runs of the HTTP test and a ~1-3%→0 flake rate over 200+ trials, and
pinned by deterministic `isStale` unit tests. Phase 8.

## Phase 9 — MCP OAuth: add your instance to claude.ai and the Claude mobile app

### D-034 — Jamgate is its own OAuth authorization server; the instance token is the one credential
Remote mode (D-029) shipped with a single static bearer token: every request to `/mcp` must carry
`Authorization: Bearer <JAMGATE_TOKEN>`. That works for Claude Code (you set the header yourself)
but **fails for the two clients most people actually want on the go** — claude.ai and the Claude
mobile app. Those clients don't accept a static token in a config field; they only speak the
[MCP authorization flow](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
(OAuth 2.1 + PKCE, discovered via RFC 9728 / RFC 8414, with RFC 7591 dynamic client
registration). Adding a personal instance as a custom connector drove the client to
`GET https://<host>/authorize?response_type=code&client_id=…`, which 404'd — Jamgate had no OAuth
surface at all. So a whole class of "share one memory across my devices" (the entire point of
remote mode) was blocked in practice.

**Decision: implement the MCP OAuth flow *in Jamgate itself*, with no external identity provider.**
One instance = one human (D-029), so bolting on Auth0/Keycloak/etc. would be both overkill and a
betrayal of the local-first, self-hosted promise (D-010): it would add a runtime dependency, a
second service to run, and a third party in the trust path. Instead the instance acts as **its own
authorization server on the same origin as the resource server**, and the existing
`JAMGATE_TOKEN` stays the *single* credential — the OAuth flow is just a standard, client-friendly
way to prove you hold that token and to mint per-client access tokens from it. No new runtime
dependencies: Node's `crypto` + the existing `node:http` layer only.

**What the spec required (verified against the 2025-06-18 spec), and what we serve:**
- **RFC 9728 protected resource metadata** — `GET /.well-known/oauth-protected-resource` returns
  `{ resource, authorization_servers: [<this origin>] }`, and a `401` from `/mcp` now includes
  `WWW-Authenticate: Bearer realm="jamgate", resource_metadata="…/.well-known/oauth-protected-resource"`
  so an unauthenticated client discovers the flow. The path-suffixed variant
  (`/.well-known/oauth-protected-resource/mcp`) resolves to the same document.
- **RFC 8414 AS metadata** — `GET /.well-known/oauth-authorization-server` advertises the
  `authorization`/`token`/`registration` endpoints, `response_types_supported: ["code"]`,
  `grant_types_supported: ["authorization_code","refresh_token"]`, and
  `code_challenge_methods_supported: ["S256"]` (PKCE S256 is mandatory; `plain` is rejected).
- **RFC 7591 dynamic client registration** — `POST /register` accepts `redirect_uris`
  (validated: HTTPS or loopback only) + optional `client_name`, mints a public `client_id`
  (`token_endpoint_auth_method: "none"` — PKCE public clients, no client secret), and persists it.
- **`GET`/`POST /authorize`** — the one HTML page in the whole project: a self-contained, on-brand
  consent screen that asks the user to paste their instance token *once* ("This is your Jamgate
  instance. Enter your instance token to authorize this client."). The token is verified
  constant-time; on success we mint a single-use authorization code bound to
  `client_id + redirect_uri + PKCE challenge`; a wrong token re-renders the page with an error
  instead of failing the flow.
- **`POST /token`** — exchanges `code + code_verifier` for a long-lived (90d) access token and a
  rotating refresh token; also handles `grant_type=refresh_token` with refresh-token rotation
  (the OAuth 2.1 public-client rule).

**`/mcp` now accepts EITHER credential** — an issued OAuth access token **or** the static
`JAMGATE_TOKEN` — so existing Claude Code connections are completely unaffected (backward-compat
was a hard requirement, tested). OAuth is **on by default** in remote mode (`--http`); set
`JAMGATE_OAUTH=off` to run static-token-only.

**Security posture (all tested):** PKCE S256 required; `redirect_uri` matched **exactly** against
the client's registration, and an unregistered/forged `redirect_uri` renders an on-page error
rather than 302-ing to it (no open redirect / no phishing hop); authorization codes are
single-use (consumed unconditionally on presentation, so a bad verifier can't be retried and a
replay finds nothing) and expire in ≤60s; **secrets are hashed at rest** — auth codes, access
tokens and refresh tokens are stored only as their SHA-256 digest in `~/.jamgate/oauth.json`
(`JAMGATE_OAUTH_STORE`), so a leaked file can't be replayed, and revoking a token is deleting its
entry. All OAuth state uses the *same* atomic temp-file+fsync+rename write and the *same*
cross-process `withFileLock` as the memory store (D-020..D-023), re-reading fresh inside the lock;
the file self-prunes expired codes/tokens on every write. The public base URL for the advertised
endpoints is derived from the reverse proxy's `X-Forwarded-Proto`/`X-Forwarded-Host` so the
metadata points at the externally-reachable HTTPS URL, not the localhost bind. Phase 9.

### D-035 — Import another product's memory, through the gate; curated entries only, never chat logs
The worst moment in switching AI tools is the cold start: you have already told the other product
who you are, and none of it comes with you. Jamgate is a *gate, not a store*, so the honest way to
solve this is not a scraper — it is a parser plus the gate we already have. `jamgate import
--from claude|chatgpt <path>` turns a vendor memory export into `Memory[]` and hands it to the
**same** `importBatch` path as a native import (D-033): exact-duplicate dedup, time-aware
supersession, the trust/contradiction guard, near-duplicate detection. Vendor records get no
privileged path around the gate — that is the whole point of importing rather than copying.

**What the formats actually are (checked July 2026).** Neither vendor's bulk account data export
contains memory entries. Claude's export holds conversations and account data; ChatGPT's holds
`conversations.json`, `chat.html`, `user.json`, `message_feedback.json`, `model_comparisons.json`.
Both keep memory in their own settings UI (Claude: Settings → Capabilities → "View and edit your
memory"; ChatGPT: Settings → Personalization → Memory → Manage) with a documented copy-out path,
and Anthropic's own memory-transfer format is `[date saved, if available] - memory content`. So the
primary parser is a **text/markdown line parser**, built on a format we could verify, and the JSON
path is explicitly **best-effort** for structured exports we could not verify — it looks for
entries under memory-ish keys and fails loudly rather than guessing. We still accept the `.zip` or
extracted folder and pick the memory-shaped file out of it, because that is what a user has in
their Downloads folder. Reading a zip needs no dependency: a ~100-line reader over the central
directory plus `node:zlib` raw inflate covers STORE/DEFLATE, and anything exotic is refused.

**The line we will not cross: conversation logs are never mined.** They are recognized by name,
skipped, and reported as skipped. Reconstructing someone's identity from their raw chat history is
precisely the low-consent inference this project exists to push back on, and "we could get more
memories that way" is exactly the argument that produces memory nobody asked for. Consent is
structural here in another way too: Jamgate never touches a vendor account or API — the user
downloads their own export and points us at a local file.

**Mapping stays conservative.** `source: user-confirmed` — the user curated these entries in the
source product, which is a confirmation, but not `user-explicit` (they did not dictate them to us)
and not `agent-inferred` (they are not our guess). `type` is inferred only on obvious wording
(`preference`/`identity`), otherwise left unset: a wrong type is worse than no type, and untyped
memories are still recalled. Original dates are preserved so supersession orders history
correctly; `subject` comes from the same `deriveSubject` rules a live save uses; provenance is
stamped `import:claude.ai` / `import:chatgpt`. And because a hand-pasted list can carry stray
prose, every line is a *candidate* only — `--dry-run` shows exactly what would land first. Phase 10.

### D-036 — Recall scores the whole memory (text + subject + type), not just the text
A desktop chat asked Jamgate for the user's **projects** and got *"No matching memories"* — over a
store that held a record with `type: "project"` and `subject: "jamgate-project"`. The text of that
record simply never used the word "project", and recall scored **text only**. The gate works hard
to assign structured fields, and then the one operation that most needs them could not see them.
That is a design bug, not a tuning problem: the fix belongs in the scorer, not in a threshold.

`memoryRelevance(query, memory)` now scores against the text **plus the subject's words** —
hyphenated keys (`current-project`, `operating-system`) are split back into ordinary words, so
subject tokens are weighted exactly like text tokens. A subject is a compressed statement of what
the memory is about; treating it as second-class was the mistake. On top of that, a query that
names a memory's **type** adds a small boost (`TYPE_BOOST = 0.15`), deliberately just above
`MIN_RELEVANCE`: enough that "what are my projects?" surfaces `type: "project"` records whose text
never says the word, but low enough that a bare type match always ranks below a real word match.

It stays deterministic, ML-free and cheap — one extra short string in the same single pass, no new
allocation per candidate beyond that. A memory with neither subject nor type scores exactly as
before, so this is additive: nothing that used to be found stops being found. Semantic reach for
genuine synonyms remains the optional embedding layer's job (D-026); this is about not throwing
away structure we already have. Regression tests pin the original miss end-to-end through the
store, not just at the unit level.
