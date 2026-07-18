# MEMORY.md — Jamgate

Current state of the project. Update this at the end of every work session.

## Where we are right now
- **Phase: name locked (Jamgate, D-017); MVP skeleton scaffolded.**
- Code skeleton present: `package.json`, `tsconfig.json`, `.gitignore`, and `src/`
  (`index.ts` MCP server over stdio; `store/fileStore.ts` flat-JSON store with
  save/recall/forget + exact-dup dedup + timestamps; `gate/prefilter.ts` cheap rule
  pre-filter). Compiles clean with `tsc`; 7/7 logic smoke-tests pass (junk rejected,
  real fact kept, dedup, recall, forget).
- **Installed + built on the user's machine** (2026-06-19): `npm install` (94 pkgs,
  `package-lock.json` committed-pending) and `npm run build` ran into `~/Documents/
  jamgate`; `dist/` present. **Real MCP protocol test PASSED** via an SDK stdio client:
  tools listed (save/recall/forget), a real fact saved, junk ("ok") rejected, recall
  returned the fact.
- **Time-aware supersession DONE (D-015, §2.3):** memories carry a `subject`, `status`
  (active/superseded), and supersededBy/At. A newer memory with the same subject
  retires the older by recency (kept for audit, not deleted); recall returns active
  only. Verified end-to-end over MCP — "jam uses Windows" → "jam moved to Linux"
  retires Windows and recall shows only Linux. 6/6 store checks pass (create, exact-dup
  blocked, supersede, active-only recall, history kept, forget).
- NOT yet: genuine simultaneous-contradiction detection (flag/ask) and auto-deriving
  `subject` without the agent passing it — both need the thin classifier/embeddings
  (later). The §9 test against the user's *own* live agent still needs the user to wire
  the MCP config and click through.
- We spent a long session defining the concept, architecture, and rules. All of it is
  captured in `AGENTS.md`, `RULES.md`, and `DECISIONS.md`.
- These six files (`AGENTS.md`, `CLAUDE.md`, `RULES.md`, `DECISIONS.md`, `MEMORY.md`,
  `README.md`) were written by hand to carry the project from Windows → Linux.

## What's decided (see DECISIONS.md for why)
- It's a **quality gate**, not a store. Neutral, store-agnostic. Impact, not profit.
- Hybrid write pipeline; never screen-scrape; write at checkpoints.
- Stack: TypeScript + Node + MCP SDK; default store SQLite/file; local-first MVP.
- v1 = MCP surfaces (Claude Code / Cowork / Cursor); web chatbots phase 2.
- AGENTS.md is canonical; symlink CLAUDE.md / GEMINI.md to it on Linux.

## What's next
Steps 1–4 of the original build plan are done (name chosen, repo scaffolded, MCP server
standing, verified against a real agent). Remaining:
1. Finish the gate layers: expiry/TTL → thin classifier for ambiguous cases.
   (dedup, supersession, and the trust-based conflict guard are done.)
2. Derive `subject` automatically instead of relying on the calling agent to pass it.
3. Atomic writes for the file store.
4. Multi-device sync (D-018).

## Open items
- Embedding model choice (local vs API) for dedup/recall — decide at step 5.
- Exact threshold/scoring for the "worth keeping" criterion — tune with real data.

## Migration note (Windows → Linux)
These files are plain text. The portability mechanism is **git**: commit them, push,
then `git clone` on Linux and everything (rules + state) comes with it. On Linux,
`ln -s AGENTS.md CLAUDE.md` so one file serves every agent.

## Update — 2026-07-18 (Phase 4: distribution)
Phase 4 goal met (all but the two auth-gated steps): **anyone in the world can install with
one command.** Repo, README, CHANGELOG, release, and registry manifest are all shipped;
only the two steps that need interactive login (npm publish, MCP Registry publish) remain,
and this session is non-interactive so they're handed off. Master + tag CI both green.
- **Package (v0.1.0):** bumped 0.0.1 → 0.1.0 (first real minor). npm name `jamgate` is
  FREE (verified `npm view` 404) — no scope fallback needed. Added keywords (mcp,
  model-context-protocol, memory, ai-agents, quality-gate, claude, cursor, local-first,
  embeddings, llm), author, repository/homepage/bugs URLs, `files` whitelist (dist, README,
  LICENSE), and `prepublishOnly: npm run build` (dist/ is gitignored so the tarball must
  build fresh). `bin.jamgate → dist/index.js` (shebang present; npm sets +x on install —
  verified by installing the packed tarball into a temp project and booting it over stdio,
  all 3 tools listed). Synced hardcoded serverInfo version to 0.1.0. `npm pack` = 15 files,
  ~24 kB, no test/doc internals.
