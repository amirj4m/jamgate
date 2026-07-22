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

### D-037 — Validate the argument before judging the memory; a usage error is not a verdict
Reported from real use: an agent saved to a remote instance and *"the gate rejected everything
with 'too short' — even a ~1700-character memory."* Reproduced over the live HTTP path in three
steps, and it was never the gate's judgement — the text had simply never arrived.

`save_memory` did `String(args.text ?? "")`. A missing or misnamed `text` collapsed to `""`, the
prefilter dutifully answered **"too short"**, and the caller was told something demonstrably false
about a memory it knew was long. Worse, a client that wrapped the memory in a content block
(`text: { type: "text", text: "…" }`) stringified to the literal **`"[object Object]"`** — which
sailed through the gate and was *saved*, with a success message. One bug made a good call look
rejected; the other made a broken call look accepted.

Three fixes, and the shape of them is the point:
1. **Validate the argument first.** A missing, empty or non-string `text` returns an MCP error
   result (`isError: true`) naming the required field **and the keys that actually arrived** —
   `received keys: content, type` — so an agent can correct itself without a human debugging the
   wire. It is not written to the gate log: a client mismatch is not a memory judgement, and
   logging it as `rejected` would poison the classifier's training data with non-memories.
2. **Never report an unfalsifiable reason.** The prefilter's verdict now carries the measured
   length ("too short (2 characters, minimum 4)"). A caller can compare that against what it sent
   and see the discrepancy immediately, which is precisely what the bare message denied the user.
3. **Put the gate log where the service can write it.** The default was `~/.jamgate/gate.log`;
   under systemd `ProtectHome=true` / `ProtectSystem=strict` every append had been failing with
   ENOENT, so the audit trail was empty **exactly when a production bug needed it** — the evidence
   for this incident had to be reconstructed by re-running the client instead. The log now
   defaults next to the store (following `JAMGATE_STORE`), which is where the comments always
   claimed it lived; an explicit `JAMGATE_GATE_LOG` still wins.

The general rule this encodes: the gate answers "is this worth remembering?" — it must never be
handed a question it cannot answer and made to guess. Malformed input gets a straight answer about
the input. Phase 10.

### D-038 — An expired session is a 404, because 404 is the only word a client understands

Third bug found by real use in one day. A claude.ai conversation had a working session — recall
returned memories — then the droplet's `jamgate.service` restarted for a deploy. Every subsequent
`save_memory` in the *same* conversation failed with "session expired" / "Not connected", and the
client never came back: asking it to disconnect and reconnect did not help either.

Sessions live in this process's memory, so a restart invalidates every session id in the wild.
That part is fine and expected — the Streamable HTTP spec plans for exactly it, and the recovery
handshake is triggered by a *status code*:

> The server MAY terminate the session at any time, after which it MUST respond to requests
> containing that session ID with HTTP 404 Not Found. …When a client receives HTTP 404 in
> response to a request containing an `Mcp-Session-Id`, it MUST start a new session by sending a
> new `InitializeRequest` without a session ID attached.

We answered **400** with `"no valid session id; send an initialize request first"`. The message
was addressed to a human reading a log; the client only reads the code, and 400 means "your
request was malformed" — a fact about *this* request, not about the session. So there was nothing
to recover from, and the conversation stayed wedged on a dead session id until it was abandoned.
The prose was right and the number was wrong, and only the number was load-bearing.

The fix separates two cases that had been collapsed into one:

- **Session id present but unknown** → `404`. The client re-initializes automatically; the user
  sees nothing at all. This is the whole bug.
- **No session id, and not an `initialize`** → still `400`, per the same section's point 2. This
  is a genuinely malformed request and must not be told to "retry with a new session".

Both apply on POST, GET (the SSE stream) and DELETE. The auth gate keeps running first, so a
*wrong* token with a dead session is still `401` — an expired session must never become an oracle
that answers questions to an unauthenticated caller — while a *valid* token with a dead session
gets the 404 rather than having it masked as an auth failure.

