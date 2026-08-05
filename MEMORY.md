# MEMORY.md — Jamgate

Current state of the project. Update this at the end of every work session.

## Where we are right now

> ### ✅ SHIPPED AND UNIFIED — 2026-08-05
>
> **0.10.0 and 0.10.1 are public.** npm `latest` = **0.10.1**, the droplet runs **0.10.1**, the
> MCP registry entry is current, and every tagged version from v0.1.0 to v0.10.1 now has a
> GitHub Release with the `.mcpb` bundle attached to the latest.
>
> **The two-store split is resolved: the SERVER is home.** The laptop's 12 records were
> exported and replayed through the gate into production (`import`, D-033) — the gate accepted
> all 9 active ones, 0 conflicts, 0 duplicates. Claude Desktop's local stdio entry was removed
> (backup `~/.config/Claude/claude_desktop_config.json.jamgate-backup-20260805`), so nothing on
> the laptop is a write target any more. **Verified:** a `save_memory` from Claude Code on the
> laptop lands on the server and leaves `~/.jamgate/memory.json` untouched.
>
> `~/.jamgate/memory.json` (12 records) is now an **inert historical copy** — fully represented
> upstream. Do not write to it and do not re-point any client at it.
>
> **Production: 66 records, 51 active, 0 expired, 51 recallable, 106 logged decisions.**

- **0.10.0 AND 0.10.1 SHIPPED — public on npm, the registry, and the droplet (2026-08-05;
  D-060, D-061).** Tagged `v0.10.0` at `2680fa4`, the end of the validation phase, deliberately
  **excluding the parallel classifier session's commits** — the 0.10.0 changelog describes
  namespaces + REST + the audit fixes and says nothing about a classifier, so tagging HEAD
  would have published a release contradicting its own notes.
  - **npm**: 0.10.0 then 0.10.1, both via `publish.yml` with provenance. `latest` = 0.10.1.
  - **GitHub Releases**: v0.10.0 and v0.10.1 cut with the `.mcpb` attached, and **v0.6.0
    through v0.9.2 backfilled** — releases had been missing since v0.5.0, so the README's
    "latest release" link had been serving every new Claude Desktop user a five-versions-stale
    bundle. Verified by downloading it: the bundle now reports 0.10.1.
  - **Droplet**: nginx gained the `location /v1/` block (D-053) — `/v1/memory` now answers
    Jamgate's 401 instead of nginx's 404 — then upgraded 0.9.2 → 0.10.0 → 0.10.1.
    **19/19 live RULES §9 checks pass** against `memory.amirj4m.com`.
  - **MCP registry** (pending since Phase 4) is now **automatic**: the release workflow uses
    `mcp-publisher login github-oidc`, which needs no secret and no device flow. Entry is live
    at 0.10.1.
  - **Sweep:** the four records the old D-040 bug collapsed onto subject `location` were
    re-asserted through the live gate with correct distinct subjects — the fuller asylum record
    superseded the thinner one by recency, and the accounting fact stands on its own again. Ten
    of the thirteen subject-less records were given subjects read off their own text (no
    collisions; texts unchanged). **Three were deliberately left alone** — they are explicitly
    multi-topic, and one subject on a blend lets an unrelated future save retire the whole
    thing; splitting them is classifier work, not repair.
  - **Remaining known gap:** `mcpservers.org` needs a web form submission and PulseMCP needs a
    listing claim — both are browser-only and cannot be done from here.