- **README overhaul (storefront):** npx one-liner (`claude mcp add jamgate -- npx jamgate`),
  before/after gate ASCII, gate-layer table, Claude Code/Desktop/Cursor config blocks,
  optional-embeddings section, env-var table, honest comparison vs Mem0/OpenMemory &
  Zep/Graphiti (their strengths acknowledged), privacy section, CI/npm/license badges.
- **CHANGELOG.md:** Keep-a-Changelog, 0.1.0 entry summarizing Phases 1–3.
- **Lock hardening (fix, folded into 0.1.0):** the write lock's acquisition `timeoutMs`
  (was 10s) could fire while a live holder was mid-write on a loaded box → waiter proceeded
  WITHOUT the lock → dropped save. Surfaced as a rare CI flake in the concurrency test
  (passed on master, flaked on the tag run, same commit). Fix: align `timeoutMs` with
  `staleMs` (both 30s) so a waiter only reaches the give-up branch after the lock is
  stealable-as-stale (stale-steal happens first) → never clobbers a live holder. 89 tests
  still green; stressed 20× locally, 0 fails.
- **Released:** tag `v0.1.0` (moved to include the lock fix since npm publish hadn't
  happened) + GitHub Release with CHANGELOG-derived notes.
- **MCP Registry manifest:** added `server.json` (name `io.github.amirj4m/jamgate`, npm
  package `jamgate`, stdio) + `mcpName` in package.json. Registry is now the source of
  truth (feeds PulseMCP crawl; the modelcontextprotocol/servers README community list is
  RETIRED). server.json is NOT in the npm tarball (kept out of `files`).
- **PENDING (auth-gated, handed off to the user):**
  - `npm login && npm publish` — not authenticated here (`npm whoami` → ENEEDAUTH).
  - MCP Registry publish — needs interactive `mcp-publisher login github` (device OAuth).
  - mcpservers.org — web form at https://mcpservers.org/submit (Category: Memory), NOT a PR.
  - PulseMCP — auto-crawls the registry/npm; claim the listing once it appears.
  - Auto-publish CI workflow — SKIPPED on purpose: no `NPM_TOKEN` repo secret exists
    (`gh secret list` empty); did not create a workflow that would fail on every tag.
- **Still open (post-4):** thin classifier; embedding-quality tuning; multi-device sync
  (D-018); HTTP/remote transport.

## Update — 2026-07-17 (Phase 3: intelligence)
Phase 3 goal met: **the gate moves from exact-match rules toward semantic understanding,
without giving up local-first or the zero-config install.** Five items, each its own
commit, all covered by tests, CI green on Node 20.x/22.x. Verified end-to-end over stdio
MCP (real handshake).
- **Client provenance (D-024):** each memory carries an optional `client` {name,version}
  captured server-side from the MCP `initialize` handshake (`server.getClientVersion()`),
  not spoofable via tool args. `index.ts` refactored into a testable
  `createServer(store, gateLog?)` factory guarded from the stdio bootstrap.
- **Fuzzy recall (D-028 in code; no D-entry — folded into item):** new
  `src/gate/relevance.ts`. Deterministic, dependency-free: stemming-lite + stopword-aware
  weighted token overlap + trigram Dice, with a fuzzy-token floor (0.4) and recall floor
  (`MIN_RELEVANCE` 0.1). Replaced the old substring `overlapScore`. Beats plain overlap on
  plurals/typos; synonym-blind by design.
- **Gate decision log (D-025):** new `src/gate/log.ts`. Appends every decision (saved/
  duplicate/superseded/conflict/possible_duplicate/rejected + reason/type/subject/source/
  client/text) as JSONL to `~/.jamgate/gate.log`. STRICTLY LOCAL; size-capped w/ rotation
  to `.1`; text truncated; `JAMGATE_GATE_LOG=off`. Best-effort, never breaks a save.
  Training buffer for the future thin classifier (D-004).
