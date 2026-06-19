# AGENTS.md — Jam (working codename · final name TBD)

> **First thing every session: read [`RULES.md`](./RULES.md) in full.**
> This file is the always-in-context summary. `RULES.md` has the detail and edge
> cases, and `RULES.md` wins on any conflict. Current state lives in
> [`MEMORY.md`](./MEMORY.md); the reasoning behind choices lives in
> [`DECISIONS.md`](./DECISIONS.md).
>
> On Linux, make the other agents read this same file:
> `ln -s AGENTS.md CLAUDE.md` and `ln -s AGENTS.md GEMINI.md`.

## What this project is (one paragraph)

A **neutral, cross-agent memory QUALITY GATE**, delivered as an **MCP server**. It
sits in the *write path* between any AI agent (Claude Code, Cowork, Cursor, …) and
any memory store, and decides **what is actually worth remembering** — solving the
"98% junk" problem that every existing memory system has. It is store-agnostic
(bundles a default store for normal users; lets power users bring their own such as
mem0 or Graphiti). It is **open-source and impact-driven, not a profit play.**

## The core idea (why it exists)

Storing memory is easy and already done many times over (mem0, Graphiti, Cognee,
Supermemory…). The unsolved problem is **write-time selection**: deciding what to
keep and what to throw away. Existing systems auto-save everything via a vague "LLM,
extract memories" call → ~98% of stored memories are junk. **We are the brain that
decides, not another warehouse.**

## Architecture (one picture)

```
Agent  →  [ JAM quality gate · MCP server ]  →  Store (default file/SQLite, or BYO: mem0 / Graphiti)
          save_memory / recall_memory / forget_memory
          only quality-passing writes get through
```

The gate is the value. The store is a hidden implementation detail. A normal user
installs the gate and gets "memory that just works" and never hears the word "mem0".

## Stack (MVP)

TypeScript · Node · `@modelcontextprotocol/sdk` · SQLite or a flat file as the
default store · an embedding model (local or API) for dedup/contradiction/recall ·
a small LLM only for the thin "is this worth keeping?" classifier on ambiguous cases.

## Repo structure (planned)

- `src/` — the MCP server + the quality-gate pipeline
- `src/gate/` — the write-time pipeline (rules → agent-trust → classifier)
- `src/store/` — default store + adapters (file/SQLite first; mem0/Graphiti later)
- `docs/` — design notes
- `RULES.md` · `DECISIONS.md` · `MEMORY.md` — the project's rules and state

## Golden rules (carried over from the maintainer's own J4M/jamlex convention)

1. **Nothing is fake.** Every tool/function does a real thing or it doesn't exist.
   No `// TODO: wire later`, no stubbed "coming soon".
2. **Git: one independent commit per task, immediately.** Never `git add -A`,
   never `--no-verify`. Nothing stays only on local disk.
3. **Not done until tested.** No "I think it works" — run it against a real MCP
   agent (Claude Code / Cowork / Cursor) before claiming done.
4. **Session ritual:** read `RULES.md` at the start; update `MEMORY.md` (and
   `DECISIONS.md` if a real decision was made) at the end.

**If this summary and `RULES.md` ever disagree, `RULES.md` is right.**
