# RULES.md — Jam (working codename)

The single source of truth for this project. No claim of "done" / "wired" counts
unless every relevant rule below is demonstrably satisfied. If in doubt → not done.

---

## 0. What we are building (and what we are NOT)

- **We are building a quality GATE, not a memory store.** Storage is a commodity
  (mem0, Graphiti, Cognee, Supermemory already own it). Our value is deciding
  *what is worth remembering* at write time.
- **Neutral and store-agnostic.** The gate sits in front of *any* store and *any*
  agent. It must never be locked to one store or one vendor.
- **Open-source, impact-first.** Optimize for adoption and usefulness, not revenue.
  Open + neutral is the strength here, not a weakness.
- **Do NOT build "yet another MCP memory server" that just stores.** That space is
  taken and we lose. Our only durable opening is **write-time quality + neutrality.**

## 1. Architecture

```
Agent → [ quality gate / MCP server ] → Store (default file/SQLite, or BYO mem0/Graphiti)
```

- The gate exposes MCP tools: `save_memory`, `recall_memory`, `forget_memory`.
- The agent talks to the gate. The gate applies the pipeline, then writes *through*
  to the store. The store is hidden from the user.
- **Two user types, both first-class:**
  - *Normal user* — installs the gate, gets a bundled default store, never hears
    "mem0". For them, the gate **is** the memory.
  - *Power user* — points the gate at their existing store (bring-your-own-store).

## 2. The write pipeline — 6 checks before anything is stored

When a `save_memory` arrives, run these in order. Reject or reshape, don't blindly append:

1. **Worth it? (salience)** — durable AND changes future answers? If it's chatter or
   one-time, reject.
2. **Duplicate?** — already known → update/merge, do not add a second copy.
3. **Contradiction?** — conflicts with an existing memory (e.g. "uses Windows" vs new
   "moved to Linux") → invalidate/replace the old one, never keep both.
4. **Type + structure** — tag it (identity / project / preference / state) and
   normalize into a clean memory object.
5. **Expiry / lifespan** — assign a freshness window by type (see §4).
6. **Source + confidence** — record origin (`agent-inferred` / `user-confirmed` /
   `user-explicit`) and a confidence score.

Only after passing all six does it get written.

## 3. The "worth keeping" criterion (this is the core IP)

Break "worth it" into checkable sub-questions and score them:

- **Type:** is it a fact / decision / preference / state — or just passing chatter?
- **Durable:** will it still be true after this session ends?
- **Changes the answer:** if the AI knew this, would a *future* response differ?
- **Specific:** is it concrete and actionable, not vague?

Score → keep only above a threshold. **When uncertain, do NOT auto-save — ask the
user.** Route uncertainty to the human; it keeps quality high and is cheap.

## 4. The 5-layer memory model (organized by how fast it changes)

| Layer | Example | Expiry |
|---|---|---|
| 1. Identity — who the user is | name, role, language | never |
| 2. Projects / work | "building a language app" | weeks–months |
| 3. Current focus / thinking | "comparing DB options today" | short |
| 4. Physical state | "tired today" | hours–days |
| 5. Emotional state | "stressed about launch" | hours–days |

Layers 4–5 are valuable **and** volatile **and** sensitive — short TTL, prefer
user-confirmation, and make them easy to view and delete.

## 5. Decision logic — hybrid pipeline (NOT pure-AI, NOT pure-rules)

Pure "LLM, extract memories" is exactly what produces 98% junk. Pure hard-coded
rules can't make a semantic judgment. So:

1. **Cheap rule pre-filter** — kill the obvious junk (too short, pleasantries, no
   real content, recent duplicate) *before* spending any AI.
2. **Lean on the calling agent's own intelligence** — in MCP the agent already
   understood the conversation. Instruct it (via these rules / its AGENTS.md) to
   call `save_memory` only for durable things and to pass structured fields. The
   agent is a free, smart filter. Do not run a second LLM to re-understand.
3. **Thin classifier for ambiguous cases only** — a small, cheap LLM call guided by
   the precise §3 criterion, never a vague prompt.
4. **Uncertainty → ask the user.**

## 6. Capture rules (how input arrives)

- **Never screen-scrape.** That re-creates the junk problem. Reading raw screens is
  banned as a primary mechanism.
- **Separate WHERE you sit from WHEN you write.** Write only at checkpoints, never
  continuously.
- **User-input patterns:** explicit command ("remember this") · agent proposes /
  user confirms · end-of-session review · correction-as-signal (a correction is a
  high-priority *update*).
- Every memory carries the **source** field from §2.6.

## 7. Surfaces (what we support, in what order)

- **v1 — MCP-capable agents** (Claude Code, Cowork, Cursor): capture is clean because
  the agent is the filter. **Build here first.**
- **Phase 2 — web chatbots** (ChatGPT, Gemini): no clean MCP yet → browser extension
  or their growing connector support. Worst case: read-only there (inject memory in,
  can't auto-capture out). That is acceptable; do not let the hardest surface block v1.

## 8. Engineering rules

- TypeScript + Node + official MCP SDK. Default store = file/SQLite first; mem0 /
  Graphiti are *adapters*, added later, never the core.
- The core must run **locally (stdio), zero hosting cost**, for the MVP.
- One independent commit per task. English commit messages, one line, the task title.
  Never `git add -A`, never `--no-verify`, never force-push to main.
- No new markdown/README files without an explicit request.
- License: MIT. Public repo on GitHub.

## 9. Test protocol — before claiming "done"

1. Build/run the MCP server.
2. Connect it to a **real** MCP agent (Claude Code / Cowork / Cursor).
3. Exercise `save_memory` / `recall_memory` / `forget_memory` end-to-end.
4. Prove a junk input is **rejected** and a real fact is **kept**.
5. Prove a contradiction (Windows → Linux) **updates** rather than duplicates.
6. If any step fails → still in_progress.

"I didn't run it but I think it works" is never acceptable.

## 10. Absolute forbidden list

❌ building a plain store and calling it the product · ❌ locking to one vendor/store ·
❌ screen-scraping as a primary capture method · ❌ a single vague "extract memories"
LLM call as the whole pipeline · ❌ auto-saving when uncertain instead of asking ·
❌ keeping contradictory memories side by side · ❌ storing volatile state with no
expiry · ❌ claiming done without testing against a real MCP agent.

**If any rule here is violated → the task is not done. Period.**
