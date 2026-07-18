# Jamgate

[![CI](https://github.com/amirj4m/jamgate/actions/workflows/ci.yml/badge.svg)](https://github.com/amirj4m/jamgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jamgate.svg)](https://www.npmjs.com/package/jamgate)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> A neutral memory quality-gate for AI agents — **a gate, not a store.** One shared
> memory of you — who you are, how you're doing, what you're working on — that every AI
> agent reads from and writes to, kept honest at write time. Local-first, no cloud calls,
> one dependency.

```bash
claude mcp add jamgate -- npx jamgate
```

## The problem: memory quality, not storage

You are one person, but every AI you use is a separate island. You design with one,
research with another, code with a third — and none of them know what the others know,
so you re-explain "what I'm working on" every time.

The tools that try to fix this mostly **store everything**, so shared memory bloats with
junk: one production audit of a leading memory system found **97.8% of its stored entries
were junk** ([source](https://github.com/mem0ai/mem0/issues/4573)) — duplicates, trivia,
one-off chatter, stale states. Sharing memory is the easy part. Keeping the shared memory
*clean and current* is the unsolved part.

Jamgate sits in the **write path** and decides what deserves to be remembered, before it
is stored:

```
                 without a gate                          with Jamgate
   ┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
   │ "remember I'm on a call"          │   │ ✗ rejected — not durable             │
   │ "I use Windows"  ← from 6mo ago   │   │ ⇄ superseded — "I use Linux" wins    │
   │ "I use Windows"  (again)          │   │ ✗ duplicate — already known          │
   │ "I use Linux"                     │   │ ✓ saved — durable, changes answers   │
   │ "my name is Sam" (agent guessed)  │   │ ⚠ conflict — lower trust, ask first  │
   └──────────────────────────────────┘   └──────────────────────────────────────┘
     everything piles up, 98% junk           small, current, trustworthy
```

## The idea

**Jamgate is one shared memory of you that every agent plugs into — kept honest by a
quality gate.** It runs as an [MCP](https://modelcontextprotocol.io) server, so any
MCP-capable agent (Claude Code, Claude Desktop, Cursor, …) connects to the *same* memory
on your machine. Because it filters at write time, that memory stays small, accurate, and
contradiction-free instead of bloating with junk.

```
Agent → [ Jamgate quality gate ] → local store (~/.jamgate/memory.json)
        save_memory / recall_memory / forget_memory
```

## What it does — the gate layers

A memory is kept only if it is **durable** (still true after this session) and would
**change a future answer**. The gate is a hybrid pipeline, cheapest checks first:

| Layer | What it does |
| --- | --- |
| **Rule pre-filter** | Drops obvious non-durable noise ("I'm on a call now") before it reaches the store. |
| **Agent salience** | Uses the calling agent's own understanding as the main "is this worth remembering?" filter — no extra LLM call of our own. |
| **Exact dedup** | Identical facts are never stored twice. |
| **Time-aware supersession** | Every memory is a timestamped event; a newer fact retires an older one on the same `subject` by recency — no contradiction pile-up, and it never throws your own stale words back at you. |
| **Trust hierarchy** | A lower-trust source (an agent's guess) can't silently overwrite a higher-trust fact (something you said explicitly). The gate refers the conflict back to you instead. |
| **Semantic near-dup** *(optional)* | With local embeddings on, a save that *means* the same as an existing memory returns as a `possible_duplicate` to confirm, rather than piling up. |
| **Type-based expiry** | Volatile state ages out (~2 days) while identity never does, so recall stays current automatically. |

Everything is taggable, expirable, and deletable — you always see and control what's
remembered.

## Quick start

Jamgate runs **locally** — your memory never leaves your machine. Requires Node.js 20+.
No install step: `npx` fetches and runs it on demand.

### Claude Code

```bash
claude mcp add jamgate -- npx jamgate
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "jamgate": {
      "command": "npx",
      "args": ["jamgate"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "jamgate": {
      "command": "npx",
      "args": ["jamgate"]
    }
  }
}
```

Restart the agent. It now has three tools:

- **`save_memory`** — store a durable fact. The gate rejects junk, drops exact
  duplicates, supersedes outdated facts by recency (pass a `subject` like
  `operating-system` so a newer fact retires the older one — or let the gate derive one),
  and refers trust conflicts back to you.
- **`recall_memory`** — fetch what's known, relevant to a query (active facts only).
- **`forget_memory`** — delete a memory by id.

Your memory lives in `~/.jamgate/memory.json`. Same machine, every agent → one shared
memory.

## Optional: local semantic search

By default, recall is **fuzzy lexical** matching (stemming, typo-tolerance, trigrams) —
fast, deterministic, and dependency-free, but blind to synonyms. To also match on
*meaning* (so "automobile" recalls a memory about your "car"), install the optional
embedding backend:

```bash
npm install @huggingface/transformers
```

On first use it downloads a small sentence-embedding model (all-MiniLM-L6-v2, ~23 MB,
quantized) and runs it **entirely on your machine — no text is ever sent to any cloud
AI.** With it enabled, recall blends semantic similarity into the ranking, and a save
that is semantically near-identical to an existing memory comes back as a
`possible_duplicate` for you to confirm. **If the package isn't installed, Jamgate runs
on fuzzy recall — nothing breaks.**

## Configuration

All configuration is via environment variables; every one has a sensible default.

| Variable | Default | What it does |
| --- | --- | --- |
| `JAMGATE_STORE` | `~/.jamgate/memory.json` | Path to the memory store file. |
| `JAMGATE_EMBEDDINGS` | auto | `off` disables the semantic layer even if the model is installed. |
| `JAMGATE_DUP_THRESHOLD` | `0.88` | Semantic near-duplicate sensitivity (0–1); higher = stricter. |
| `JAMGATE_GATE_LOG` | on | `off` disables the local decision log. |
| `JAMGATE_TTL_<TYPE>_DAYS` | per type | Override the freshness window for a memory type, e.g. `JAMGATE_TTL_PROJECT_DAYS=180`. |

## How it compares

Jamgate is deliberately small and opinionated. It is **not** trying to be a hosted memory
platform or a knowledge graph — it's the write-time quality layer those systems are
weakest at, packaged as a drop-in local MCP server.

| | **Jamgate** | **Mem0 / OpenMemory** | **Zep / Graphiti** |
| --- | --- | --- | --- |
| Core model | Write-time quality **gate** over a flat store | LLM-extracted memory layer | Temporal knowledge **graph** |
| Where memory lives | Local file on your machine | Hosted platform or self-hosted store | Graph server (self-hosted or cloud) |
| Their strength | — | Rich extraction, broad SDKs/integrations, scale | Powerful entity/relationship & temporal modeling |
| Gate **before** write | ✅ core design | Partial (dedup/update) | Partial |
| Source-trust hierarchy | ✅ | — | — |
| Refers conflicts back to you | ✅ | — | — |
| LLM calls of its own | ❌ none | ✅ required | ✅ required |
| Dependencies / infra | 1 dep, no server | SDK + service/DB | Graph DB + service |
| Best for | Keeping one shared personal memory clean, locally | Full-featured app-scale memory | Complex relational/temporal reasoning |

Mem0, OpenMemory, Zep, and Graphiti are capable systems built for different goals; if you
need managed scale or graph reasoning, they're the right tool. Jamgate's bet is that for
*personal* cross-agent memory, the hard part is quality at write time — and that it should
be local, free, and one command to install.

## Privacy

- **Everything is local.** The memory store, the gate, and (if enabled) the embedding
  model all run on your machine. Jamgate makes **no network calls** and talks to no cloud
  AI.
- **The decision log is local too.** Every gate decision (saved / duplicate / superseded /
  conflict / possible_duplicate / rejected, with its reason) is appended to
  `~/.jamgate/gate.log`, a strictly local, size-capped JSONL file that rotates
  automatically and **never leaves your machine**. It exists to collect real usage data
  for a future local quality classifier. Disable it with `JAMGATE_GATE_LOG=off`.
- **Nothing leaves the machine** — no telemetry, no accounts, no keys.

## Status

Early but real, and now installable with one command. The MVP core, robustness, and
intelligence layers all work today (see [`CHANGELOG.md`](./CHANGELOG.md) for the full
0.1.0 scope):

- **Gate core** — rule pre-filter, exact dedup, time-aware supersession, source-trust
  conflict guard, over a local flat-file store.
- **Robustness** — atomic durable writes, type-based expiry, concurrency-safe locking,
  automatic schema migration.
- **Intelligence** — trusted client provenance, fuzzy recall, optional local embeddings
  with graceful fallback, auto-subject derivation, local decision log.

Verified end-to-end over the MCP protocol and covered by an automated test suite (89
tests) on Node 20.x and 22.x. Next: a thin classifier for ambiguous cases (trained on the
local decision log) and multi-device sync (see [`DECISIONS.md`](./DECISIONS.md)).
**Goal: impact, not profit — open-source (MIT), built in the open.**

## Development

```bash
npm install
npm run build   # compile TypeScript to dist/
npm test        # compile and run the test suite (built-in node:test, no extra deps)
```

CI runs the build and tests on Node 20.x and 22.x for every push and pull request.

## Contributing

This is an impact project. The most valuable contributions are around **write-time
quality** (selective capture, dedup, contradiction handling, expiry) — the part the whole
field is weakest at. See [`AGENTS.md`](./AGENTS.md) to get oriented, then
[`RULES.md`](./RULES.md).

## License

[MIT](./LICENSE)
