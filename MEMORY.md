# MEMORY.md — Jam (working codename)

Current state of the project. Update this at the end of every work session.

## Where we are right now
- **Phase: design complete, scaffolding not started.**
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

## What's next (first build steps)
1. Pick the project name (see OPEN in DECISIONS.md).
2. Scaffold the repo: `npm init`, add `@modelcontextprotocol/sdk`, TS config.
3. Stand up the smallest working MCP server exposing `save_memory` / `recall_memory`
   with a flat-file store and **layer 1 of the gate only** (the cheap rule pre-filter).
4. Connect it to a real MCP agent and test save/recall end-to-end.
5. Add the gate layers one at a time: dedup → contradiction → expiry → thin classifier.
6. `git init`, first commit, push to GitHub (account: amirj4m), MIT license.

## Open items
- Project name not chosen.
- Embedding model choice (local vs API) for dedup/recall — decide at step 5.
- Exact threshold/scoring for the "worth keeping" criterion — tune with real data.

## Migration note (Windows → Linux)
These files are plain text. The portability mechanism is **git**: commit them, push,
then `git clone` on Linux and everything (rules + state) comes with it. On Linux,
`ln -s AGENTS.md CLAUDE.md` so one file serves every agent.