- **DOGFOODING AUDIT of the real gate logs — the release gate that 0.10.0 did NOT clear
  (2026-08-05; D-054…D-056).** Read both real decision logs: production
  (`/var/lib/jamgate/gate.log`, 76 lines, 2026-07-21 → 2026-07-27, pulled read-only over SSH)
  and local (`~/.jamgate/gate.log`, 19 lines, 2026-07-21 → 2026-08-05). ~50 organic saves by
  one user over ~13 days.
  - **The verdicts were right; the outcomes were not.** 49/49 post-0.8.0 production decisions
    defensible. **Zero false refusals. Zero junk stored. Zero credentials in any live store.
    Zero live duplicates** (pairwise cosine over all 38 embedded active records: nothing at or
    above the 0.88 bar). **Zero subject collisions.**
  - **THE EVIDENCE DOES NOT COVER 0.10.0.** All 76 production lines are scope `default` —
    **namespaces have zero organic use**. **REST has zero organic use.** What was audited is
    evidence for 0.8.0/0.9.x. *No future release may claim 0.10.0 is dogfood-proven on this
    data.* Also: all four production rejections came from one minute of verification probes,
    so the refusal path has **never fired on real user input** either.
  - **Fixed — the type enum was never enforced (D-054).** Production held `type: "profile"`;
    an unknown type falls through `computeExpiresAt` as "never expires", so a typo silently
    made a 2-day memory permanent. Caught only by auditing real data — every synthetic test
    sent valid types.
  - **Fixed — 44% of production was expired and invisible (D-055).** 17 of 39 active records,
    all `type: state`, twelve `user-explicit`. Now: a human-sourced save with a short TTL
    warns the caller, and expiry is discoverable (`jamgate expired`, a recall footer,
    `GET /v1/memory?expired=1`).
  - **Fixed — deletes were never logged (D-056).** The D-025 corpus recorded every acceptance
    and no reversal; 24 production log-writes had no surviving record and the log explained
    none of them.
  - **All ten expired records RESTORED through the real gate (2026-08-05).** Not a store
    write — every one went through `saveThroughGate`, so the prefilter judged it, the store
    gate judged it, and each decision is in the real gate log. **The gate accepted all ten**
    (10× `superseded`, each retiring its own expired copy as audit history), including the
    three that had been recommended for deletion. Types chosen on what the fact IS: `identity`
    for permanent facts (pay structure, IBAN, government identifiers), `project` for bounded
    work (reconciliations, period summaries, searches, the appointment). **Production: 53
    records, 39 active, 0 expired, 39 recallable** — verified by a live recall over the real
    MCP endpoint. Backup `~/backups/jamgate-droplet-2026-08-05-pre-restore` (SHA-256 verified);
    no memory text altered; the store moved to schemaVersion 3 and jamgate 0.9.2 was proven
    able to read it before the push.
  - **Blocker found and fixed en route (D-057): an expired record blocked its own revival.**
    Soft-expired records keep `status: "active"`, so the duplicate check counted them as live
    and answered `duplicate` to the very save that would have brought the fact back — recall
    said "nothing stored", the gate said "already known", and no third call resolved it. Every
    one of the ten came back `duplicate` until this was fixed.
  - **Data repaired on the live production store** (backup `~/backups/jamgate-droplet-2026-08-05`,
    SHA-256 verified). `1ba22b6e` (profile+finance master record) carried the auto-derived
    subject `email` — any future `email` memory would have retired it; now
    `profile-master-record`. Seven expired records re-typed to a durable type (expired 17 → 10,
    recallable 22 → 29); the remaining ten were then restored through the gate, above, taking
    expired to 0. No memory text was altered.
  - **Documented, not blocking:** the D-040 auto-subject collapsed four real memories onto a
    bogus shared subject `location` back on 2026-07-21 (chain `a74458fb → c191336c → e367f5e0
    → 715d9c67`, the survivor later deleted) — the cause is fixed, the damaged records were
    never repaired, and the facts survive only via `1ba22b6e`. The near-duplicate refusal also
    caused real churn on the Sajjad-loan finance record (written 3×, deleted 2×, 09:26–09:30
    on 2026-07-27). One invalid type remains on a superseded record (`a74458fb`), left as
    history rather than rewritten.