- **Optional local embeddings (D-026):** `src/embeddings/{vector,embedder}.ts`.
  `@huggingface/transformers` (all-MiniLM-L6-v2, 384-dim) as an OPTIONAL peerDependency,
  lazily dynamic-imported; missing package/model → loader returns null → fuzzy fallback.
  Fully local inference. Injected `Embedder` into `FileStore` (DI). Recall blends semantic
  cosine w/ fuzzy (semantic floor 0.5); semantic near-dup (cosine ≥ 0.88,
  `JAMGATE_DUP_THRESHOLD`) → action `possible_duplicate` w/ existing record (never silent
  drop). Subject-bearing saves skip near-dup (→ supersession). Vectors stored on records
  (v2-compatible). Pure math + full wiring unit-tested in CI via hand-built vectors + a
  deterministic mock — no model download.
- **Auto-subject (D-027):** new `src/gate/subject.ts`. When agent omits `subject`, derive
  one via keyword map + possessive/copula extractor. Conservative: confident match only,
  else unset. Lives in gate/server layer, so the store stays mechanical.
- Tests: 44 → **89** (`node:test`), all green. Schema still v2 (all new fields additive/
  optional). `npm ci`/lockfile synced for the optional peer dep.
- **Still open:** the thin classifier itself (only its logging shipped); embedding-quality
  tuning; multi-device sync (D-018). Out of scope this phase: npm publish, HTTP transport.

## Update — 2026-07-17 (Phase 2: robustness)
Phase 2 goal met: **user data can't be corrupted, and stale memory retires itself.**
Four items, all covered by tests, CI green on Node 20.x/22.x:
- **Atomic, durable writes (D-020):** `FileStore.writeAll` writes a temp file in the
  same dir, `fsync`s it, then `rename`s over the target. An interrupted write can't tear
  the store. New module seam `persist()` lets a test simulate a crash mid-write.
- **Type-based TTL / expiry + compaction (D-021):** new `src/store/ttl.ts`. `expiresAt`
  derived from type at save time (identity/preference = never, project ~90d, state ~2d;
  override via `JAMGATE_TTL_<TYPE>_DAYS`). Soft-expire hides expired from recall but keeps
  them; `compact()` (also opportunistic on save) removes records expired past a 30-day
  grace (`JAMGATE_COMPACT_GRACE_DAYS`). Untyped = never expires.
- **Concurrency safety (D-022):** new `src/store/lock.ts`. Every read-modify-write runs
  under a `<store>.lock` file (`O_CREAT|O_EXCL`, stale-lock stealing) + re-read-before-
  write. Honest limits documented: same-host/local-FS only, not NFS-safe.
- **Schema versioning (D-023):** new `src/store/schema.ts`. File is now
  `{ schemaVersion, memories }`; legacy bare-array files migrate automatically (backfill
  `expiresAt`) and persist on next write.
- Tests: 28 → **44** (`node:test`), all green. Verified end-to-end over MCP too.
- **Still open (unchanged):** thin classifier; auto-derive `subject`; embedding model;
  multi-device sync (D-018).

## Update — 2026-06-19 (reframe session)
- **Core purpose reframed (see D-016):** the product is a *shared cross-agent memory
  of the user* (who I am, my mood, and above all what I'm working on now), so agents
  stop being islands. The quality gate is the mechanism, not the headline. The old
  docs over-emphasized "deciding what's worth keeping" (salience).
- **New decision D-015:** time-aware memory — recency & supersession; distinguish a
  superseded state (newer auto-wins) from a genuine contradiction (flag/ask).
- **Prose rewrite DONE (2026-06-19)** to match D-015/D-016: RULES §0, §2 (supersession
  vs contradiction + timestamps), §3 title, §4 (recency), §5 stat; AGENTS.md "what
  this is" + "core idea"; README problem/idea/how-it-works + 97.8% stat with source.
- **Name chosen: Jamgate (D-017).** Multi-device sync design recorded (D-018). README
  now has a real Quickstart + accurate Status.
- **Genuine-contradiction handling DONE (trust-based, §2.3):** a lower-trust source
  (agent-inferred) can no longer silently overwrite a higher-trust one (user-explicit)
  on the same subject — it returns action "conflict" and asks for confirmation instead.
  Equal-or-higher trust still supersedes by recency. 5/5 conflict tests pass.
- **Storage adapter boundary DONE (D-019):** shared types + a `MemoryStore` interface
  live in `src/store/types.ts`; `FileStore` implements it; the server depends on the
  interface, not the backend — so a SQLite/Supabase store drops in later without a
  rewrite. Two-tier plan recorded: local/npm now, hosted cloud (v2) later. Build clean,
  7/7 store checks pass after the refactor.
- **Still open:** thin classifier for ambiguous/semantic cases; embedding model
  (local vs API); scoring threshold; multi-device sync (D-018); git first commit/remote
  + push to GitHub (deferred — do later).
