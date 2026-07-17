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