We also accept an `initialize` that still carries a stale session id, and issue a fresh id. A
strict reading would 404 that too (it "contains that session ID"), but a client sending an
initialize is already trying to do the right thing; refusing its recovery attempt would strand it
permanently, which is the precise failure we are fixing.

**Deliberately not done: graceful shutdown / session persistence.** Both were considered and both
make things worse. Persisting sessions to disk cannot work — a session owns a live server object
and an open stream, not a serializable row — and the 404 re-init is the standard path anyway. A
`SIGTERM` handler awaiting `httpServer.close()` would *hang*: idle GET/SSE streams keep the server
open indefinitely, so systemd would wait out `TimeoutStopSec` and `SIGKILL` us — turning an
instant restart into a 90-second one, and lengthening exactly the window this bug lives in. There
is also nothing that needs draining: store writes are atomic renames under a file lock whose stale
entries are stolen after 30s (D-010), so a hard kill mid-write loses at most the one in-flight
save and never corrupts the file. The unit file was reviewed and deliberately left unchanged.

The general rule: when a protocol assigns meaning to a status code, the status code *is* the API.
A helpful error message is not a substitute for the number the other side is actually reading.

### D-039 — A client that sends `content` still meant to save a memory; accept the alias

The empty-text `save_memory` that D-037 made *legible* is now **explained**: live evidence from a
claude.ai/Cowork call shows the client sends the memory under `content`, not `text`. Our handler
read `args.text`, found nothing, and (before D-037) reported the absurd "too short" for a memory
the agent had just written. D-037 turned that into an honest error naming the received keys —
correct, but still a dead end for the user, whose memory was simply not saved.

So `save_memory` now resolves its text from `text`, then `content`, then `memory`, taking the
first that is a non-empty string. `text` remains canonical and wins whenever it is usable; the
aliases are documented in the `text` field's description so a reading agent keeps preferring the
canonical name. Everything downstream is unchanged — the gate judges the resolved text exactly as
if it had arrived under `text`, and there is no special log line or warning, because from the
gate's point of view nothing unusual happened.

**Considered and rejected: `additionalProperties: false`.** A strict schema would have made this
failure loud at the SDK layer instead of silent, and that is a real argument — the bug cost a day
precisely because it was quiet. We still declined it, for three reasons:

1. **It fails the user to teach the client a lesson.** A hard rejection is not more correct than
   accepting the memory; it is the same non-save with a better error. The user's memory is the
   thing we exist to keep, and we are the neutral layer *every* agent writes through — a layer
   whose value proposition is "it just works across clients" cannot be the strictest party in the
   stack about a field name it can trivially recognise.
2. **We do not control the clients.** Jamgate is cross-agent by definition (RULES §1). Claude,
   Cursor, Cowork and whatever ships next all call us; a schema error is a bug report we cannot
   file and cannot fix, and the user carries it in the meantime.
3. **Strictness would break more than it catches.** `additionalProperties: false` rejects *any*
   extra key, so a client that helpfully attaches a `timestamp` or `session_id` would be refused
   an otherwise perfect save. The failure mode is much wider than the one case it would have
   caught.

