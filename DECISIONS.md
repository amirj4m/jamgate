# DECISIONS.md — Jam (working codename)

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

### OPEN — Project name
"Hermes" rejected (it's an existing agent + overloaded name). Maintainer wants "jam"
(also their handle; مربا = jam) in the name. Candidates: Jamory, Jamgate, Jamjar,
Jamkeep, Jamoire, Jamind. Not yet decided.

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
