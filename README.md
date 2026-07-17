# Jamgate

> A neutral memory quality-gate for AI agents — a gate, not a store. One shared memory
> of you — who you are, how you're doing, and what you're working on — that every AI
> agent reads from and writes to, kept honest at write time.

## The problem

You are one person, but every AI you use is a separate island. You design with one,
research with another, code with a third — and none of them know what the others
know, so you re-explain "what I'm working on" every time. The tools that try to share
memory mostly just **store everything**, so they bloat with junk: one production audit
of a leading memory system found **97.8% of its stored entries were junk**
([source](https://github.com/mem0ai/mem0/issues/4573)) — duplicates, trivia, one-off
chatter, stale states. Sharing memory is the goal; keeping the shared memory clean and
current is the unsolved part.

## The idea

**Jamgate is one shared memory of you that every agent plugs into — kept honest by a
quality gate.** It runs as an [MCP](https://modelcontextprotocol.io) server, so any
MCP-capable agent (Claude Code, Cowork, Cursor, …) connects to the same memory. It
sits in the *write path* and keeps that memory clean, current and contradiction-free:

```
Agent → [ Jamgate quality gate ] → any store (built-in by default, or bring your own)
        save / recall / forget
```

Because it's store-agnostic and vendor-neutral, the same memory follows you across
every agent — and because it filters at write time, the memory stays small, accurate,
and trustworthy instead of bloating with junk.

## How it keeps memory clean

A memory is kept only if it is **durable** (still true after this session) and would
**change a future answer**. Beyond that the gate is **time-aware**: every memory is a
timestamped event, so when something changes (you move from Windows to Linux) the
newer fact supersedes the old by recency instead of piling up as a contradiction — and
it never throws your own outdated words back at you as if they were current. It runs a
hybrid pipeline — cheap rules to drop obvious noise, the calling agent's own
understanding as the main salience filter, and a thin classifier only for ambiguous
cases. When unsure, it asks you. Everything is taggable, expirable, and deletable, so
you always see and control what's remembered.

## Quickstart (local MVP)

Jamgate runs locally — your memory never leaves your machine. Requires Node.js 20+.

```bash
git clone <repo-url> jamgate
cd jamgate
npm install
npm run build
```

Then register it with any MCP-capable agent (Claude Code, Cursor, Cowork, …) by adding
this to that agent's MCP config:

```json
{
  "mcpServers": {
    "jamgate": {
      "command": "node",
      "args": ["/absolute/path/to/jamgate/dist/index.js"]
    }
  }
}
```

Restart the agent. It now has three tools:

- **`save_memory`** — store a durable fact. The gate rejects junk, drops exact
  duplicates, and supersedes outdated facts by recency (pass a `subject` like
  `operating-system` so a newer fact retires the older one). A less-trusted source
  (e.g. an agent's guess) can never silently overwrite a more-trusted fact (something
  you said explicitly) — the gate flags the conflict and asks for confirmation instead.
- **`recall_memory`** — fetch what's known, relevant to a query (active facts only).
- **`forget_memory`** — delete a memory by id.

Your memory lives in `~/.jamgate/memory.json` (override with the `JAMGATE_STORE`
environment variable). Same machine, every agent → one shared memory.

## Status

Early but real. The MVP core works today: a local, zero-cost MCP server (TypeScript)
exposing `save_memory` / `recall_memory` / `forget_memory` over a flat-file store, with
a rule pre-filter, exact-duplicate dedup, time-aware supersession (newer facts retire
older ones by recency), and a source-trust conflict guard (a lower-trust source cannot
silently overwrite a higher-trust one — it asks instead). Verified end-to-end over the
MCP protocol and covered by an automated test suite. Next: a thin classifier for
ambiguous cases, deriving `subject` automatically, and multi-device sync
(see `DECISIONS.md`). **Goal: impact, not profit — open-source (MIT), built in the open.**

## Development

```bash
npm install
npm run build   # compile TypeScript to dist/
npm test        # compile and run the test suite (built-in node:test, no extra deps)
```

CI runs the build and tests on Node 20.x and 22.x for every push and pull request.

## Contributing

This is an impact project. The most valuable contributions are around **write-time
quality** (selective capture, dedup, contradiction handling, expiry) — the part the
whole field is weakest at. See `AGENTS.md` to get oriented, then `RULES.md`.
