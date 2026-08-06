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
sharing just spreads junk). It is **designed** store-agnostic — the MCP server, the HTTP
layer and the gate pipeline all depend on the `MemoryStore` interface, never on a concrete
backend — but today **only the bundled file store is implemented: no mem0 or Graphiti
adapter exists, and there is no user-facing way to plug one in.** That is a designed seam,
not a shipped feature; never let a doc imply otherwise. Jamgate is **open-source,
impact-driven, not a profit play.**

## The core idea (why it exists)

Every agent you use is an island: each has its own memory and none share. Naive
sharing fails because the systems that store everything bloat with junk: in mem0 issue #4573
one user's store held 808 entries asserting "User prefers Vim" when nobody used Vim — one
hallucination re-extracted from its own recall output. (Cite that case carefully; the
headline percentage from it does not survive scrutiny. See D-067 and RULES §0.) Storing is
solved (mem0, Graphiti, Cognee, Supermemory…) and even salience is mostly the calling
agent's job. The unsolved seam is **a neutral layer that keeps ONE shared memory
clean, time-aware and contradiction-free across every agent**, sitting in front of
any store rather than locked to one. Zep/Graphiti does temporal conflict-handling but
only inside its own heavy store; neutrality + write-time selectivity in front of any
store is still open. **We are the brain that keeps the shared memory honest, not
another warehouse.**

## Architecture (one picture)

```
Agent  →  [ Jamgate quality gate · MCP server ]  →  Store (today: the bundled file store.
                                                    The `MemoryStore` seam is where a mem0 /
                                                    Graphiti adapter would go — none exists.)
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
- `src/store/` — the `MemoryStore` interface + the bundled file store (the only implementation;
  mem0/Graphiti adapters are a later possibility, not present)
- `docs/` — design notes
- `RULES.md` · `DECISIONS.md` · `MEMORY.md` — the project's rules and state

## Golden rules (carried over from the maintainer's own J4M/jamlex convention)

1. **Nothing is fake.** Every tool/function does a real thing or it doesn't exist.
   No `// TODO: wire later`, no stubbed "coming soon".
2. **Git: one independent commit per task, immediately.** Never `git add -A`,
   never `--no-verify`. Nothing stays only on local disk.
3. **Not done until tested.** No "I think it works" — run it against a real MCP
   agent (Claude Code / Cowork / Cursor) before claiming done.
4. **Documentation never lags, and every release-bound change ships.** The test is one
   question: *can a user consume this file and be misled about what they are getting?*
   - **Yes → release-bound**: `src/**`, `package.json`, `src/version.ts`, `server.json`,
     `README.md`, `CHANGELOG.md`, `skills/**`, the `.mcpb`, the publish workflows. Not done
     until committed **and** versions bumped in lockstep **and** tagged, published and
     released. **Never leave release-bound work on `master` untagged.**
   - **No → internal state**: `MEMORY.md`, `DECISIONS.md`, `docs/**`, session notes. Same
     discipline, same immediacy — written in the same session, never stale — but no version
     bump and no release of their own.
   - Touching both? The release-bound half decides: it ships.

   See `RULES.md` §8 for the checklist and the reasoning.
5. **Session ritual:** read `RULES.md` at the start; update `MEMORY.md` (and
   `DECISIONS.md` if a real decision was made) at the end.

**If this summary and `RULES.md` ever disagree, `RULES.md` is right.**