The alias list stays deliberately short and dumb — three exact names, no fuzzy matching, no
inspecting nested objects. Recognising `content` is compatibility; guessing at arbitrary shapes
would be the gate deciding what the caller meant, which is not its job. A non-string under an
alias is still a clear error naming every key received (D-037's message, unchanged).

The general rule: **be strict about what you store, liberal about what you are called with.** The
quality gate belongs on the memory's content, never on the caller's spelling.

### D-040 — Auto-subject declines to guess on long or multi-topic text

Reported from a real stress test: the user fed his full accounting documentation to an agent and
told it to save liberally. Three consecutive `save_memory` calls — a financial model, a personal
profile, then a bookkeeping model — each superseded the *immediately previous* one, so only the
last survived. The gate log names the cause precisely (21 Jul 2026, 15:35–15:36Z): all three were
saved with `"subject":"location"`.

None of the three was about location. Each merely happened to contain the word *lives*:
"jam's accounting system **lives** in ~/Documents/accountant", "jam **lives** in Athens", "jam's
bookkeeping **lives** in ~/Documents/accountant". D-027's keyword rules scan the whole text and
the first match wins, which is sound for a one-line fact and indefensible for a thousand-character
multi-topic dump: an incidental verb anywhere in five paragraphs decided what the memory was
*about*, and subject equality is exactly what drives supersession (D-015).

We verified the other half of the hypothesis and it was clean: supersession is guarded by
`if (candidate.subject)` and cannot fire on an absent subject. The bug was entirely upstream, in
what we were willing to guess.

Two guards, both in `deriveSubject`, both refusals rather than corrections:

1. **A length ceiling (300 characters).** Above it we return `undefined`. A single fact is far
   below it; a pasted profile or financial model is far above. Length is a crude proxy for
   "is this about one thing", but it is the honest one — it is exactly the regime where the
   first-match-wins scan stops being evidence.
2. **An ambiguity guard.** If two or more *different* keyword rules match, we return `undefined`.
   Text tripping both `location` and `email` is covering several topics, and picking the earlier
   rule is an arbitrary tiebreak dressed up as a decision.

The asymmetry that makes both calls easy is the one D-027 already stated and then under-applied:
**no subject is safe, a wrong subject is not.** A memory without a subject is simply not
subject-supersedable — it sits there, recallable, harmless. A memory with a wrongly-derived
subject silently retires an unrelated fact the user asked us to keep. The costs are not
comparable, so neither is the burden of proof. An agent-supplied `subject` is still honoured
without question at any length: that is a statement of intent, not a guess.

### D-041 — An id we print must be an id we accept back

`forget_memory` answered "No memory with that id" for an id taken straight out of `recall_memory`
output. Both halves were ours.

Recall printed `- [type] <text> (id <uuid>, <createdAt>)`. On a real memory the text runs for
paragraphs, so the id arrived at the end of a wall of prose, wrapped in parentheses, with a comma
welded to its last character. What comes back is whatever the model's copy of that survived:
truncated, backticked, comma-suffixed. We then compared it with `===` against the stored id and
said no.

Fixed on both sides, because either alone leaves the round trip fragile:

- **Recall gives the id its own line**, last, prefixed `id: `, with no adjacent punctuation and
  nothing after it. Unambiguous to a parser and to a language model.
- **Forget normalizes and resolves.** Copy noise (quotes, backticks, brackets, an `id:` label, a
  trailing comma or period) is trimmed by character class — ids are hex and hyphens, so anything
  else on either end is not part of the id. Then an exact match, or failing that an unambiguous
  prefix of at least 8 characters.

Eight is the floor because the first 8 hex characters of a v4 UUID are ~4 billion apart: a prefix
that short is already a near-certain identifier, and anything shorter is a typo, not a shorthand.
Two matches is an error naming both ids, never a coin flip — deletion is the one operation here
with no undo, so ambiguity resolves to a question, not a guess. A too-short prefix is a plain
miss rather than a loose match, and the not-found message now says where ids come from and what
shape they take.

The rule this encodes: **an interface that emits an identifier owes the caller acceptance of it.**
Strictness at the boundary is only defensible when the boundary is legible, and ours was not.

### D-042 — A shared memory must refuse credentials

A twelve-save stress test handed the gate a fake API key and a password. Both were stored.
The gate had no notion of a credential at all — it checked length and pleasantries, and a
40-character key is neither short nor a greeting.

This is the worst thing the store can hold. A memory here is not a file on one disk: it is
read back verbatim into every future agent session, it syncs to the remote instance, and the
save also appends the text to `gate.log`. One careless save fans a secret out across every
surface the project exists on.

Detection is deterministic and rests on exactly two grounds, because the failure modes are
asymmetric in both directions. Missing a secret stores it. But wrongly refusing a real
memory is worse than it looks: the agent cannot tell a principled refusal from a broken one,
so it learns the gate is unreliable and routes around it. So:

1. **Shape** — a token matching a vendor-assigned credential format (`sk-…`, `AKIA…`,
   `ghp_…`, `npm_…`, `xox…`, a JWT, a PEM block, a `Bearer` header). These prefixes exist
   precisely so the format is unambiguous; matching one is near-proof, not a heuristic.
2. **Entropy + context** — a high-entropy mixed-alphabet token AND credential wording
   nearby. Neither half alone: entropy alone flags every git sha, and wording alone flags
   "jam uses a password manager".

The character-class requirement is the load-bearing part of rule 2 and the reason it can be
trusted. A credential body mixes lowercase, uppercase and digits; a hex digest — git sha,
UUID, MD5 — has at most two classes no matter how long or how random it is. Requiring three
excludes every hex identifier *by construction* rather than by a tuned threshold, which is
why "fixed it in commit aee2a73f8c…" passes and always will.

The password rule needs one more guard. `password` is a common word in durable facts, and
"jam's password manager is 1Password" has the keyword, a copula and a mixed-case value. It
survives because the rule demands the separator TOUCH the keyword: `password: X`,
`password = X`, `password is X`. That adjacency is what distinguishes "here IS my password"
from "here is a fact ABOUT passwords".

And the rejection **redacts**. Refusing to store a secret while writing it to the decision
log verbatim would move the secret, not protect it. The log keeps the decision and the
reason — which is all the future classifier learns from anyway — and records the text as
`[redacted: N characters]`. Security theatre is worse than no security, because it is
believed.

### D-043 — Junk, questions and weather are not memories

Three more of the twelve stress-test saves were not facts: the bare word `test`, the
question "how much is jam's rent?", and "it's raining in Athens right now". Each cleared the
4-character minimum, and length was never the right question to ask.

Three narrow rules, each firing only on an unambiguous signal:

**Structure.** A memory is a claim about the user, and a single token cannot be one. Fewer
than two meaningful tokens, or nothing but filler and placeholder words, is refused. `test`
is one token. `test test` is two placeholder tokens. "jam codes" is a memory.

**Questions.** A question asks *for* a fact; it is not one. Refused when the text is
interrogative *as a whole* — ends on a question mark AND either opens interrogatively or is
a single sentence. The single-sentence condition is what protects a long memory containing a
rhetorical question, which is a real thing people save and which a naive `endsWith("?")`
would destroy.

**Transience.** "Right now" observations are real, just short-lived, and the model already
has a layer for them (RULES §4). So this is the one rule that refuses *conditionally*: with
a `type` the memory is stored and its TTL ages it out; without one the gate would file a
weather report as a permanent fact, so it refuses and says exactly how to save it properly.

The marker list is deliberately small, and what was left OUT is the decision. "Currently"
and "today" were both considered and rejected as markers: "jam is currently building
Jamgate" is a durable project fact, and losing facts like that costs more than the occasional
transient note it would catch. A condition word alone is likewise not enough — "prefers dry
climates to humid ones" mentions weather without describing any, so a weather word only
counts when framed as *happening* ("it's raining", a progressive verb, a temperature).

All of it is Unicode-aware, and that is not a nicety. A Persian memory saved cleanly in the
same stress test; an ASCII tokenizer would count zero tokens in it and reject it as junk.

### D-044 — A near-duplicate check that only ran half the time

The stress test's first and highest-priority finding: a semantic REWORDING of an existing
memory was stored as a new fact. The obvious suspect was the optional embedder silently
failing in production — plausible, since it degrades quietly by design.

We audited the droplet before changing anything, and the suspect was innocent. The service
logs `semantic embeddings active (Xenova/all-MiniLM-L6-v2)` at start, the model is cached in
the package directory, and 11 of the 12 stored memories carry a 384-dimension vector. The
semantic layer was fully alive.

The bug was structural, three lines up from the check. `applyGate` read:

```ts
if (candidate.subject) { …supersession… }
else if (candidate.embedding) { …near-duplicate check… }
```

The `else` encoded a real intuition — supplying a subject signals intent to update, so a
duplicate check would be wrong. But that intuition only holds when the subject MATCHES
something. When it matches nothing, the candidate is about to be stored as a brand-new fact
and no one has looked for a reworded copy of it at all. A reword whose subject was spelled
differently from the original's — `editor-theme` vs `colour-scheme`, or an agent-supplied
subject against a derived one — walked straight through the gap.

The condition is now "did this save retire anything?" rather than "does it have a subject?".
A candidate that superseded something never reaches the check, so a legitimate update is
still never mistaken for a duplicate; a candidate that superseded nothing always reaches it.
The guard survives, its blind spot does not.

### D-045 — Where a threshold cannot help, say so and hand it to the agent

The last stress-test finding was two saves tracking one value — "ThinkBook savings 5/10,
€640", later "7/10, €768" — both left active. The tempting fix is to lower the duplicate
threshold until it catches them.

We measured the real model first, on the actual pairs:

| cosine | pair |
| --- | --- |
| 0.94 | reworded duplicate (Jamgate description) |
| 0.87 | same subject, NEW value ("uses Windows" → "moved to Linux") |
| 0.83 | reworded duplicate (dark theme) |
| **0.81** | **DIFFERENT facts** ("jam uses Windows" / "jam uses Linux") |
| 0.76 | reworded duplicate (Athens) |
| 0.67 | same subject, NEW value (ThinkBook savings) |

The populations interleave. There is no cutoff that catches the 0.83 reword without also
calling "jam uses Linux" a duplicate of "jam uses Windows" at 0.81 — the exact case RULES
§2.3 says is a supersession, never a duplicate. And the ThinkBook pair at 0.67 sits below
every reword we measured; no threshold reaches it while remaining a threshold at all.

The conclusion is not a better number. It is that **restatement-vs-update is a subject
question wearing a similarity costume.** Cosine measures topical closeness; it cannot see
that 5/10 and 7/10 are the same counter at two times. So the gate stops pretending:

- 0.88 and above → refuse as a `possible_duplicate`. Kept where it is, now for a stated
  reason: it clears the measured 0.81 ceiling of genuinely-different facts with margin, so a
  false refusal is unlikely. The acknowledged cost is the 0.76–0.83 rewords it misses.
- 0.60 to 0.88 → **store the memory, and name what it resembles.** The reply tells the agent
  which existing memory it looks like, that memory's `subject`, and what to do if the two are
  really one tracked value.

The asymmetry that makes the second band safe is the same one running through D-027 and
D-040: a hint cannot retire a fact. Auto-superseding on 0.67 similarity would re-create the
D-040 ping-pong the previous release just fixed, on flimsier evidence. Telling the agent
costs a line of output and risks nothing, which is why a hint is allowed a lower bar of
evidence than an action.

This is also the honest division of labour. The gate holds the whole prior memory, which the
agent cannot see — that is what §2's stateful checks are for. But the agent holds the
conversation, which the gate cannot see, and "is this the same counter?" is a question only
the conversation answers. Handing it back is not the gate giving up; it is the gate routing
the question to whoever can actually answer it (RULES §5.4).

### D-046 — `jamgate setup` supports the agent only if we can wire it losslessly

The setup wizard shipped wiring four clients (Claude Code, Claude Desktop, Cursor, Windsurf).
The obvious next move is "support every popular MCP agent." The constraint we held to instead:
**an agent ships only if (a) its exact config shape is verified against the vendor's own docs,
and (b) we can merge into its config file without a parser dependency and without destroying
what's already there.** Nothing unverified, nothing lossy.

Ten agents were researched against official sources. Six new ones cleared both bars and ship:
**Gemini CLI, VS Code (Copilot), Cline, Roo Code, OpenCode, Zed** — plus **Windsurf** gained
remote (its docs now cover Streamable HTTP via a `serverUrl` field). Every field name is
load-bearing and none of them agree:

- container key differs — `mcpServers` (most), `servers` (VS Code), `context_servers` (Zed),
  `mcp` (OpenCode);
- the remote transport tag differs even between siblings — Cline's `streamableHttp` (camelCase)
  vs Roo's `streamable-http` (hyphen), both forked from the same codebase;
- the remote URL field differs — `url` (most), `httpUrl` (Gemini; plain `url` is SSE there),
  `serverUrl` (Windsurf);
- OpenCode collapses `command`+`args` into one array and tags every entry `enabled`.

So each client carries an explicit `shape` and `containerKey`, and `buildEntry` emits the
documented form per shape. A wrong field is a silently-broken config, which is why these are
pinned by tests, not just written once.

Three agents were **rejected on bar (b)**: **Codex CLI** (TOML), **Goose** and **Continue**
(YAML). A lossless merge into a hand-commented TOML/YAML file needs a real parser — a new
runtime dependency and a new class of "we reformatted your file" bug. Not worth it for the
setup convenience; the README gives each a one-line manual snippet instead. We ship the
merge we can guarantee and point to the door for the rest.

One safety addition falls out of this. Three of the six (Gemini, OpenCode, Zed) keep MCP
servers inside a **shared** settings file — the user's whole editor/CLI config, often
`//`-commented. Our JSON reader can't parse comments, and the old "malformed → start fresh"
path would have rewritten that file down to just our entry. For `sharedConfig` clients the
runner now **refuses** to overwrite a file it can't parse as strict JSON, and skips with a
"configure manually" reason. A dedicated MCP-only file (Cursor, Cline, …) keeps the tolerant
behaviour, because there the backup already covers the only thing at risk.

### D-047 — A plain `setup` must not silently downgrade a remote wiring

Real UX finding from a live run. A user had wired Claude Code to his self-hosted server over
HTTP (`--remote`). Later he ran a plain `npx jamgate setup` (stdio is the default), and it
cheerfully "updated (stdio)" his entry — silently swapping the remote transport back to a local
`npx jamgate`, which points at a *different, empty* memory store. His memory looked like it had
vanished; really it had re-fragmented across two backends. The write was idempotent, backed up,
and touched only our own key — every D-030 safety guarantee held — and it was still wrong,
because "safe to overwrite our own entry" is not the same as "safe to change its transport".

The distinction that matters is **direction**:

- **remote entry, stdio run** — a *downgrade*. The plain default (no flags) can't know the user
  wanted to abandon their server; the overwhelmingly likely truth is they forgot to pass
  `--remote`. So the runner now **preserves** the existing entry and reports it
  (`• Claude Code — left as-is — currently remote …`) instead of writing. `--force` overrides
  for the genuine "yes, downgrade me" case.
- **stdio entry, `--remote` run** — an *upgrade*, and one the user is explicitly asking for by
  typing the flag. That stays automatic (`updated`); guarding it would just nag.
- **same transport** — unchanged: idempotent re-run or a normal in-place update.

The guard keys off the *shape already on disk* (`isRemoteEntry`: a `url`/`httpUrl`/`serverUrl`
field), not off what we remember writing, so it protects a hand-wired remote entry too. It is
strictly a refusal to write; it never edits the file, so no backup is spawned and idempotency is
untouched. The lesson generalises D-030: the safe unit isn't "our key" but "our key *and its
transport*" — changing how a client reaches its memory is as consequential as changing which
memories it sees.
