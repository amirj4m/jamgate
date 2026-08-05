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

### D-028 — *(unused number)*
Reserved during Phase 3 for a separate "fuzzy lexical relevance" entry and never written: the
fuzzy scorer shipped as part of D-026's recall work and is described there (D-026 mentions "the
fuzzy layer (D-028)"; that reference is the only trace). Nothing was decided under this number
and nothing was reversed — the gap is bookkeeping, not a missing decision. Left unused rather
than recycled, so that dangling reference still resolves to something truthful.

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

### D-032 — *(unused number)*
Reserved during Phase 7 (deploy templates) for a second entry alongside D-031 and never
written — the one decision that phase produced is D-031, which covers it. Nothing was decided
under this number and nothing was reversed; the gap is bookkeeping. Left unused rather than
recycled so that decision ids stay stable references forever, which is the only property that
makes citing one in a commit message worth anything.

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


### D-048 — Namespaces (scopes): one instance, many isolated memories

Jamgate began single-tenant: one human, one memory (D-029). An app built on top of it — a
tutor with several subjects, or one instance shared by a few people — needs to keep memories
that must not blend. We add an optional `scope` (an opaque label, e.g. `amir/greek`) to a
memory and to save/recall/forget. **Why a scope and not a second instance for every split:**
running an instance per subject multiplies deployment, tokens and TLS for what is really one
person's data; a scope is a field, and the whole gate already reads the memory list once.

The design is **additive and backward-compatible on purpose**, because this store is live:

- **The default scope is invisible.** An absent or empty `scope` normalizes to a single
  `"default"` namespace, which reproduces the exact pre-namespace behaviour. Every existing
  client keeps calling `save`/`recall`/`forget` unchanged and lands in `"default"`.
- **The gate is per scope.** Dedup, subject supersession, the source-trust conflict guard and
  the semantic near-duplicate check all compare a candidate only against memories in the SAME
  scope. Two namespaces can hold the same text, the same subject, even contradictory facts,
  without one touching the other. This is the whole point — isolation has to hold at the gate,
  not just at read time.
- **Recall and forget are strictly scoped.** Recall returns only the requested namespace;
  forget resolves an id (or prefix) only within its scope, so one namespace can never delete
  another's memory even with the exact id.
- **Migration, not a rewrite.** `schemaVersion` goes 2→3; on read, any record without a scope
  is stamped `"default"` (a record already carrying a named scope keeps it), and the upgraded
  shape persists on the next write — the same auto-migration pattern as D-021/D-023. No data
  loss, no behaviour change for the existing single-tenant store.
- **Tool schemas stay permissive.** `scope` is an optional property on all three MCP tools,
  added the same additive way as the `content`/`memory` aliases (D-039) — no `required` change,
  nothing existing breaks.