- **0.10.0 VALIDATED against real clients; six bugs found, six fixed (2026-08-05; D-050…D-053).**
  RULES §9 run end-to-end against a **real MCP agent** (Claude Code 2.1.217, over stdio and over
  Streamable HTTP) plus the official MCP SDK client and `curl` — not just unit tests. Junk
  rejected, real fact kept, Windows→Linux superseded rather than duplicated, forget round-trip
  clean, all confirmed on the fixed build (29/29 assertions against a live server, 433 unit
  tests green). The three scope invariants hold on **both** transports: two scopes hold
  contradictory facts on one subject without interfering; an id from scope A is neither
  recallable nor deletable from scope B (full id, 8-char prefix, or default scope); and a
  credential over REST is refused byte-identically to the MCP tool (10-case parity matrix).
  - **Fixed — the gate stored a plaintext password (D-050).** `the password FOR X is Y` walked
    straight through while `X password is Y` was refused. One preposition apart, same fact,
    both transports. Now refused and redacted from the gate log.
  - **Fixed — two subject conventions (D-052).** The skill said dotted, the gate derived
    hyphenated, and subject equality drives supersession — so two contradicting "where jam
    lives" memories sat side by side, which RULES §10 forbids outright. Hyphens win; `.`/`_`/
    space fold to `-` on write **and read**, so legacy records still supersede.
  - **Fixed — REST spoke JSON-RPC on its two most common errors (D-051)**, contradicting the
    contract D-049 documents; and every REST response shipped the 384-float embedding (a
    one-result recall was 8.4 KB → now 245 bytes).
  - **Fixed — `server.json` was nine releases stale** at 0.1.0; now version-locked by a test.
  - **Fixed — the embedder test assumed the optional peer was absent**, so `npm test` failed on
    any machine with semantic recall actually installed.
  - **Documented, not fixed — the droplet's nginx is path-scoped (D-053).** Verified live:
    `GET /v1/memory` → **404 text/html from nginx**, never reaching Jamgate (`/mcp` → 401,
    `/healthz` → 200, both fine). The REST API is unreachable in production until the proxy
    gains a `location /v1/`. The droplet was NOT touched; the required blocks and a
    401-vs-404 check are now in the README's remote-mode section for the deploy step.
  - **Still gated on jam's OK:** `npm publish`, the `v*` tag, and the droplet deploy. Nothing
    was published, tagged or deployed.
- **0.10.0 — namespaces + a REST API, so Jamgate can back an app (2026-07-23; D-048, D-049).**
  Both additive and backward-compatible; the live single-tenant store is untouched. **Scopes
  (D-048):** an optional `scope` (opaque label, e.g. `amir/greek`) on a memory and on
  save/recall/forget. The whole gate runs PER scope — dedup, subject supersession, source-trust
  conflict guard, semantic near-duplicate — and recall/forget are strictly scoped (an id in
  another scope is "not found", never deletable across a boundary). Absent/empty scope →
  `"default"`, reproducing today's behaviour exactly; `schemaVersion` 2→3 auto-migration stamps
  `"default"` on existing records on read (a named scope is preserved), persisted on next write.
  MCP tools gained an optional `scope` param, added permissively like the `content`/`memory`
  aliases. **REST API (D-049):** the `--http` server now also serves `POST/GET/DELETE
  /v1/memory` on the same port, behind the same static-or-OAuth bearer gate; JSON errors, 401
  unauth, per-scope CRUD. Save on REST and MCP funnel through ONE shared `saveThroughGate`
  (prefilter→subject→store.save→gate-log), so they can't drift — a test proves a REST credential
  is refused exactly as the tool refuses it. `src/store/scope.ts` + `src/gate/pipeline.ts` are
  the new modules; MCP transport and OAuth flow untouched. Tests 390 → **413**; tsc strict +
  build clean. **NOT deployed to the droplet and NOT published to npm** — both gated on jam's
  explicit OK. (This entry originally pointed at "the deploy plan for a SEPARATE Mathos
  instance below". Mathos is a separate project of jam's, not part of Jamgate — see **Open
  items** for what it is; the deploy plan itself was never written down and is still open.)
  Pushed to GitHub master.
- **0.7.4 — the D-037 mystery is solved: the claude.ai/Cowork client sends `content`, not
  `text` (2026-07-21; D-039).** Live evidence, not a guess: that is exactly why the handler saw
  empty text and answered the absurd "too short". `save_memory` now resolves its text from
  `text` → `content` → `memory` (first non-empty string) and the gate judges it identically;
  `text` stays canonical, wins when both are present, and the aliases are named in the tool
  description so agents keep preferring it. When none is usable, the 0.7.2 error is unchanged.
  **Deliberately did NOT add `additionalProperties: false`** — a hard schema rejection is the
  same non-save with a nicer error, we don't control the clients that call this neutral layer,
  and it would also refuse a client that merely attaches an extra key like `session_id`. Be
  strict about what you store, liberal about what you're called with. 240 tests (was 235).
  Published; droplet on 0.7.4, **verified live**: a `content`-shaped save over the real
  `/mcp` reached the gate and was saved (probe deleted afterwards).
