# Jam (working codename) — a quality gate for AI memory

> One neutral place your AI agents read from and write to — that only remembers what's
> actually worth remembering.

## The problem

Every AI agent has its own memory, locked inside its own walls, and none of them talk
to each other. The tools that try to fix this mostly just **store everything** — and a
recent audit found roughly **98% of what one leading memory system stored was junk**:
duplicates, trivia, one-off chatter. Storing memory is easy. Deciding **what is worth
keeping** is the unsolved part.

## The idea

**Jam is not another memory store — it's the quality gate in front of one.** It runs
as an [MCP](https://modelcontextprotocol.io) server, so any MCP-capable agent (Claude
Code, Cowork, Cursor, …) can connect to it. It sits in the *write path* and decides
what to keep:

```
Agent → [ Jam quality gate ] → any store (built-in by default, or bring your own)
        save / recall / forget
```

Because it's store-agnostic and vendor-neutral, the same memory follows you across
every agent — and because it filters at write time, the memory stays small, accurate,
and trustworthy instead of bloating with junk.

## How it decides what to keep

A memory is kept only if it is **durable** (still true after this session) and would
**change a future answer**. The gate runs a hybrid pipeline — cheap rules to drop
obvious noise, the calling agent's own understanding as the main filter, and a thin
classifier only for ambiguous cases. When it's unsure, it asks you instead of guessing.
Everything is taggable, expirable, and deletable, so you can always see and control
what's remembered.

## Status

Early. Design and rules are done (see `RULES.md` and `DECISIONS.md`); the MVP is a
local, zero-cost MCP server in TypeScript. **Goal: impact, not profit — open-source
(MIT), built in the open.**

## Contributing

This is an impact project. The most valuable contributions are around **write-time
quality** (selective capture, dedup, contradiction handling, expiry) — the part the
whole field is weakest at. See `AGENTS.md` to get oriented, then `RULES.md`.
