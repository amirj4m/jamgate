# AGENTS.md — Jamgate

> **First thing every session: read [`RULES.md`](./RULES.md) in full.**
> This file is the always-in-context summary. `RULES.md` has the detail and edge
> cases, and `RULES.md` wins on any conflict. Current state lives in
> [`MEMORY.md`](./MEMORY.md); the reasoning behind choices lives in
> [`DECISIONS.md`](./DECISIONS.md).
>
> On Linux, make the other agents read this same file:
> `ln -s AGENTS.md CLAUDE.md` and `ln -s AGENTS.md GEMINI.md`.

## What this project is (one paragraph)

**One shared, cross-agent memory of the user** — who they are, how they're doing, and
above all what they're working on right now — delivered as an **MCP server** that any
agent (Claude Code, Cowork, Cursor, …) reads from and writes to, so agents stop being
isolated islands and the user never re-briefs each one. A **write-time quality gate**
keeps that shared memory clean, current, contradiction-free and time-aware (otherwise
sharing just spreads junk). It is store-agnostic (bundles a default store for normal
users; lets power users bring their own such as mem0 or Graphiti) and **open-source,
impact-driven, not a profit play.**

## The core idea (why it exists)

Every agent you use is an island: each has its own memory and none share. Naive
sharing fails because the systems that store everything bloat with junk — one mem0
production audit found 97.8% junk (github.com/mem0ai/mem0 issue #4573). Storing is
solved (mem0, Graphiti, Cognee, Supermemory…) and even salience is mostly the calling
agent's job. The unsolved seam is **a neutral layer that keeps ONE shared memory
clean, time-aware and contradiction-free across every agent**, sitting in front of
any store rather than locked to one. Zep/Graphiti does temporal conflict-handling but
only inside its own heavy store; neutrality + write-time selectivity in front of any
store is still open. **We are the brain that keeps the shared memory honest, not
another warehouse.**

## Architecture (one picture)

```
Agent  →  [ Jamgate quality gate · MCP server ]  →  Store (default file/SQLite, or BYO: mem0 / Graphiti)
          save_memory / recall_memory / forget_memory
          only quality-passing writes get through
```

The shared, clean memory is the value; the gate is how it stays clean; the store is a
hidden implementation detail. A normal user installs the gate and gets "memory that
just works" across all their agents, and never hears the word "mem0".

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