- **0.7.3 — third dogfooding bug of the day: a session never recovered from a server restart
  (2026-07-21; D-038).** A claude.ai conversation had a working session, the droplet's
  `jamgate.service` restarted for a deploy, and every later `save_memory` in that same
  conversation failed with "session expired" / "Not connected" — asking the client to reconnect
  did not help either. Sessions live in process memory, so a restart invalidates every session id
  in the wild; the Streamable HTTP spec makes **HTTP 404** the signal that tells a client to
  re-initialize, and we answered **400**, which a client reads as "this request was malformed".
  The prose in the error was correct and only the number was load-bearing. Now: unknown/expired
  `Mcp-Session-Id` → 404 on POST, GET and DELETE; *missing* session id → still 400 (a genuinely
  malformed request, same spec section); auth still runs first, so a valid token + dead session
  is 404 while a wrong token + dead session stays 401; an `initialize` carrying a stale id is
  accepted and issued a fresh id rather than refused mid-recovery. **Deliberately not built:**
  session persistence to disk (a session owns a live server + open stream, not a serializable
  row) and a SIGTERM drain handler (awaiting `httpServer.close()` hangs on idle SSE streams →
  systemd waits out `TimeoutStopSec` then SIGKILLs, turning an instant restart into a 90s one).
  The systemd unit was reviewed and left unchanged; store writes are atomic renames under a
  self-healing lock, so a hard kill needs no drain. 235 tests (was 226; 6 of the 9 new ones fail
  against the old code). Published; droplet on 0.7.3, **verified live from the laptop**:
  initialize → restart mid-session → old session id returns 404 → re-initialize → save succeeds.
- **0.7.2 — production bug from dogfooding: "the gate rejected everything with 'too short',
  even a 1700-character memory" (2026-07-21; D-037).** The text had never reached the gate:
  `String(args.text ?? "")` turned a missing/misnamed `text` into `""` and the prefilter judged
  the empty string. Reproduced over the live HTTP path (long text saves fine → no transport
  regression; `{content: "..."}` and `{}` both produced "too short"). **Second, worse bug found
  while reproducing:** `text: {type:"text", text:"…"}` stringified to the literal
  `"[object Object]"` and was SAVED through the gate as a success. Fixes: validate the argument
  before judging the memory (missing/empty/non-string `text` → MCP `isError` result naming the
  required field AND the keys that arrived; not gate-logged, since a client mismatch is not a
  memory judgement); prefilter reasons carry the measured length; **gate log defaults next to
  the store** (`JAMGATE_STORE` dir) — the old `~/.jamgate` default had been failing with ENOENT
  under systemd `ProtectHome`, so the audit trail was empty exactly when this bug needed it.
  226 tests. Published; droplet on 0.7.2, verified live: 1740-char save through
  memory.amirj4m.com → Saved (then forgotten, store back to 1 record), missing-arg → clear
  error, and `/var/lib/jamgate/gate.log` is now actually being written.
- **0.7.1 — recall scores subject + type, not just text (2026-07-21; D-036).** A live desktop
  chat asked for "my projects" and got "No matching memories" while the store held a
  `type: project` / `subject: jamgate-project` record whose TEXT never used the word. Recall now
  uses `memoryRelevance(query, memory)`: text + the subject's words (hyphenated keys split into
  words, weighted like text tokens) + a small `TYPE_BOOST = 0.15` when the query names the type
  (above `MIN_RELEVANCE`, below any real word match). Additive — no subject/type scores exactly
  as before. 217 tests. Published; droplet on 0.7.1.