Scopes are only case/whitespace-folded (like a memory's `subject`), never otherwise parsed:
`user/role` is a convention, not a schema. Multi-USER separation (accounts, auth per person)
is deliberately still out of scope here (D-029 stands); a scope is a namespace within one
token-holder's instance, and whoever holds the token can address any scope.

### D-049 — A plain REST API alongside MCP

Jamgate speaks MCP, which is the right protocol for agents but the wrong one for an ordinary
app backend: a mobile tutor's server wants to `POST` a memory and `GET` a recall, not open a
JSON-RPC session and drive a tool call. So the HTTP mode (D-029) now also serves a small REST
API on the same server, behind the same bearer gate:

```
POST   /v1/memory        {text, scope?, type?, subject?, source?}  → save
GET    /v1/memory        ?query=&scope=&limit=                     → recall
DELETE /v1/memory/:id    ?scope=                                   → forget
```

Decisions that fell out of it:

- **Reuse everything, add nothing to the transport contract.** REST is handled inside the
  existing `--http` server, after the existing constant-time bearer check (static token OR an
  OAuth access token) and before the MCP path check. No new port, no new auth path, no change
  to the MCP transport or the OAuth flow. A missing/wrong token is the same flat 401.
- **The SAME gate, guaranteed.** Save on both surfaces funnels through one shared
  `saveThroughGate` (prefilter → subject → `store.save` → gate log), so a REST client gets
  identical dedup/supersession/conflict/secret-refusal behaviour, per scope (D-048). The MCP
  tool was refactored onto it too, so the two can never drift — the property is enforced by a
  test that a REST credential is refused exactly as the tool refuses it.
- **HTTP status mirrors the gate outcome.** `201` when a record actually landed (created or a
  recency supersede); `200` for outcomes that understood the request but stored nothing on
  purpose (duplicate/conflict/near-duplicate, and a prefilter `rejected` with its reason);
  `400` for a malformed request (bad JSON, missing `text`); `404`/`409` for a forget miss or
  an ambiguous id prefix. Errors are plain JSON with a stable `error` code — not JSON-RPC,
  which stays confined to the MCP endpoint.
- **Field aliases carry over.** `POST` accepts `text`, then `content`, then `memory` (D-039),
  so a client that mirrors the tool shape works without translation. There is no handshake over
  REST, so a REST save carries no server-observed client provenance (D-024) — that is inherent
  to the protocol, not a gap.

REST is a generic feature of any remote Jamgate, the same as the MCP transport — not bespoke to
one deployment.

### D-050 — A credential is a credential whichever way round the sentence runs

D-042 refuses a credential ASSIGNMENT by requiring the separator (`:`, `=`, `is`) to sit
immediately against the keyword. That adjacency is what lets "jam's password manager is
1Password" through — the head noun after `password` is `manager`, so the sentence is a fact
ABOUT passwords, not a password.

The 0.10.0 validation stress test found the gap the rule left open. These two sentences state
the same fact:

```
jam's mysql password is Tr0ub4dor-And-Three          → refused
the password for jam's mysql database is Tr0ub4dor-And-Three  → STORED
```

The second is the more natural English, and it walked into the shared memory verbatim — over
the MCP tool and the REST endpoint alike (they share one gate, D-049, so they shared the
hole). The entropy rule did not catch it either: the value scores 3.40 bits/char against a
3.5 floor, a near miss that is luck, not design.

**Decision:** the keyword may be separated from its separator by a bounded PREPOSITIONAL
phrase (`for`/`to`/`of`/`on`), and by nothing else. "the password **for X** is …" still has
`password` as its head noun; "password **manager** is …" does not, and `manager` is not a
preposition, so the precision-first line D-042 drew is preserved rather than traded away.
The value test is unchanged and still does the real work: "the password for the wifi is
**printed** on the router" and "my api key for openai is **in** the .env file" stay clean,
because their values read as prose, not as credentials.

**The general rule this encodes:** a gate rule that keys on sentence SHAPE must be tested
against the paraphrases of the same fact, not just the shape that prompted it. One phrasing
refused and its synonym stored is not a gate — it is a coin flip the caller cannot see.

### D-051 — An API answers in the envelope its caller speaks, and returns nothing it computes with

D-049 shipped the REST API with a documented contract: "Errors are plain JSON with a stable
`error` code — not JSON-RPC, which stays confined to the MCP endpoint." Validating 0.10.0
against a real HTTP client showed the contract was true for the errors REST itself produced
and false for the two it did not:

- **401** is produced by the shared auth gate, which runs BEFORE routing — so the single most
  common error on a token-gated API was the one response a REST client could not parse
  (`error` an object, no `message`, a `jsonrpc` field).
- **404 on an unrouted `/v1/` path** fell through to the MCP handler and answered a REST typo
  with "Not found. MCP endpoint is /mcp".

Both are now REST-shaped, chosen by path; the MCP endpoint's JSON-RPC errors are untouched.
The forget-miss and ambiguous-prefix bodies also gained the `message` field every other error
carries, and the miss now **names the scope it searched** — forget is strictly scoped (D-048),
so a scope mismatch is the likeliest cause and a message that never mentions scope sends the
caller off to re-check a perfectly good id.

The same pass removed the `embedding` vector from every REST response. A one-result recall was
8.4 KB, of which ~8 KB was 384 floats; five results shipped ~40 KB of numbers to say five
sentences. The vector is the input to near-duplicate detection and semantic recall — internal
machinery the client gets the *verdict* of, never the operand. It stays on disk and in
`export` (a backup that dropped embeddings would silently lose them on re-import).

**The general rule this encodes:** two rules, both about the boundary rather than the feature.
(1) When one server speaks two protocols, the ERROR path is where they leak into each other —
every response produced before routing or after it fails must still pick its shape by caller,
because that is exactly where the handler that knows the protocol is not in the stack.
(2) A public response is a projection of the internal record, never the record itself; ship
what the caller can act on.

### D-052 — One subject convention: lowercase and hyphenated, with the separators folded

Two documents disagreed about how to spell a subject, and because subject equality is what
drives supersession (RULES §2.3), the disagreement was not cosmetic — it produced exactly the
outcome RULES §10 forbids.

`skills/memory-discipline/SKILL.md` §3 told agents to pass **dotted** subjects
(`editor.theme`, `location.city`). `deriveSubject` emits **hyphenated** ones
(`operating-system`, `location`), as do the `save_memory` tool description, the README, and
D-027 / D-036 / D-040. Validating 0.10.0 walked the two conventions into each other:

```
save_memory { text: "jam lives in Athens, Greece" }                          → subject "location"   (derived)
save_memory { text: "jam lives in Rotterdam", subject: "location.city" }     → subject "location.city"
recall → BOTH still active. Two live, contradicting answers to "where does jam live".
```

**Decision — hyphenated is the convention.** Not by taste: it is what the code emits, what the
tool advertises, and what is already on disk in every existing store, including production.
Switching the code to dots would orphan every stored subject and silently break supersession
for the entire existing memory. SKILL.md was the outlier and is now corrected (and gained the
`scope` guidance it never had, which 0.10.0 made necessary).

**And the separators fold.** `.`, `_` and whitespace all normalize to `-` at the one boundary
every save passes through, and stored subjects are canonicalized on READ as well as on write —
so a legacy record spelled `location.city` is still retired by a `location-city` candidate,
with no migration and no rewrite of existing data.

The fold deliberately stops there: `location.city` still does not equal `location`. Those are
different subjects under any convention, and inferring that one subsumes the other is the
wrong-supersession risk D-027 exists to refuse — a bad guess retires a fact the user never
asked to retire.

**The general rule this encodes:** when a value is a JOIN KEY, its spelling is part of the
schema, not documentation. Exactly one document may define it, everything else cites that
one, and the code normalizes at a single boundary so a caller's spelling cannot fork the data.

### D-053 — A path-scoped reverse proxy is part of the release, not part of the server

Jamgate binds to localhost and a reverse proxy is the only public door (D-029). Caddy's
`reverse_proxy` forwards the whole host, so adding a surface to Jamgate makes it public
automatically. **nginx does not.** It forwards only the paths named in a `location` block, so
every new surface needs a matching block, and a missing one fails in the worst way available:
nginx answers its own 404 and the request never reaches Jamgate at all.

Verified against a live path-scoped deployment while validating 0.10.0:

```
GET /healthz     → 200  {"status":"ok",…}          (proxied)
GET /mcp         → 401  from Jamgate               (proxied)
GET /v1/memory   → 404  text/html, Server: nginx   (NOT proxied — the REST API is unreachable)
```

The REST API (D-049) shipped in 0.10.0 and works perfectly in-process; on that host it is
simply not routed. A REST client cannot tell "this server has no REST API" from "your proxy
does not forward it", because it never gets to talk to the server that would say so.

**Decision:** the required `location` blocks — `/mcp`, `/v1/`, the OAuth paths, `/healthz` —
are documented in the README's remote-mode section as part of the deploy, together with the
one-line check that distinguishes the two failures:

```bash
curl -si https://your-domain/v1/memory | head -1   # 401 = reaching Jamgate; 404 = proxy gap
```

The alternative — making the server detect it is behind a partial proxy — is not available:
a request that never arrives cannot be observed. So it belongs in the deploy checklist.

**The general rule this encodes:** when a component's public surface is enumerated somewhere
OUTSIDE the component, adding to that surface is a two-place change, and the second place must
be written down where the deploy happens. Shipping a feature is not the same as exposing it,
and the gap between them is invisible from the inside.

### D-054 — A schema declared to the model is not enforcement

`save_memory`'s `inputSchema` has always declared
`type: { enum: ["identity","project","preference","state"] }`. That enum is a hint the model
usually follows; it is not a constraint the server applies. The handler did
`args.type ? String(args.type) : undefined` and the pipeline cast the result to `MemoryType`,
so any string a caller sent went to the store unchallenged. TypeScript did not help — the
union is erased at runtime, and the cast is precisely where it was erased.

The consequence was not cosmetic. `type` is what `computeExpiresAt` reads to assign a
lifespan, and it returns `undefined` for a type it does not recognize — which the store
records as **never expires**. So a typo did not fail; it silently promoted a two-day memory to
a permanent one.

Found by auditing the REAL production store, not by the test suite:

```
a74458fb  type="profile"  expiresAt=<none>  "[profile+career] jam lives in Athens, Greece …"
```

Every synthetic test passed a valid type, so nothing exercised the path. That is the real
lesson here — a suite that only ever sends well-formed values cannot discover that
well-formedness was never checked.

**Decision:** `MEMORY_TYPES` and `MEMORY_SOURCES` exist as runtime data with `isMemoryType` /
`isMemorySource` guards, and `saveThroughGate` validates both before the prefilter runs. An
unknown value is an `invalid_argument` outcome — a distinct third kind, separate from a gate
`rejected` — so the MCP tool answers `isError` and REST answers `400`, and neither is logged
as a gate decision. That is D-037's line: a usage error is not a verdict about the memory.
Both transports get it from the one shared pipeline, so they cannot drift (D-049).

**The general rule this encodes:** any enum the STORE's behaviour depends on must be validated
in code at the boundary. A schema published to a model, a TypeScript union, and a doc comment
are three kinds of documentation; none of them is a check. And when the enum decides a
lifespan, the failure mode of not checking is silent data retention, not a loud error.

### D-055 — A memory that is unreachable must be findable, and an explicit save must never go dark quietly

Soft expiry (D-021) hides a stale record from recall and keeps it on disk for a grace window.
That is the right mechanism. What was wrong is that it operated in complete silence — nothing
in the save reply, the gate log, recall, or any command reported that a record had gone.

Auditing the real production store measured the cost:

```
39 active records, 17 of them EXPIRED and invisible to recall  → 44% of the live memory
   all type "state" (2-day TTL);  12 of the 17 were source "user-explicit"
   one session, 2026-07-25 18:25–18:36: eFood pay structure, income by period, payment
   reconciliations, bank card, subscriptions, e-ΕΦΚΑ registration, housing search, …
```

A human said "remember this", claude.ai filed it as `state`, and forty-eight hours later it
was unreachable. No warning was possible to notice, because none existed anywhere.

Two decisions, and deliberately not a third:

- **Warn, do not override.** When a save is human-sourced (`user-explicit` / `user-confirmed`)
  AND lands a lifespan of a week or less, the save happens exactly as asked and the reply
  carries the expiry date plus how to make it durable. Refusing the combination would be wrong
  — a short-lived fact explicitly given is legitimate ("jam is between apartments this week")
  — and silently promoting it to a durable type would be worse: it overrides a caller that may
  have meant precisely what it said. The caller has the conversation; give it the fact and let
  it decide, which is the same hand-off D-045 makes. Agent-inferred state notes do not warn;
  warning on every one would train callers to ignore the warning.
- **Make expiry discoverable.** `store.listExpired(scope)` (an OPTIONAL adapter capability, so
  a backend without TTL is unaffected), surfaced three ways: `jamgate expired` lists them with
  the date compaction may delete each one, `recall_memory` appends the hidden count — including
  on an empty result, where "nothing is stored" and "everything aged out" otherwise look
  identical — and `GET /v1/memory?expired=1` returns them, with `expiredHidden` on ordinary
  recalls.
- **Not changed: the TTL values themselves.** `state` = 2 days is right for what `state`
  means (RULES §4). The failure was a caller choosing the wrong type and nobody noticing;
  lengthening the window would hide that class of mistake rather than surface it.

**The general rule this encodes:** any mechanism that makes data unreachable without deleting
it owes the user a way to enumerate what it has hidden. "Soft delete" with no listing is
indistinguishable from data loss from every angle a user can actually look from.

### D-056 — A training corpus that records only acceptances teaches the wrong thing

D-025 established the gate log as a local, labelled record of every gate decision, existing
specifically to train the thin classifier (D-004) on real usage instead of guesses. It logged
`saved`, `duplicate`, `superseded`, `conflict`, `possible_duplicate` and `rejected`.

It did not log `forget`. `appendGateLog` was called only from the save pipeline, so a deletion
— the single strongest signal a user can give that a memory should not have been kept — left
no trace at all.

Two consequences, both real:

1. **The corpus is biased toward keeping.** Every memory that got in is a positive example
   forever, including the ones the user threw out an hour later. A classifier trained on that
   file learns what passed the prefilter, not what was worth keeping.
2. **The log cannot be reconciled with the store.** Auditing production, 24 of 66 write
   decisions had no surviving record and the log offered no explanation for a single one. Each
   had to be attributed by hand. An audit trail that cannot account for the difference between
   what it recorded and what exists is not an audit trail.

**Decision:** deletes go through `forgetThroughGate`, the mirror of `saveThroughGate`, used by
both transports — one `forgotten` decision carrying the deleted record's own text, type,
subject, source, scope and client. `FileStore.forget` now hands the deleted record back (an
additive, optional field on `ForgetResult`) so the log entry needs no second read.

Only a SUCCESSFUL delete is logged. A not-found or ambiguous id is a usage error about an
identifier, not a decision about a memory — the same line D-037 and D-054 draw.

**The general rule this encodes:** if a log exists to be learned from, it has to record the
reversals, not just the commits. Any event that undoes a logged decision is itself a decision,
and the more informative one — corrections are where the signal is.

### D-057 — An expired memory may be replaced, but it must never block

Soft expiry (D-021) leaves a record at `status: "active"` and merely hides it from recall. The
duplicate and near-duplicate checks filtered on `status === "active"` alone, so they counted
hidden records as live — and refused the exact save that would have brought the fact back:

```
recall("")                                   → 0 records   (expired, hidden)
save(same text, durable type, same subject)  → "duplicate" (already known)
recall("")                                   → 0 records   (still hidden)
```

Two answers that cannot both be acted on. The caller is told the memory is already known; the
user is told nothing is stored; there is no third call that resolves it. A fact could go dark
and then be permanently un-restorable *because it had gone dark*.

Found by trying to restore the ten expired production records. Every one came back
`duplicate`, and nothing could be revived — the audit's remedy was blocked by the same class of
bug the audit was about.

**Decision:** an expired record is excluded from the exact-duplicate check and from the
semantic near-duplicate check. It is deliberately still visible to **subject supersession** —
re-asserting a fact on the same subject SHOULD retire the stale copy rather than sit beside
it, which is what turns a re-save into a revival (`superseded`, old retired for audit) instead
of a second copy. Live records still dedup exactly as before (RULES §2.2 is untouched);
"already known" now means "already known **and currently recallable**", which is the only
reading a caller can act on.

**The general rule this encodes:** a record hidden from reads must not still be enforcing
writes. When a mechanism makes data invisible, every check that consults that data has to
agree about what invisible means — otherwise the system holds two contradictory beliefs about
the same record and hands the user whichever one is least useful.

### D-060 — Documentation never lags the work, and every change ships

A standing rule from the maintainer, with the same weight as the golden rules in AGENTS.md,
written into `RULES.md` §8 rather than left as a decision entry alone — a rule nobody reads at
the top of a session is not a rule.

**A change is finished when it is released, not when it compiles.** For any change, however
small: commit it → update `CHANGELOG.md` and every doc it makes untrue, in the same session →
bump `package.json`, `src/version.ts` and `server.json` together → tag → publish → cut the
GitHub Release with the `.mcpb`.

The evidence for why is this project's own history, all of it found on 2026-08-05:

- **0.10.0 sat on `master` for thirteen days, tagged nowhere and published nowhere**, while npm
  `latest` served 0.9.2 and its own README told every new Claude Desktop user to download the
  bundle from "the latest release" — which was **v0.5.0**, five versions and one architecture
  behind. The link was not broken by a bug; it was broken by not shipping.
- **GitHub Releases stopped at v0.5.0.** Eleven tagged versions had no release at all.
- **`server.json` sat at `0.1.0` while the package was `0.10.0`** — nine releases stale, because
  nothing in a normal build or test run ever read it.
- **`MEMORY.md`'s "What's next" was seven phases out of date**, still listing TTL, atomic writes
  and auto-subject as pending, all of which had shipped in Phase 2/3.
- **The `memory-discipline` skill told agents to use dotted subjects** long after the gate had
  settled on hyphenated ones — and because subject equality drives supersession, that stale
  doc actively corrupted data (D-052).

That last one is the point. Stale documentation is not cosmetic debt: in a system whose
behaviour is *specified* to callers through documentation, a doc that lags the code is a
defect that produces wrong data. The README lying about the bundle cost every new user; the
skill lying about subjects cost the maintainer contradictory memories about where he lives.

**The general rule this encodes:** shipping is part of the change, not a separate later
activity. A patch release is cheap; an unshipped `master` and a doc that contradicts the code
are not — and both get more expensive the longer they sit.

### D-061 — A bulk import makes real gate decisions, so it must leave real log lines

D-033 established that `import` replays every record through the same quality gate a live save
uses — it never blind-appends. That is true, and it is the whole reason import is safe. But
`importBatch` calls the gate directly under one lock for the whole batch, and the gate-log
append lives in `saveThroughGate`, which import does not travel through. So an import made
genuine verdicts — created, superseded, duplicate, conflict, near-duplicate — and recorded not
one of them.

Found while merging a laptop store onto a server: nine records were imported, the report
printed `imported: 9 (9 new)`, and the decision log did not move a single line.

This is D-056's problem again from the other direction. That entry fixed deletes so the
corpus would carry reversals; this one fixes bulk writes so the corpus carries the decisions
that *created* a large part of the store. A classifier trained on a log that is missing every
migrated record learns from a biased sample of how memories actually arrive — and migration is
exactly how a store gets its history.

**Decision:** `importCommand` appends one gate-log entry per outcome, tagged
`reason: "imported"` so a bulk write is distinguishable from an interactive one when the
corpus is later analysed. A `--dry-run` logs nothing: a preview decides nothing.

**The general rule this encodes:** when a code path is factored out to be reused, audit what
was left behind at the old call site. Import reused the gate — the valuable part — and
silently dropped the observability that had been wrapped around it. Reuse moves the logic,
not the cross-cutting concerns that surrounded it.

### D-062 — Which artifacts are release-bound, and why that is the boundary (refines D-060)

D-060 said *every* change ships. That was right in spirit and ambiguous in letter: it left
open whether a session note in `MEMORY.md` — internal project state that no user ever
consumes — obliges a version bump and a release. The first time the question came up it was
settled by judgment, and a rule settled by judgment is one the next contributor settles the
other way.

So the boundary is now written down, together with the reason, so it can be **derived** rather
than looked up.

**The reason.** This rule protects a user from consuming an artifact that **lies about
itself**. Every incident behind D-060 is that failure: a README pointing at a `.mcpb` five
versions old, a `server.json` telling the registry to install a version that was never
published, a skill file instructing agents to write subjects in a convention the gate had
abandoned — which silently produced contradictory memories (D-052).

**The test**, for any file: *can a user consume this and be misled about what they are getting
or how to use it?*

- **Yes → release-bound.** `src/**`, `package.json`, `src/version.ts`, `server.json`,
  `README.md`, `CHANGELOG.md`, `skills/**`, the `.mcpb` bundle, and the workflows that build
  and publish them. A change to any of these is not finished until it is tagged, published and
  released.
- **No → internal state.** `MEMORY.md`, `DECISIONS.md`, `docs/**`, session notes. Nobody
  installs these and no agent acts on them to use the product. They are held to the same
  discipline and the same immediacy — written in the same session as the work, never left
  describing a state that has passed — but they do not trigger a release on their own.
- **Both → it ships.** The release-bound half decides.

Cutting a release for a session note is not extra rigour; it is cargo-culting the rule while
missing what it is for.

**The general rule this encodes:** a rule stated without its purpose can only be obeyed
literally, and literal obedience fails at exactly the edge cases the rule was written for.
State the reason, and the boundary becomes something a reader can work out for a case nobody
anticipated.

### D-063 — The semantic layer was tuned on estimates, and the README advertised the failure

`DEFAULT_SEMANTIC_MIN = 0.5` and the recall blend `0.6·semantic + 0.4·lexical` were both set
from plausible-sounding estimates ("true synonyms land around 0.6–0.8"). Neither was ever
measured against the model actually shipped. Both were wrong, and the README's own worked
example — *"so 'automobile' recalls a memory about your car"* — was one of the things that
did not work. The first thing a curious stranger would type was the one case we had
documented and broken.

**What was measured.** all-MiniLM-L6-v2, the model Jamgate downloads, over jam's real store
(12 memories, median 501 characters) plus the short facts that really passed the gate,
against 17 recall queries and 6 deliberately off-topic controls, all written before any score
was seen.

*The floor.* Pure-synonym pairs — no shared word, so the lexical scorer contributes 0.000 and
this floor is the only way in:

| similarity | query ~ memory |
| --- | --- |
| 0.742 | "what vehicle does jam own" ~ "jam drives a Toyota Corolla" |
| 0.695 | "what distro is on jam's laptop" ~ "jam uses Linux" |
| 0.642 | "does jam owe anyone money" ~ (the debts-settled memory) |
| 0.507 | "attorney fees" ~ (the lawyer-cost memory) |
| 0.464 | "policy on third-party libraries" ~ (the no-dependencies memory) |
| **0.422** | **"automobile" ~ "jam drives a Toyota Corolla"** — the README's own example |

Across 102 unrelated pairs (the off-topic queries against every memory) the highest
similarity **any** of them reached was 0.204. So unlike the near-duplicate bar in D-045,
these two populations *do* separate, and the gap is wide: 0.204 to 0.422 with nothing in it.
The floor moves to **0.35**, inside that gap. 0.5 sat above six of the seven true positives.

Why this separates when D-045's did not: a query is a different kind of object from a memory.
"Unrelated to the question" is a cleaner judgment than "restated versus changed" — the latter
compares two memories that are *about the same thing* by construction, which is exactly the
region where cosine carries no information.

*The blend, which turned out to be the bigger defect.* Ranking the same 17 queries:

| weights | top-1 | top-5 |
| --- | --- | --- |
| 0.6 semantic / 0.4 lexical | 6/17 | 14/17 | ← what shipped |
| 0.5 / 0.5 | 7/17 | 13/17 |
| 0.4 / 0.6 | 9/17 | 13/17 |
| **0.3 / 0.7** | **10/17** | **13/17** | ← now |
| 0.2 / 0.8 | 10/17 | 13/17 |
| embeddings off | 8/17 | 11/17 |

**Turning the semantic layer on made recall rank worse than not having it at all** — 6/17
against 8/17 at rank 1. Installing the optional dependency actively degraded the product, and
nothing would have revealed that except measuring it. The cause is mean pooling: a three-word
query against a 500-character memory dilutes to a middling cosine, while two *short* facts
that merely share a surface shape score high. "where does jam live" scored **0.645** against
the unrelated "jam started jamgate" but only **0.414** against "Lives in Berlin". At weight
0.6 that noise outvoted a lexical scorer holding the right answer.

So lexical leads and semantic assists, at 0.3/0.7 — the only setting measured that beats pure
fuzzy on *both* metrics, and four top-1 answers better than what shipped. 0.2 ties it; 0.3 is
where top-1 saturates, so it keeps the most synonym reach for the same measured ranking.

**Honest limits of this measurement.** One user's store, 17 queries, written by the person who
then read the results. It is enough to reject 0.5 and a semantic-led blend — those fail on
their own documented example — and enough to prefer 0.35/0.3-0.7. It is not enough to claim
these are optimal. The numbers are in `src/embeddings/vector.ts` and asserted in
`test/vector.test.ts` so the next person can move them with better evidence rather than a
better guess.

**The general rule this encodes:** a threshold with a confident comment and no measurement is
a guess wearing a lab coat, and the comment is what stops anyone from checking. When a number
decides whether a feature fires at all, the cost of measuring it once is an afternoon and the
cost of not measuring it is shipping a documented example that does not run.

### D-064 — The first five minutes had never been tested by anyone but the maintainer

Jamgate had shipped seventeen releases, supported ten agents, and been installed exactly once
— on the machine that built it, with a warm npm cache, an existing config, and the author
present to interpret anything odd. So the whole first-run path was untested in the only
condition that matters for a launch: a stranger, cold.

It was tested properly before going public — a fresh `HOME`, an empty npm cache, no
`~/.jamgate`, no client config, installing the **published** package rather than the local
build, on Node 18 as well as 22. Most of it held up, and the parts that did not were not in
the gate at all.

**What held.** The install path is genuinely solid, and this is worth recording because it is
where the risk was assumed to be: `--dry-run` wrote nothing; setup wired five simulated
clients in exactly the entry shapes the README documents; a pre-existing `github` server in
VS Code's `mcp.json` survived untouched and a backup was written; a `//`-commented Zed
`settings.json` was correctly refused rather than clobbered; a second run changed zero bytes;
`jamgate status` reported the truth. Crucially, an MCP client spawning `npx jamgate` on a
**completely empty npm cache** completes the handshake — npm installs without prompting when
stdin is not a TTY, so the obvious cold-start hang does not happen. And the server ran
correctly on Node 18 (stdio and HTTP) despite `engines` demanding 20+.

**What did not.** Three failures, all in the same place: the product answered machines
correctly and humans not at all.

1. **`jamgate --help` started an MCP server.** `--help`, `-h`, `--version` and `-v` all fell
   through to the default branch, which opens a stdio transport, prints one line to stderr and
   waits forever for JSON-RPC. The single most likely first command a person types produced
   what looks exactly like a hang. Every *sub*command had its own `--help`; only the front
   door did not. A mistyped subcommand (`jamgate setpu`) did the same thing.

2. **`setup` told a user with no MCP client to "restart your client(s)".** On a machine where
   nothing was detected, it printed ten "not found" lines and then instructed the user to
   restart software they do not have. This is not an exotic case — a client that has been
   installed but never launched has written no config yet, so it is invisible to detection.
   The one user who most needs to be told what to do next was told the least useful thing
   available.

3. **The normal install logged what looked like an error, on every startup.** With the
   optional embedding package absent — which is the default, and correct — the loader printed
   a three-line diagnostic naming a missing package and a file path under the word "cause:".
   Users read that in their client's MCP log and conclude the server is broken, for a feature
   they never asked for. It now prints one calm line saying semantic recall is off, how to turn
   it on, and that nothing is broken. The loud diagnostic is reserved for the case that is
   actually a fault: the package installed but failing to load.

**The general rule this encodes:** a maintainer cannot find these bugs by using their own
product, because the maintainer never runs `--help` on software they wrote, never has an
empty config, and reads a stack trace in a log as information rather than as alarm. The
first-run path has to be *simulated adversarially* — new HOME, cold cache, published artifact,
no client installed, and a wrong command typed on purpose — or it ships untested. Note where
the three defects landed: not one was in the gate, the part that had 463 tests. They were all
in the thin layer between a person and the product, which had none.

### D-065 — What a stranger finds in the first ten minutes that a maintainer never does

D-064 tested the first-run *path*. This is what turned up when the running product was probed
the way a skeptic probes it: in a language other than English, with malformed arguments, with
absurd input, and with a broken file on disk. Four findings, one of them serious.

**1. Recall did not work in any non-Latin script. At all.** The tokenizer split on
`/[^a-z0-9]+/`, which does not ignore non-ASCII text — it deletes it. A Persian, Greek,
Cyrillic, Arabic, Hebrew, Chinese or Japanese memory tokenized to *nothing*, so it could never
be recalled by any query, not even by pasting a word straight out of its own text. Accented
Latin was mangled the same way: "café" became "caf", "Müller" became "m" and "ller".

The damning part is where this was found. **The store it was found on already contained
Persian memories** — saved by the maintainer, through the real gate, months earlier. They had
been unrecallable from the moment they were written, and nobody noticed, because the person
testing recall always tested it in English. A save that reports `Saved:` and then cannot be
found again is worse than a rejection: the product lies, quietly, in a way only a user of that
language ever sees.

Fixed by tokenizing on `\p{L}\p{N}` with diacritic folding, plus per-character segmentation
for Han/Hiragana/Katakana (which have no spaces, so a sentence arrived as one token and the
trigram scorer could not reach inside it). Ten languages are now asserted in the test suite —
each with words taken literally out of the memory *and* an unrelated word that must not match,
so a tokenizer that matches everything cannot pass. English tokenization is byte-identical.

**2. There was no upper bound on a memory.** A 200 KB save was accepted in silence. Not
hypothetical: an agent that means to save a fact about a file can pass the file, and the cost
lands on the store (read whole on every operation), the decision log, and the embedding (which
mean-pools it into noise). Now capped at 32 KB — roughly eighteen times the largest memory
ever saved through a live agent — with a rejection that says to save the conclusion instead,
and with the oversized body kept out of the log.

**3. A corrupt store produced an unusable error.** Every save and recall failed with a bare
`Expected property name or '}' in JSON at position 2` relayed through MCP: no file path, no
cause, no next step, and no word about whether the user's memories still existed. That is the
message someone reads at the worst possible moment. It now names the file, names the cause,
states plainly that nothing was modified or deleted, and says what to do — and a test asserts
the file really is left byte-identical, because the reassurance has to be true. Permission
errors get the same treatment instead of a bare `EACCES`.

**4. The gate refused Chinese and Japanese outright — and the recall fix alone did nothing.**
Fixing the tokenizer made the *scorer* multilingual, and the end-to-end test still failed for
those two languages, because they never reached the scorer: the junk filter rejects text with
"fewer than two meaningful words", and it counted words by splitting on spaces. A Chinese
sentence has none, so every such save was refused as "not a statement". The gate and the
scorer disagreed about where words are; they now share one splitter, which is the only way
that class of bug stays fixed. This is precisely what RULES §9 exists to catch — a unit-level
fix that passes while the product still does not work.

**5. The English model was silently deciding non-English recall.** With that fixed, the
end-to-end test failed a third way: the query "自転車" (bicycle) returned a Chinese memory
about coffee, and "bicycle" in Greek returned a Greek memory about studying Greek. Measured
against the bundled all-MiniLM-L6-v2 — an **English** model — its similarity on other scripts
degenerates into a score for *"is this the same script"*:

| similarity | query ~ memory |
| --- | --- |
| 0.62 | "ποδήλατο" (bicycle) ~ a Greek memory about studying Greek in Athens |
| 0.46 | "自転車" (bicycle) ~ a Chinese memory about coffee and languages |
| 0.42 | "دوچرخه" (bicycle) ~ a Persian memory about Greek and Linux |
| 0.27 | "コーヒー" (coffee) ~ a Chinese memory that IS partly about coffee |

Every bicycle is unrelated, every one clears the 0.35 floor, and each outscores the true
coffee match. So installing the optional package gave a non-English user recall driven by
"is it in my language" — and it landed on top of the lexical recall that had just been fixed,
burying it. Non-Latin text is no longer embedded at all: no vector stored, no semantic score,
straight to the lexical path that actually works in those scripts. This is a limit of the
bundled model, not of embeddings; a multilingual model behind the same `Embedder` interface
would lift it, and that is now the concrete reason to want one.

**6. What held.** Malformed tool arguments were already handled well: `text` as an object, a
number, null, or missing all produce a precise error naming what arrived; path traversal in an
id or a scope resolves to nothing; a negative or absurd `limit` is harmless; a corrupt store is
never overwritten. Recall returns memories verbatim, which is inherent to memory systems and
is now stated in the README's honest limits rather than left for a reader to discover and post
about.

**The general rule this encodes:** the bugs a maintainer cannot find are the ones behind an
assumption so basic it never gets stated — here, "text is ASCII". Note how many layers the one
assumption had quietly infected: the recall tokenizer, the junk filter's word count, and the
choice of embedding model. Fixing the first two still left the product broken, and only an
end-to-end run in each language showed it. Every test in the suite was
written in English by someone who thinks in English, so a whole class of user got a product
that silently did nothing, on a codebase with 470 passing tests. When testing your own work,
the question is not "does it work?" but "what did I assume about the input?" — and then supply
the opposite.