- **Droplet embeddings (2026-07-21):** `@huggingface/transformers` is now installed for the
  `jamgate` user and the service logs `semantic embeddings active`. A plain install is
  **OOM-killed** on this 458 MB box while extracting onnxruntime's CUDA provider — use
  `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`. **Two limits found, both still open:** embeddings attach
  at SAVE time only, so every pre-existing record has no vector and is invisible to semantic
  recall/near-dup until re-saved (a `jamgate reindex`/backfill is needed); and
  `DEFAULT_SEMANTIC_MIN = 0.5` is above what real paraphrase pairs score on this model (measured
  0.395 for the README's own "automobile" ~ "car" example, 0.292 for "my car"), so semantic
  recall rarely fires. Needs an evidence-based threshold, not a guess.
- **Phase 10 — "Bring your memory with you" shipped (v0.7.0, 2026-07-21; D-035).**
  `jamgate import --from claude|chatgpt <path>` parses another product's memory export and
  replays it through the SAME gate as a live save (never a blind append); `--dry-run` works;
  plain `jamgate import <file>` (native format) untouched. **Format research (July 2026, this
  is the non-obvious bit): NEITHER vendor's bulk account data export contains memory entries.**
  Claude's export = conversations + account data; ChatGPT's = `conversations.json`, `chat.html`,
  `user.json`, `message_feedback.json`, `model_comparisons.json`. Both keep memory in the app's
  own settings UI with a copy-out path (Claude: Settings → Capabilities → "View and edit your
  memory"; ChatGPT: Settings → Personalization → Memory → Manage), and Anthropic's documented
  memory-transfer shape is `[date saved, if available] - memory content`. So the primary parser
  is a **text/markdown line parser** (verified format); the JSON path is explicitly best-effort
  and fails loudly. Accepts the .zip / extracted folder / single file — `src/backup/zip.ts` is a
  ~100-line dependency-free zip reader (STORE + DEFLATE via `node:zlib`). **Conversation logs
  are never mined** (skipped by name and reported). Mapping: `source: user-confirmed`, type only
  when obvious (`preference`/`identity`, else untyped), original timestamps preserved, subject
  via `deriveSubject`, provenance `import:claude.ai` / `import:chatgpt`. 211 tests (was 188).
  Published to npm and **deployed to the droplet** (memory.amirj4m.com → `/healthz` 0.7.0,
  static-token `/mcp` 200, unauthenticated 401).
- **Phase 9 — MCP OAuth shipped (v0.6.0, 2026-07-20; D-034).** Remote mode is now its own
  OAuth authorization server so claude.ai / the Claude mobile app can add a self-hosted
  instance (they only speak the OAuth flow, not a static header). Endpoints: RFC 9728
  protected-resource metadata (+ `WWW-Authenticate: resource_metadata` on `/mcp` 401s), RFC
  8414 AS metadata (PKCE S256), RFC 7591 dynamic registration, `GET/POST /authorize` (a
  consent page that asks for `JAMGATE_TOKEN` once → single-use PKCE-bound code), `POST /token`
  (code+verifier → 90d access token + rotating refresh). `/mcp` accepts an issued token **or**
  the static `JAMGATE_TOKEN` (Claude Code unaffected). All in `src/oauth/` (store/handlers/
  authorizePage); on by default (`JAMGATE_OAUTH=off` to disable); state in
  `~/.jamgate/oauth.json` (hashed secrets, same atomic-write+lock as the store). No new runtime
  deps. 188 tests (was 163). **Deployed to the droplet** (memory.amirj4m.com): upgraded the
  `jamgate` user's global npm to 0.6.0, added `JAMGATE_OAUTH_STORE=/var/lib/jamgate/oauth.json`
  to the systemd unit (home is read-only under `ProtectSystem=strict`), and extended the nginx
  config to proxy the OAuth paths **and** send `X-Forwarded-Proto`/`-Host` (without it the
  advertised metadata URLs would be `http://`). Verified live: metadata 200, full round-trip →
  `/mcp` 200, static-token `/mcp` 200.
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
*(Rewritten 2026-08-05. This list had gone seven phases stale — it still named TTL, atomic
writes and auto-subject as pending, all of which shipped in Phase 2/3.)*

Shipped and no longer open: the full gate pipeline (prefilter, dedup, time-aware supersession,
trust conflict guard, semantic near-duplicate), TTL/expiry + compaction (D-021), atomic durable
writes (D-020), automatic `subject` derivation (D-027, D-040, D-052), optional local embeddings
(D-026), remote HTTP mode + MCP OAuth (D-029, D-034), one-click install and deploy templates
(D-030, D-031), export/import and vendor import (D-033, D-035), namespaces and the REST API
(D-048, D-049).

Genuinely remaining, in the order they matter:
1. **The thin classifier for ambiguous saves** (RULES §5.3, D-004) — the last unbuilt layer of
   the hybrid pipeline. The gate log (D-025) has been collecting labelled decisions for exactly
   this since Phase 3; nothing consumes it yet.
2. **Multi-device sync (D-018)** — remote mode (D-029) covers the "one instance, many clients"
   case, so this is now specifically about two stores that both take writes offline.
3. **Embedding-quality tuning** — the thresholds in `src/embeddings/vector.ts` are measured
   (D-044, D-045) but the 0.76–0.83 false-negative band is a known, accepted cost.
4. **Non-MCP surfaces (RULES §7 phase 2)** — the REST API (D-049) is the first step; a browser
   extension for ChatGPT/Gemini is still unbuilt.

## Open items
- *(RESOLVED 2026-08-05 — see "Where we are right now". All ten expired records were restored
  through the real gate; the gate accepted all ten. jam's principle: "whether it was junk or
  not is not my call, the gate is supposed to decide that, not me." Asking him to rule on them
  was the wrong move — a quality gate that hands the quality decision back to the user has
  failed at the one thing it exists to do.)*
- **Mathos — identity settled, deploy plan still unknown.** *(jam, 2026-08-05.)*

  **What it is:** a **separate project of jam's, in its own repo — not part of Jamgate and not
  a feature of this codebase.** A learning/tutor system built over roughly two calendar days at
  the end of July 2026: TypeScript on Node 22, SQLite store, **FSRS concept-based generative
  review with no stored questions**, a pending-approval tray, roles as data with proven
  isolation, a constitution of 42 rules, a 31-case eval corpus, a multi-turn eval harness, a CI
  gate, 285 tests green, decisions logged through D-060. Its interface is deliberately
  undecided. Relative to Jamgate it would be a **second deployment consuming this REST API**
  (D-049) — a client of the gate, never a change to it.

  **What is still open:** the actual deploy plan for that separate Jamgate instance. The 0.10.0
  entry above pointed at "the deploy plan for a SEPARATE Mathos instance below"; **that plan was
  never written down anywhere** — not in this repo, not in any commit, not in DECISIONS.md — and
  it is genuinely unknown, not merely mislaid. It **must be re-decided before anything is
  deployed for Mathos.** Until then, 0.10.0's deploy means the existing memory.amirj4m.com
  instance only. (Note it would hit the same path-scoped nginx gap as the main instance —
  D-053.)
- Exact threshold/scoring for the "worth keeping" criterion — tune with real data from the
  gate log, alongside item 1 above.

## Migration note (Windows → Linux)
These files are plain text. The portability mechanism is **git**: commit them, push,
then `git clone` on Linux and everything (rules + state) comes with it. On Linux,
`ln -s AGENTS.md CLAUDE.md` so one file serves every agent.

## Update — 2026-07-18 (Phase 7: deploy button)
Phase 7 goal met: **a non-technical user can click a button, log into a hosting platform, and
get their own hosted Jamgate instance (URL + token) — no terminal.** Version bumped 0.3.0 →
**0.4.0**. Third rung on the install ladder (local `npx` setup → deploy button → own VPS). We
host nothing — instance + data live in the user's own platform account (**D-031: deploy is
convenience, not hosting**).
- **`GET /healthz` (D-031):** unauthenticated liveness endpoint added to `src/http.ts` *before*
  the auth gate — `200 {"status":"ok","version":...}`, exposes no memory/session/config. New
  `src/version.ts` `VERSION` constant shared by serverInfo + healthz (was a hardcoded string).
- **Platform `$PORT`:** `parseCliOptions` now honors `$PORT` (Railway/Render inject it) after
  `--port`/`JAMGATE_PORT`, before the 8420 default.
- **`Dockerfile` + `.dockerignore`:** multi-stage `node:22-alpine` (build compiles TS; runtime =
  prod-only deps + `dist/`), non-root `node` user, binds `0.0.0.0`, store on `/data` volume
  (`JAMGATE_STORE=/data/memory.json`), Node-based HEALTHCHECK on `/healthz`. **`JAMGATE_PORT`
  deliberately NOT set in the image** so `$PORT` wins (caught + fixed a bug where setting it broke
  port injection). Base install (embeddings peer omitted), like the `.mcpb`.
- **Render (`render.yaml`) — LIVE button today:** Docker web service, `generateValue` for
  `JAMGATE_TOKEN`, 1 GB disk at `/data`, `healthCheckPath: /healthz`, `plan: starter` (disk needs
  paid). `render.com/deploy?repo=…` reads it from the repo; works with only a platform login.
- **Railway (`railway.json`) — button PREPARED, not live:** file pins DOCKERFILE build + `/healthz`
  + restart policy, but Railway volumes/secrets are **template-level**, so the one-click button
  needs a one-time **template publish** in the user's Railway workspace (add volume `/data`, add
  `JAMGATE_TOKEN=${{ secret(32) }}`, Generate Template, publish → paste `/new/template/<code>`).
  Documented in README; button markdown left commented until the code exists.
- **No new runtime deps** — Docker adds only build tooling; healthz is Node stdlib (D-010 holds).
- **Tests: 131 → 138** (+7 in `test/http.test.ts`: healthz status+version/no-auth/no-leak/405,
  `$PORT` honored + precedence). All green, Node 20.x/22.x.
- **Docker NOT installed on build machine (honest):** image layering was not built. Verified
  instead locally — booted server with the image's exact env (`JAMGATE_HTTP=1 JAMGATE_HOST=0.0.0.0
  JAMGATE_STORE=… PORT=7777`): bound `0.0.0.0:7777` (PORT honored), `/healthz`→200 no-auth,
  `/mcp`→401 no-token, POST `/healthz`→405; and `npm ci --omit=dev` resolves prod deps (SDK
  present, transformers absent). HTTP MCP round-trip covered by existing suite.
- **Docs:** README "Deploy your own (no terminal needed)" section (buttons, ~$5–7/mo honesty,
  data location, get URL+token, connect desktops via `npx jamgate setup --remote`/phones via
  custom connector) + Status bullet; DECISIONS D-031 (new Phase 7 section); CHANGELOG 0.4.0.
- **Not done here:** `npm publish` (user runs interactively — one 0.4.0 publish covers 0.2–0.4);
  GitHub release v0.4.0; Railway template publish (interactive).

## Update — 2026-07-18 (Phase 6: one-click install)
Phase 6 goal met: **install friction reduced to near-zero for every client.** Version bumped
0.2.0 → **0.3.0**; master CI green on Node 20.x/22.x; **v0.3.0 GitHub release published with the
`.mcpb` asset**. `npm publish` remains the only step not done here (user runs it interactively — one
publish of 0.3.0 covers 0.2.0 too, since 0.2.0 was never published).
- **`jamgate setup` / `jamgate status` (D-030):** new `src/setup/` — pure `clients.ts` (registry +
  per-platform config paths + entry/deeplink builders), pure `merge.ts` (JSON merge), IO `runner.ts`,
  terminal `cli.ts`. Wired into `index.ts` as subcommands before any store/transport bootstrap.
  `setup` detects Claude Code / Claude Desktop / Cursor / Windsurf and wires each: **idempotent,
  never clobbers non-jamgate entries, backs up to `<file>.jamgate-backup` before writing.** Flags:
  `--dry-run`, `--remote <url> --token <t>` (HTTP entries for Claude Code + Cursor; Claude Desktop &
  Windsurf skipped-with-reason on remote — no verified HTTP path). Claude Code prefers `claude mcp
  add --scope user` when the CLI is present, else merges `~/.claude.json`; its stdio entry is written
  in Claude Code's `{type,command,args,env}` shape so a CLI-added entry reads as already-configured.
  `status` mirrors FileStore path resolution (`JAMGATE_STORE ?? ~/.jamgate/memory.json`).
- **Cursor deeplink:** `cursor://anysphere.cursor-deeplink/mcp/install?name=jamgate&config=<base64 of
  {command,args}>` — payload verified to round-trip; "Add to Cursor" badge in README.
- **Claude Desktop `.mcpb`:** `scripts/build-mcpb.mjs` stages compiled server + production-only deps
  (optional transformers peer omitted → fuzzy-recall base install), writes MCPB manifest v0.3, packs
  headlessly with `@anthropic-ai/mcpb`. Output `build/jamgate.mcpb` (gitignored); shipped as release
  asset `jamgate-0.3.0.mcpb` (3.2 MB). **Verified:** manifest validates, bundle boots on stdio and
  answers `initialize` + `tools/list` from its bundled deps, serverInfo 0.3.0. Unsigned (Desktop may
  prompt "unverified") — signing not required to install; noted in docs.
- **No new runtime deps** — whole helper is Node stdlib (zero-dep philosophy, D-010, holds).
- **Tests: 107 → 132** (`test/setup.test.ts`, +25: entry shapes, per-platform paths, deeplink
  round-trip, pure merge incl. no-clobber/idempotency/malformed, runner against temp home — configure,
  re-run, backup, dry-run, not-found, remote-skip, claude-CLI path + fallback, status incl.
  JAMGATE_STORE). No test touches real home configs.
- **Not verified headlessly (honest):** actually launching Cursor/Windsurf/Claude Desktop GUIs to
  confirm they pick up the entry, the deeplink opening Cursor, and the `.mcpb` GUI install flow —
  config-file writing and bundle boot are verified; the GUI handshakes are inherently not testable here.
- **Docs:** README Quick start → Option A (`npx jamgate setup`) / Option B (per-client manual, kept
  for transparency) + badges; DECISIONS D-030 (new Phase 6 section); CHANGELOG 0.3.0; serverInfo 0.3.0.

## Update — 2026-07-18 (Phase 5: optional remote mode)
Phase 5 goal met: **one self-hosted Jamgate instance can serve all of a person's MCP clients
(phone app, claude.ai, Claude Code, any Streamable HTTP client) from one shared memory** —
delivering the "one mind, one memory across every agent" vision beyond a single machine. Opt-in;
stdio stays the default and local-first is unchanged. Version bumped 0.1.0 → **0.2.0**. Master CI
expected green on Node 20.x/22.x. **`npm publish` is the only remaining step** (done interactively
by the user; not run here).
- **HTTP transport (D-029):** new `src/http.ts`. `jamgate --http [--port 8420]` (or `JAMGATE_HTTP=1`
  / `JAMGATE_PORT`) serves MCP over the SDK's `StreamableHTTPServerTransport` at `/mcp`, stateful
  per-session (tracked by `mcp-session-id`). `index.ts` refactored: `buildStore()` + `createServer`
  shared between stdio and HTTP; `parseCliOptions()` picks the mode. Binds `127.0.0.1` by default
  (`JAMGATE_HOST`). The SDK bundles `@hono/node-server`, so the Node HTTP transport needs no new dep.
- **Auth:** `JAMGATE_TOKEN` **required** in HTTP mode — server refuses to start without it (clear
  error). Every request gated; missing/wrong token → `401` + `WWW-Authenticate`. `bearerTokenMatches`
  uses `crypto.timingSafeEqual`, length-independent (constant-time).
- **TLS out of process by design:** terminate at caddy/nginx; documented, not implemented in-process.
- **Concurrency:** multiple HTTP sessions share one `FileStore`; Phase 2 lock + re-read-before-write
  (D-022) keep concurrent saves safe — proven by a two-session concurrent-write test (24 distinct
  saves, none lost).
- **Client provenance over HTTP:** verified D-024 handshake stamping works identically over HTTP
  (each session gets its own `createServer`).
- **Tests: 89 → 107** (`test/http.test.ts`, +18: CLI-parser, bearer-check, 401/404/400 auth gate via
  raw fetch, MCP round-trip, wrong-token connect rejection, provenance, concurrent sessions). Stressed
  the HTTP file 5× locally, 0 fails. Also smoke-tested the built CLI binary directly: no-token refusal,
  401 unauthenticated, real MCP `initialize` handshake returning a session id.
- **Docs:** README "Remote mode (self-hosted)" section (when/why, security model, systemd unit +
  `EnvironmentFile`, Caddy + nginx snippets, Claude-app custom-connector + `claude mcp add --transport
  http` steps, honest limits), env-var table rows (`JAMGATE_HTTP/PORT/HOST/TOKEN`), Status updated to
  107 tests + remote layer. CHANGELOG 0.2.0. DECISIONS D-029 (new Phase 5 section). serverInfo → 0.2.0.
- **Honest limits (stated as scope):** whoever holds the token holds the memory; **no multi-user
  tenancy — one instance = one human**; single-process concurrency (not multi-node); no in-process TLS.
- **Next / deploy:** wire it on the user's DigitalOcean droplet in a follow-up (systemd + Caddy +
  domain), then add each device as a custom connector. Still open (pre-existing): thin classifier;
  embedding-quality tuning; multi-device sync via user-held keys (D-018, a different path from remote).

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
- **PENDING at the time (auth-gated, handed off to the user) — status as of 2026-08-05:**
  - ✅ `npm publish` — **done, and repeatedly since.** `npm view jamgate version` → **0.9.2**;
    published versions run through 0.1.0 … 0.9.2. (0.10.0 is built and tagged-pending, not yet
    published — that step is still awaiting jam's explicit OK.)
  - ✅ Auto-publish CI workflow — **exists and has run.** `.github/workflows/publish.yml`
    publishes on a `v*` tag with `npm publish --provenance --access public` using the
    `NPM_TOKEN` secret. The "SKIPPED on purpose, no secret exists" note below was true in
    Phase 4 and has been false since the secret was added.
  - ◻ MCP Registry publish — still needs interactive `mcp-publisher login github` (device
    OAuth). The `mcp-publisher` binary sits untracked in the repo root (now gitignored);
    `server.json` was nine releases stale at 0.1.0 until 2026-08-05 and is now version-locked
    to package.json by a test.
  - ◻ mcpservers.org — web form at https://mcpservers.org/submit (Category: Memory), NOT a PR.
  - ◻ PulseMCP — auto-crawls the registry/npm; claim the listing once it appears.
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
