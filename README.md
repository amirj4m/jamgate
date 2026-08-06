# Jamgate

[![CI](https://github.com/amirj4m/jamgate/actions/workflows/ci.yml/badge.svg)](https://github.com/amirj4m/jamgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jamgate.svg)](https://www.npmjs.com/package/jamgate)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> Every AI tool I use keeps its own memory, so I kept re-introducing myself to all of them.
> Jamgate is one memory file on my machine that any MCP client can read and write, with a
> quality gate in front deciding what actually gets written. It runs locally and has one
> runtime dependency.

I built it for myself and I'm the only person who has used it in anger, which is worth
knowing before you read the rest. [What it can't do](#honest-limits) is a section, not a
footnote.

One command wires it into every MCP client on your machine:

```bash
npx jamgate setup
```

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000?logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=jamgate&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyJqYW1nYXRlIl19)
&nbsp;•&nbsp; one-click **Claude Desktop** bundle → the `.mcpb` on the [latest release](https://github.com/amirj4m/jamgate/releases/latest)

## Why a gate and not just a store

Sharing memory between agents turns out to be the easy half. I had a working shared store
early on and the problem it created was worse than the one it solved: within a week it was
full of "jam is on a call", the same fact three times in slightly different words, and a
stale preference from a month earlier being handed to an agent as though it were current.

I'm not the only one. A production audit of one leading memory system found 97.8% of its
stored entries were junk — duplicates, trivia, one-off chatter, dead states
([issue #4573](https://github.com/mem0ai/mem0/issues/4573)). If you share memory across
agents without filtering it, all you have built is a faster way to spread junk.

So Jamgate sits in the write path and decides what gets stored:

```
                 without a gate                          with Jamgate
   ┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
   │ "remember I'm on a call"          │   │ ✗ rejected — not durable             │
   │ "I use Windows"  ← from 6mo ago   │   │ ⇄ superseded — "I use Linux" wins    │
   │ "I use Windows"  (again)          │   │ ✗ duplicate — already known          │
   │ "I use Linux"                     │   │ ✓ saved — durable, changes answers   │
   │ "my name is Sam" (agent guessed)  │   │ ⚠ conflict — lower trust, ask first  │
   └──────────────────────────────────┘   └──────────────────────────────────────┘
     everything piles up, 98% junk           small, and still true
```

It runs as an [MCP](https://modelcontextprotocol.io) server, so any MCP client (Claude Code,
Claude Desktop, Cursor, and seven others) talks to the same memory file on your machine.

```
Agent → [ Jamgate quality gate ] → local store (~/.jamgate/memory.json)
        save_memory / recall_memory / forget_memory
```

## The gate layers

A memory is kept if it is still true after this session and would change a future answer.
Cheapest checks run first:

| Layer | What it does |
| --- | --- |
| **Rule pre-filter** | Drops obvious non-durable noise before it reaches the store: fragments, pleasantries, placeholder text (`test`, `foo bar`), and anything that isn't a claim about you. |
| **Credential refusal** | Refuses to store secrets. API keys (`sk-…`, `AKIA…`, `ghp_…`, JWTs, PEM blocks), password assignments, and high-entropy tokens next to credential wording are rejected with a reason — and kept out of the decision log too. A git sha or UUID in ordinary prose passes untouched. |
| **Question filter** | A question asks *for* memory, it isn't memory. `how much is jam's rent?` is refused; a rhetorical question inside a longer fact is not. |
| **Transience filter** | Statements pinned to this instant ("it's raining right now") are refused unless you type them as `state`, where a short TTL ages them out on their own. |
| **Agent salience** | Uses the calling agent's own understanding as the main "is this worth remembering?" filter — no second LLM call of its own. |
| **Exact dedup** | Identical facts are never stored twice. |
| **Time-aware supersession** | Every memory is a timestamped event; a newer fact retires an older one on the same `subject` by recency — no contradiction pile-up, and it never throws your own stale words back at you. |
| **Trust hierarchy** | A lower-trust source (an agent's guess) can't silently overwrite a higher-trust fact (something you said explicitly). The gate refers the conflict back to you instead. |
| **Semantic near-dup** *(optional)* | With local embeddings on, a save that *means* the same as an existing memory returns as a `possible_duplicate` to confirm, rather than piling up. |
| **Related-memory hint** *(optional)* | Below the duplicate bar but clearly on the same topic, the memory is **stored** and the look-alike is named, so the agent can re-save with a shared `subject` if it was really an update. A hint never retires anything. |
| **Type-based expiry** | Volatile state ages out (~2 days) while identity never does, so recall stays current automatically. |

Every rejection comes back with a reason the calling agent can act on. This matters more than
it sounds: the agent is the only party in a position to fix the call, and a bare "rejected"
just teaches it to retry with slightly different wording until something sticks.

Note what is *not* in that table: nothing here understands your memory. These are rules,
regexes and cosine thresholds. See [Honest limits](#honest-limits).

## Honest limits

Read this before the feature list, not after it. Everything below is measured or observed,
and none of it is fixed yet.

**Recall often puts the wrong memory first.** On my own store — 12 real memories, 17 queries
I wrote — the right memory came back at rank 1 in **10 of 17** cases, and appeared anywhere
in the top 5 in 13. Turning on the optional embeddings *used* to make this worse than leaving
them off; that's fixed, but "the answer is in there somewhere" is still an accurate
description of recall on a store of any size. This is the weakest part of the project and
the thing I'd fix next.

**Nobody outside me has installed it.** Twenty-two releases, ten supported clients, one user.
I've simulated a cold install (fresh `HOME`, empty npm cache, published package rather than
my working copy) and it held up, but simulation is not a stranger on their own machine.

**macOS and Windows have never actually been run.** Their config paths are unit-tested and
CI is Linux-only. If you are on a Mac and `jamgate setup` writes to the wrong place, you are
the first person to find out. Please open an issue.

**Embeddings only attach when a memory is saved.** Install the optional semantic package
today and every memory you saved before that stays invisible to semantic recall until you
save it again. There is no `reindex` command. This is a straightforward gap, not a hard
problem, and it isn't done.

**"Store-agnostic" is a seam, not a feature.** Everything above `src/store/` depends on a
`MemoryStore` interface rather than a concrete backend, which is a real design property you
can check in the source. But the bundled file store is the only implementation. There is no
mem0 adapter, no Graphiti adapter, and **no way for you to point Jamgate at your own store
today.** If a future write-up of mine implies otherwise, this line is the correct one.

**The quality judgments are rules and numbers, not understanding.** The gate cannot tell that
"moved to Berlin last spring" and "no longer lives in Athens" are the same event. It matches
subjects, compares cosines against thresholds I set from measurements, and applies regexes.
It is genuinely good at the mechanical cases — exact duplicates, credentials, recency on a
shared subject — and blind to anything requiring judgment. A thin LLM classifier for the
ambiguous cases exists on a branch and is not in this release.

**One JSON file, read whole on every operation.** At my 66 records that is free. There is no
index and no pagination, so at some size it stops being free; I don't know what that size is
because I've never had a store big enough to find out.

**Semantic search is English-only.** The bundled model is `all-MiniLM-L6-v2`. On other
scripts its similarity degenerates into "is this the same language" (the Greek for *bicycle*
scored 0.62 against an unrelated Greek memory), so non-Latin text is deliberately not
embedded at all and falls back to lexical matching, which does work in every script.

**A memory is text, and recall puts it into your agent's context.** The gate decides whether
something is worth keeping, not whether it is safe to act on. If a memory contains
instructions, those words come back verbatim on the next recall, in a place the model reads.
That is true of every memory system. Jamgate narrows the surface — it never scrapes screens,
never mines chat logs, refuses credentials, and only writes on an explicit `save_memory`
call — but it cannot make text inert. Treat the store as trusted input and look at what goes
in; `jamgate export` prints all of it.

Remote mode has its own set of limits, listed under [Remote mode](#remote-mode-limits).

## Quick start

Jamgate runs **locally** — your memory never leaves your machine. Requires Node.js 20+.
No install step: `npx` fetches and runs it on demand.

### Option A — `npx jamgate setup` (recommended)

One command detects the MCP clients installed on your machine (Claude Code, Claude Desktop,
Cursor, Windsurf, Gemini CLI, VS Code / Copilot, Cline, Roo Code, OpenCode, Zed) and wires
Jamgate into each:

```bash
npx jamgate setup
```

It is **safe to run**: idempotent (running it twice changes nothing), it never touches any
server entry but its own, and it backs up each config file to `<file>.jamgate-backup` before
writing. A plain `setup` (local stdio) will also **never silently overwrite a remote (`--remote`)
wiring** — it leaves that client as-is and tells you so; pass `--force` to downgrade it on
purpose. Useful flags:

```bash
npx jamgate setup --dry-run                          # show what would change, write nothing
npx jamgate setup --remote https://you/mcp --token … # wire HTTP transport (see Remote mode)
npx jamgate setup --force                             # overwrite even a remote wiring with local stdio
npx jamgate status                                    # show which clients are wired + where the store lives
npx jamgate --help                                    # every command and environment variable
```

If `setup` finds no clients, that is normal on a machine where the client has been installed
but never launched — a client writes its config on first run. Start it once, then re-run
`npx jamgate setup`.

Restart your client(s) afterwards. On Claude Code, when the `claude` CLI is present, setup
uses `claude mcp add` under the hood; otherwise it merges `~/.claude.json` directly.

### Option B — per-client manual

Prefer to wire it yourself? Each client is a small config change.

**Claude Code:**

```bash
claude mcp add jamgate -- npx jamgate
```

**Claude Desktop** — one-click: download the `.mcpb` bundle from the
[latest release](https://github.com/amirj4m/jamgate/releases/latest) and open it (Claude
Desktop → Settings → Extensions; the bundle is unsigned, so you may see an "unverified"
prompt). Or add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

**Cursor** — click the **Add to Cursor** badge at the top, or add to `~/.cursor/mcp.json`
(or `.cursor/mcp.json` in a project):

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

**Windsurf** — add the same `mcpServers` block to `~/.codeium/windsurf/mcp_config.json`.

**Gemini CLI** — add the same `mcpServers` block to `~/.gemini/settings.json`.

**Cline / Roo Code** — add the same `mcpServers` block to the extension's MCP settings file
(Cline: `.../globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; Roo:
`.../globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`), or use each
extension's "Configure/Edit MCP Servers" button.

**VS Code (Copilot)** — add to the user `mcp.json` (Command Palette → **MCP: Open User
Configuration**). VS Code uses a `servers` key and an explicit `type`:

```json
{
  "servers": {
    "jamgate": { "type": "stdio", "command": "npx", "args": ["jamgate"] }
  }
}
```

**OpenCode** — add to `~/.config/opencode/opencode.json` under the `mcp` key (note the single
`command` array and `enabled` flag):

```json
{
  "mcp": {
    "jamgate": { "type": "local", "command": ["npx", "jamgate"], "enabled": true }
  }
}
```

**Zed** — add to `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "jamgate": { "command": "npx", "args": ["jamgate"] }
  }
}
```

#### Supported agents

`jamgate setup` auto-wires every agent below whose MCP config it can merge **losslessly** —
each entry shape is verified against the vendor's official docs. Agents whose config lives in a
non-JSON format I can't safely round-trip (TOML / YAML) are listed as **manual** with the
one-liner to add yourself.

| Agent | Config file | `setup` | Remote (`--remote`) |
| --- | --- | --- | --- |
| Claude Code | `~/.claude.json` | ✅ auto | ✅ |
| Claude Desktop | `claude_desktop_config.json` | ✅ auto | connectors UI |
| Cursor | `~/.cursor/mcp.json` | ✅ auto | ✅ |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | ✅ auto | ✅ |
| Gemini CLI | `~/.gemini/settings.json` | ✅ auto | ✅ |
| VS Code (Copilot) | `<Code>/User/mcp.json` | ✅ auto | ✅ |
| Cline | `.../saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | ✅ auto | ✅ |
| Roo Code | `.../rooveterinaryinc.roo-cline/settings/mcp_settings.json` | ✅ auto | ✅ |
| OpenCode | `~/.config/opencode/opencode.json` | ✅ auto | ✅ |
| Zed | `~/.config/zed/settings.json` | ✅ auto | ✅ |
| Codex CLI | `~/.codex/config.toml` (TOML) | manual¹ | — |
| Goose | `~/.config/goose/config.yaml` (YAML) | manual¹ | — |
| Continue | `~/.continue/config.yaml` (YAML) | manual¹ | — |

¹ **Manual** — these use TOML/YAML; rather than risk mangling comments or formatting I don't
auto-edit them. Add Jamgate by hand: **Codex CLI** →
`[mcp_servers.jamgate]` with `command = "npx"` and `args = ["jamgate"]` in `~/.codex/config.toml`;
**Goose** → a `stdio` extension under `extensions:` with `cmd: npx` / `args: ["jamgate"]`;
**Continue** → an `mcpServers:` list entry with `command: npx` / `args: [jamgate]`.

> For agents that live in a shared, comment-friendly settings file (Gemini, OpenCode, Zed),
> `setup` will **skip** rather than overwrite a file it can't parse as strict JSON — so a
> `//`-commented `settings.json` is never clobbered; add the block by hand in that case.

Restart the agent. It now has three tools:

- **`save_memory`** — store a durable fact. The gate rejects junk, drops exact
  duplicates, supersedes outdated facts by recency (pass a `subject` like
  `operating-system` so a newer fact retires the older one — or let the gate derive one),
  and refers trust conflicts back to you. Subjects are **lowercase and hyphenated**; dots,
  underscores and spaces fold to hyphens, so `editor.theme` and `editor-theme` are one key.
- **`recall_memory`** — fetch what's known, relevant to a query (active facts only).
- **`forget_memory`** — delete a memory by the id `recall_memory` printed (the full id, or an
  unambiguous prefix of 8+ characters).

Volatile memories age out of recall on a TTL, so a fact you saved can stop being returned
without being deleted. `jamgate expired` shows exactly what recall is hiding and when it will
be compacted away — nothing is modified:

```bash
jamgate expired               # what has aged out of recall but is still on disk
jamgate expired --json        # machine-readable, for a script
```

Your memory lives in `~/.jamgate/memory.json`. Same machine, every agent → one shared
memory. To share one memory across **different** machines and your phone, see
[Remote mode](#remote-mode-self-hosted).

## Agent skill: `memory-discipline`

Wiring in the three tools gives an agent the *ability* to remember. The
**`memory-discipline`** skill teaches it the *habits* — recall before answering,
save one granular durable fact at a time with a specific reused `subject`, never send
secrets, and treat gate verdicts as answers rather than errors to retry. Its rules are
distilled straight from Jamgate's own [decision log](./DECISIONS.md) (D-040…D-045).

It ships in this repo at [`skills/memory-discipline/SKILL.md`](./skills/memory-discipline/SKILL.md)
as a portable [agentskills.io](https://agentskills.io) instruction pack. One command installs it
for every agent the `skills` CLI finds on your machine (it wired 17, including Cursor, Copilot
and Claude Code, on the machine I tested it on):

```bash
npx skills add amirj4m/jamgate
```

The skill is prompt text, not code — it is **not** part of the npm package (the
`files` whitelist ships only `dist`), so it never bloats the runtime install.

## Optional: local semantic search

By default, recall is **fuzzy lexical** matching (stemming, typo-tolerance, trigrams) —
fast, deterministic, and dependency-free, but blind to synonyms. It works in **any script**:
Persian, Greek, Cyrillic, Arabic, Hebrew, Chinese, Japanese and Korean all tokenize and
recall, and accents fold so `café` and `cafe` find each other. (Stemming is English-only, and
Chinese/Japanese are segmented per character rather than per word — good enough to find a term
inside a sentence, not a real word segmenter.) To also match on
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

**What to expect from it, measured rather than assumed** ([D-063](./DECISIONS.md)): the
thresholds are set from real cosines on this model over a real store, not from estimates.
Two limits are worth knowing before you install it:

- **Embeddings attach when a memory is saved.** Memories written *before* you installed the
  package have no vector, so they stay on fuzzy recall until they are saved again. There is
  no backfill command yet.
- **Long memories dilute.** The model mean-pools, so a short query against a 500-character
  memory scores lower than against a one-line fact. Synonym reach is strongest exactly where
  the README's example is — short, single-fact memories.
- **English only.** all-MiniLM-L6-v2 is an English model, and on other scripts its
  "similarity" collapses into *"is this the same language"* — measured, with the Greek for
  *bicycle* scoring 0.62 against an unrelated Greek memory. So non-Latin text is deliberately
  **not** embedded: those languages stay on fuzzy lexical recall, which works properly in
  every script. Nothing is lost by installing the package if you write in Persian or Japanese;
  nothing is gained either.

## Namespaces (scopes)

By default Jamgate is single-tenant: one human, one memory. If you need **one instance to hold
several memories that must not blend** — a tutor app with separate subjects, or a small group
sharing an instance — attach an optional **scope** (an opaque label such as `amir/greek`) to a
memory and to each operation:

- **The gate is per scope.** Deduplication, subject supersession, the source-trust conflict
  guard and the semantic near-duplicate check all compare a new memory only against others in
  the **same** scope. Two scopes can hold the same text, the same subject, even contradictory
  facts, without one affecting the other.
- **Recall and forget are strictly scoped.** Recall returns only the requested scope; forget
  resolves an id only within its scope, so one namespace can never read or delete another's
  memory — even with the exact id.
- **Omitting the scope is the normal case.** An absent or empty scope means the single
  `default` namespace, which is exactly how Jamgate behaved before namespaces existed. Nothing
  changes for a single-user setup.

Over MCP, pass `scope` on `save_memory` / `recall_memory` / `forget_memory`. Over the REST API
(below), pass it in the JSON body or as a `?scope=` query parameter. Scopes are just
case/whitespace-folded labels — `user/role` is a useful convention, not a required format.

> Multi-**user** separation (per-person accounts and auth) is a different thing and is not what
> a scope provides: whoever holds the `JAMGATE_TOKEN` can address any scope on that instance. A
> scope is a namespace **within** one token-holder's memory.

## Configuration

All configuration is via environment variables; every one has a sensible default.

| Variable | Default | What it does |
| --- | --- | --- |
| `JAMGATE_STORE` | `~/.jamgate/memory.json` | Path to the memory store file. |
| `JAMGATE_EMBEDDINGS` | auto | `off` disables the semantic layer even if the model is installed. |
| `JAMGATE_DUP_THRESHOLD` | `0.88` | Semantic near-duplicate sensitivity (0–1); higher = stricter. Measured against the real model, true rewordings span ~0.76–0.94 and *different* facts reach ~0.81, so the two overlap — 0.88 deliberately favours never refusing a real memory over catching every reword. |
| `JAMGATE_GATE_LOG` | on | `off` disables the local decision log. |
| `JAMGATE_TTL_<TYPE>_DAYS` | per type | Override the freshness window for a memory type, e.g. `JAMGATE_TTL_PROJECT_DAYS=180`. |
| `JAMGATE_HTTP` | off | `1`/`true` enables [remote mode](#remote-mode-self-hosted) (same as the `--http` flag). |
| `JAMGATE_PORT` | `8420` | Port for remote mode (same as `--port`). |
| `JAMGATE_HOST` | `127.0.0.1` | Interface to bind in remote mode. Keep it on localhost behind a reverse proxy. |
| `JAMGATE_TOKEN` | — | Bearer token required in remote mode. The server refuses to start without it. |
| `JAMGATE_OAUTH` | on | In remote mode, serve the [MCP OAuth flow](#adding-to-claudeai-mcp-oauth) so claude.ai / the Claude app can connect. `off` disables it (static-token-only). |
| `JAMGATE_OAUTH_STORE` | `~/.jamgate/oauth.json` | Path to the OAuth state file (registered clients + hashed tokens). |

## Backup & migration

Your memory is one JSON file (`JAMGATE_STORE`, default `~/.jamgate/memory.json`), so a backup can
be as simple as copying it. But `jamgate export` / `jamgate import` do it properly — schema-aware,
and with import passing every record back **through the same quality gate** so a restore or a
machine-to-machine move can't smuggle in duplicates or overwrite a trusted fact.

```bash
# Back up everything (active + superseded history) to a file
jamgate export --output backup.json

# Only the live facts, and pipe it somewhere
jamgate export --active-only > my-memory.json

# Restore / merge into another machine's store (respects JAMGATE_STORE)
jamgate import backup.json

# See exactly what would happen first — nothing is written
jamgate import backup.json --dry-run
```

**Export** writes a `{ schemaVersion, exportedAt, generator, memories }` envelope. Without
`--output` it prints pure JSON to stdout (so it pipes cleanly) and the summary to stderr.

**Import** accepts that envelope *or* a bare JSON array. Each active record is replayed through the
gate — exact-duplicate dedup, time-aware supersession, the trust/contradiction guard, and
near-duplicate detection — instead of being blindly appended, and original timestamps and
provenance are **preserved** (your `createdAt` is never reset). It prints a per-record report
(imported / duplicates skipped / superseded / conflicts flagged / near-duplicates); conflicts and
near-duplicates are surfaced for you to decide, never silently resolved. The whole import is one
atomic transaction — a malformed file is rejected with a nonzero exit and your store is left
untouched. Records already retired (`superseded`) in the source are treated as history and skipped,
not re-activated. See [DECISIONS D-033](./DECISIONS.md).

> Moving a **local** store onto **your own server**? Export locally, copy the JSON up, then
> `JAMGATE_STORE=/data/memory.json jamgate import my-memory.json` on the box (or just place the
> file at `JAMGATE_STORE` — but `import` is what merges into an existing server store safely).

## Bring your memory with you

If you've been using Claude or ChatGPT for a while, they already know things about you, and
starting from an empty file is the annoying part of trying anything new.
`jamgate import --from <vendor>` takes the memory list you copy out of either one and replays
it through the same gate a live save goes through, so duplicates and junk don't come along
with it.

```bash
# Claude — a memory list you saved from Settings → Capabilities → "View and edit your memory"
jamgate import --from claude ~/Downloads/claude-memory.md

# ChatGPT — the list copied from Settings → Personalization → Memory → "Manage memories"
jamgate import --from chatgpt ~/Downloads/chatgpt-memory.txt

# Point it at the export .zip or the extracted folder — it finds the memory file inside
jamgate import --from chatgpt ~/Downloads/chatgpt-export.zip

# Always look first. Nothing is written on a dry run.
jamgate import --from claude ~/Downloads/claude-memory.md --dry-run
```

### How to get your export

Honest status, checked July 2026: **neither vendor's bulk account data export contains your
memory entries.** Both keep them in the app's own memory settings, and both document a
copy-out-the-text path. So the file you feed Jamgate is a text/markdown list, one memory per line:

| Product | Where your memories are | What to do |
| --- | --- | --- |
| **Claude** | Settings → Capabilities → **"View and edit your memory"** | Copy the list (or ask Claude: *"Write out your memories of me verbatim, exactly as they appear in your memory"*) into a `.md`/`.txt` file. Anthropic's own memory-transfer format is `[date saved, if available] - memory content` — which is what the parser expects. |
| **ChatGPT** | Settings → Personalization → Memory → **"Manage memories"** | Select the list and copy it into a `.md`/`.txt` file. A trailing `(saved 2026-01-09)` is understood. |

Dates are optional. Bullets (`-`, `*`, `1.`), markdown headings, horizontal rules and code fences
are handled. If a future export *does* ship structured memory JSON, it reads that too —
best-effort, looking for entries under memory-ish keys — and it accepts the `.zip` or the extracted
folder directly and pick the memory-shaped file out of it.

### What it reads, and what it deliberately doesn't

- ✅ **Curated memory / profile entries only** — the list you reviewed and kept in the source app.
- ❌ **It never mines your conversation logs.** `conversations.json`, `chat.html`,
  `message_feedback.json` and friends are recognized by name, skipped, and reported as skipped.
  Inferring facts about you from raw chat history is exactly the low-consent behavior this project
  exists to push back on. If the export contains nothing but chat logs, the import fails with a
  message telling you where your memories actually live.
- ❌ **It never fetches anything from a vendor account.** You download your own export, yourself.
  Jamgate reads a local file and nothing else.

### What happens to each entry

Every parsed line becomes a memory and goes **through the gate**, never blind-appended:

- **source `user-confirmed`** — you curated these in the source product. Not `user-explicit`
  (you didn't dictate them to Jamgate), not `agent-inferred` (they aren't a guess by this tool).
- **type inferred conservatively** — `preference` or `identity` only when the wording is obvious;
  otherwise left **untyped**. A wrong type is worse than no type.
- **original dates preserved** when the line carries one, so time-aware supersession orders your
  history correctly. Undated entries are stamped at import time.
- **provenance recorded** as `import:claude.ai` / `import:chatgpt`, so you can always see where a
  memory came from.
- **the gate decides** — exact duplicates are skipped, a newer fact about the same subject
  supersedes the older one, contradictions with more-trusted memories are flagged instead of
  silently applied, and near-duplicates are surfaced for you.

Because a hand-pasted file can contain stray prose (a footer, a stray note), every non-empty line
is a *candidate*. Run `--dry-run` first — it prints exactly what would land. See
[DECISIONS D-035](./DECISIONS.md).

## Deploy your own (no terminal needed)

Want one shared memory across your **phone, browser, and laptop** but don't want to run a
server? Click a button, log into a hosting platform, and you get **your own** Jamgate instance
with its own URL and token — no terminal, no server knowledge. Same gate, same store as the
local install; only the transport is over the network (this is [Remote mode](#remote-mode-self-hosted),
set up for you).

**What you should know first (honest version):**

- **You pay the platform directly. I host nothing.** A tiny always-on instance with a small
  persistent disk runs roughly **$5–7/month** on Railway or Render. That bill is between you and
  the platform; Jamgate takes no cut and runs no cloud.
- **Your instance, your data.** The memory store lives on a disk *in your account* on *your*
  platform. Jamgate never sees it, never proxies it, has no telemetry. A deploy button is
  convenience, not hosting — see [DECISIONS D-031](./DECISIONS.md).
- **Whoever holds the token holds the memory.** The deploy generates a strong bearer token for
  you. Treat it like a password. There are no per-user accounts (one instance = one person; see
  [Honest limits](#remote-mode-limits)).

### Deploy to Render (works today)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/amirj4m/jamgate)

The button reads [`render.yaml`](./render.yaml) straight from this repo: it builds the image from
the [`Dockerfile`](./Dockerfile), **generates a random `JAMGATE_TOKEN` for you**, and attaches a
1 GB persistent disk at `/data` for your memory. Render provisions a paid `starter` instance
(a disk needs one). After it goes live, read your token under **Environment**, and your URL is
the service URL with `/mcp` appended (e.g. `https://jamgate-xxxx.onrender.com/mcp`).

### Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/Nb49HE)

The button deploys the published template: it builds the image from the [`Dockerfile`](./Dockerfile)
(pinned via [`railway.json`](./railway.json) with the `/healthz` check), **generates a random
`JAMGATE_TOKEN` for you**, and attaches a persistent volume at `/data` for your memory. After it
goes live, read your token under **Variables**, and your URL is the service domain with `/mcp`
appended (e.g. `https://jamgate-xxxx.up.railway.app/mcp`).

### Get your URL and token, then connect your devices

Once the deploy is live you have two things: a **URL** ending in `/mcp` and a **token** (from the
platform's environment/variables tab). Connect each device to the same instance so they share one
memory:

- **Desktops (Claude Code, Cursor, Windsurf, Gemini CLI, VS Code, Cline, Roo Code, OpenCode,
  Zed) — one command:**

  ```bash
  npx jamgate setup --remote https://your-instance/mcp --token <your-token>
  ```

  This wires every detected client on that machine to your instance (Streamable HTTP clients
  only; others — e.g. Claude Desktop — are skipped with a reason).

- **Phone (Claude app) and claude.ai in a browser:** Settings → **Connectors** → *Add custom
  connector* → URL `https://your-instance/mcp`, and provide the bearer token when asked. The same
  three tools (`save_memory`, `recall_memory`, `forget_memory`) then work from your phone.

Save on your phone, recall on your laptop — one memory, everywhere. For the full server-owner
path (your own VPS, systemd + Caddy), keep reading.

## Remote mode (self-hosted)

By default Jamgate runs **locally over stdio** — one process per agent, on your machine, no
network. That's the right model for a single computer. But you are one person with agents in
several places at once: the Claude app on your **phone**, claude.ai in a **browser**, Claude
Code on a **laptop**. stdio can't be their shared brain — each would get its own local process
and its own memory.

**Remote mode** is the answer: run **one** Jamgate instance on a server you control, put it
behind HTTPS, and point every agent at the same URL. Now they share **one** memory of you — save
on your phone, recall on your laptop. It's the same gate and the same store, just reachable over
the network. It stays **opt-in**; stdio remains the default and the local-first promise is
unchanged. Whether it's your own memory or a whole team's, the rule is one instance per person
(see [Honest limits](#remote-mode-limits)).

### Run it

```bash
# A strong token is REQUIRED — the server refuses to start without one.
export JAMGATE_TOKEN=$(openssl rand -hex 32)
jamgate --http                 # listens on 127.0.0.1:8420/mcp
# or: jamgate --http --port 9000     (or JAMGATE_HTTP=1 JAMGATE_PORT=9000)
```

The MCP endpoint is `/mcp`. Every request must carry `Authorization: Bearer <token>`; anything
else gets a `401`. In remote mode Jamgate also serves the standard **MCP OAuth flow** (on by
default) so it can be added to claude.ai and the Claude mobile app — see
[Adding to claude.ai](#adding-to-claudeai-mcp-oauth).

### Security model

- **Bearer token.** One shared secret in `JAMGATE_TOKEN` guards every request, compared in
  constant time so it can't be recovered from response timing. Generate it with
  `openssl rand -hex 32`, keep it out of shell history, and rotate it by restarting with a new
  value.
- **TLS is terminated by a reverse proxy, not by Jamgate.** Jamgate speaks plain HTTP and binds
  to `127.0.0.1` by default, so it is never directly exposed. Put **caddy** or **nginx** in
  front to terminate HTTPS and forward to it locally. A bearer token over plain HTTP on the open
  internet is a leaked token — **always** run it behind TLS.
- **Your server, your data.** The store is still a flat file on a disk you own. No Jamgate cloud,
  no third party, no telemetry. "Self-hosted" means exactly that.
- **OAuth without an identity provider.** For clients that require OAuth (claude.ai, the Claude
  app), your instance is its own authorization server — your `JAMGATE_TOKEN` is still the only
  credential, PKCE is enforced, and issued tokens are stored hashed and revocable. Details in
  [Adding to claude.ai](#adding-to-claudeai-mcp-oauth).

### REST API (for app backends)

MCP is the right protocol for agents, but an ordinary app backend just wants plain HTTP. In
remote mode Jamgate also serves a small REST API on the **same port**, behind the **same bearer
token** — so a mobile app or a script can save and recall without speaking JSON-RPC:

```bash
BASE=https://memory.example.com/v1/memory
AUTH="Authorization: Bearer $JAMGATE_TOKEN"

# Save (optionally into a namespace — see "Namespaces" above)
curl -sX POST "$BASE" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"text":"the aorist tense expresses a completed action","scope":"amir/greek","type":"project"}'

# Recall within a scope
curl -s "$BASE?query=aorist&scope=amir/greek" -H "$AUTH"

# Forget by id, within a scope
curl -sX DELETE "$BASE/<id>?scope=amir/greek" -H "$AUTH"
```

| Method & path | Body / query | Returns |
| --- | --- | --- |
| `POST /v1/memory` | `{text, scope?, type?, subject?, source?}` (`content`/`memory` accepted as aliases of `text`) | `201` with `{action, memory, …}` when a record lands; `200` with the gate's `action` when it deliberately stores nothing (`duplicate`/`conflict`/`possible_duplicate`/`rejected`) |
| `GET /v1/memory` | `?query=&scope=&limit=` | `200` with `{memories: […]}` |
| `DELETE /v1/memory/:id` | `?scope=` | `200 {ok:true,id}`, `404` not found, `409` ambiguous prefix |

Every REST save goes through the **exact same gate** as the MCP tool (dedup, supersession,
conflict guard, credential refusal), per scope. A missing/wrong token is a `401`; a malformed
body is a `400`. The MCP endpoint (`/mcp`) and the OAuth flow are unaffected — REST is purely
additive.

### Deploy: systemd + Caddy

A `systemd` unit to keep Jamgate running (fill in your user and a real token — ideally load the
token from an `EnvironmentFile` with `600` permissions rather than inlining it):

```ini
# /etc/systemd/system/jamgate.service
[Unit]
Description=Jamgate MCP memory (remote mode)
After=network.target

[Service]
# Load JAMGATE_TOKEN=... (and any JAMGATE_* overrides) from a root-only file:
EnvironmentFile=/etc/jamgate.env
Environment=JAMGATE_HTTP=1
Environment=JAMGATE_PORT=8420
Environment=JAMGATE_STORE=/var/lib/jamgate/memory.json
ExecStart=/usr/bin/npx jamgate
User=jamgate
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
echo "JAMGATE_TOKEN=$(openssl rand -hex 32)" | sudo tee /etc/jamgate.env >/dev/null
sudo chmod 600 /etc/jamgate.env
sudo systemctl enable --now jamgate
```

**Caddy** — automatic HTTPS, two lines of real config:

```caddyfile
memory.example.com {
    reverse_proxy 127.0.0.1:8420
}
```

**nginx** — equivalent, with TLS certs managed by certbot. Note that nginx, unlike Caddy's
`reverse_proxy`, forwards **only the paths you name**: every Jamgate surface needs its own
`location`, and one you forget returns nginx's own 404 without the request ever reaching
Jamgate.

```nginx
server {
    listen 443 ssl;
    server_name memory.example.com;

    ssl_certificate     /etc/letsencrypt/live/memory.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/memory.example.com/privkey.pem;

    location /mcp {
        proxy_pass         http://127.0.0.1:8420/mcp;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";        # keep-alive for SSE streaming
        proxy_buffering    off;                  # don't buffer the event stream
        proxy_read_timeout 3600s;
    }

    # REST API (0.10.0). REQUIRED if you use it — without this block `/v1/memory` is a
    # 404 from nginx, not a 401 from Jamgate, and every REST client silently sees "no
    # such endpoint" instead of "you need a token".
    location /v1/ {
        proxy_pass         http://127.0.0.1:8420;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   Authorization $http_authorization;
    }

    # MCP OAuth (needed for claude.ai and the Claude mobile app).
    location /.well-known/ { proxy_pass http://127.0.0.1:8420; }
    location /authorize    { proxy_pass http://127.0.0.1:8420; }
    location /token        { proxy_pass http://127.0.0.1:8420; }
    location /register     { proxy_pass http://127.0.0.1:8420; }

    # Liveness probe (unauthenticated by design; exposes only status + version).
    location /healthz { proxy_pass http://127.0.0.1:8420/healthz; }
}
```

**Verify each surface actually reaches Jamgate** after any proxy change — an unauthenticated
request must come back `401` from Jamgate, never `404` from the proxy:

```bash
curl -si https://memory.example.com/v1/memory | head -1   # expect: HTTP/2 401
curl -s  https://memory.example.com/healthz               # expect: {"status":"ok","version":"…"}
```

### Connect your agents

Point every agent at `https://your-domain/mcp` with the token.

**Claude app (iOS / Android / desktop) and claude.ai** — Settings → Connectors → *Add custom
connector* → paste the URL `https://your-domain/mcp` and click through. These clients only speak
the standard **MCP OAuth flow**, so instead of pasting a token into a config field, a Jamgate
page opens in your browser and asks: *"This is your Jamgate instance. Enter your instance token
to authorize this client."* Paste your `JAMGATE_TOKEN` **once**, and Claude is connected — it
remembers the authorization, so you won't be asked again for that client. Once connected, the
same three tools (`save_memory`, `recall_memory`, `forget_memory`) are available from your phone
and browser. See [Adding to claude.ai](#adding-to-claudeai-mcp-oauth) below for what happens under
the hood.

**Claude Code** — add it as an HTTP MCP server:

```bash
claude mcp add --transport http jamgate https://your-domain/mcp \
  --header "Authorization: Bearer <token>"
```

**Any MCP client** that speaks Streamable HTTP works the same way: URL `https://your-domain/mcp`,
header `Authorization: Bearer <token>`.

### Adding to claude.ai (MCP OAuth)

claude.ai and the Claude mobile app cannot take a static token in a config field — they only
support the [MCP authorization flow](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
(OAuth 2.1 + PKCE). Jamgate implements that flow itself in remote mode, so **no external identity
provider is involved** — your instance *is* the authorization server, and your `JAMGATE_TOKEN` is
the one credential. It's **on by default** whenever you run `--http` (disable with
`JAMGATE_OAUTH=off` if you only ever use Claude Code with a static header).

What you do:

1. In claude.ai (or the app): Settings → Connectors → *Add custom connector* → URL
   `https://your-domain/mcp`.
2. Claude discovers the flow, registers itself, and opens a Jamgate page in your browser.
3. The page asks for your **instance token** — paste your `JAMGATE_TOKEN` and submit. That's the
   only thing it ever asks for, and only once per client.
4. You're connected. `save_memory` / `recall_memory` / `forget_memory` now work from that client.

What happens under the hood (all served by your instance, same origin, no third party):

| Endpoint | Spec | Purpose |
| --- | --- | --- |
| `GET /.well-known/oauth-protected-resource` | [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) | Tells the client where the authorization server is. A `401` from `/mcp` also carries a `WWW-Authenticate` header pointing here. |
| `GET /.well-known/oauth-authorization-server` | [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) | Advertises the endpoints below; PKCE **S256** required. |
| `POST /register` | [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) | Dynamic client registration — the client gets a `client_id`. |
| `GET`/`POST /authorize` | OAuth 2.1 | The consent page that asks for your instance token, then issues a single-use, PKCE-bound authorization code. |
| `POST /token` | OAuth 2.1 | Exchanges the code (+ PKCE verifier) for a long-lived access token (and a refresh token). |

Security: PKCE (S256) is mandatory, redirect URIs are matched exactly (no open redirect),
authorization codes are single-use and expire in ≤60s, and access/refresh tokens are stored
**hashed** in `~/.jamgate/oauth.json` (revoke one by deleting its entry) with the same atomic,
locked writes as the memory store. The `/mcp` endpoint accepts **either** an issued OAuth access
token **or** the static `JAMGATE_TOKEN`, so existing Claude Code connections keep working
unchanged.

### Remote mode limits

These are on top of the [general limits](#honest-limits) above.

- **Whoever holds the token holds the memory.** There are no per-user accounts; the token *is*
  the authentication. Treat it like a password: strong, secret, rotated on suspicion.
- **One instance is one human.** There is no multi-user tenancy, no per-identity isolation, no
  access control. That was a scope decision, and it keeps the security surface down to one
  secret and one store, but if three people each want a memory you run three instances.
- **Concurrency is single-process.** Several agents hitting one instance at once is safe —
  writes take a lock and re-read before writing. That holds for one process on one host. It is
  not a distributed store and will not survive being run twice against the same file.
- **No TLS in the box.** Skip the reverse proxy and you are sending a bearer token in the
  clear. Don't.
- **One memory is one fact, up to 32 KB.** Bigger saves are refused rather than truncated. If
  you want a document remembered, save the conclusion.

## How it compares

There are no benchmark numbers here. This category has had two of them retracted in public
and I am not adding a third from a project with one user. What follows is a capability
comparison, and the rows where Jamgate loses are the ones worth reading.

| | **Jamgate** | **Mem0 / OpenMemory** | **Zep / Graphiti** |
| --- | --- | --- | --- |
| Core model | Rule-based gate in front of a flat file | LLM-extracted memory layer | Temporal knowledge graph |
| Where memory lives | A JSON file on your machine | Hosted platform or self-hosted store | Graph server (self-hosted or cloud) |
| Gate before write | Core design | Partial (dedup/update) | Partial |
| Source-trust hierarchy | Yes | Not that I can find | Not that I can find |
| Refers conflicts back to you | Yes | No | No |
| LLM calls of its own | None | Required | Required |
| Dependencies / infra | 1 runtime dep, no server | SDK + service/DB | Graph DB + service |
| **Retrieval quality** | **Weak.** Fuzzy lexical + optional local embeddings; 10/17 top-1 on my own store | **Better.** Real vector retrieval, reranking, tuned over many deployments | **Better.** Graph traversal plus vector search |
| **Understands what a memory means** | **No.** Regexes, subject matching, cosine thresholds | **Yes.** LLM extraction is the whole design | **Yes.** Entity and relationship extraction |
| **Entity / relationship reasoning** | **None.** Flat records with a `subject` string | Some | **This is what it is for** |
| **Scale** | **Untested past ~100 records.** One file, read whole, no index | Production deployments | Production deployments |
| **Multi-user / teams** | **No.** One instance, one person, one token | Yes | Yes |
| **Language support** | Lexical recall in any script; semantic is **English-only** | Multilingual models | Multilingual models |
| **SDKs** | MCP and a small REST API | **Python, TS, and more** | **Python, TS, and more** |
| **Maturity** | **One developer, one user, seventeen releases** | Funded team, wide adoption | Funded team, wide adoption |
| Best for | One person's cross-agent memory, kept small and current, on their own disk | Application-scale memory with real retrieval | Relationship and temporal reasoning |

The Jamgate column is checked by the test suite and by the measurements in
[`DECISIONS.md`](./DECISIONS.md). The other two are read from those projects' public
documentation as of **August 2026** and describe default behaviour, not the ceiling of what
they can be configured to do. If a row is wrong, open an issue and I will fix it — including
the ones that are unflattering to them.

Short version: if you want the best retrieval, use Mem0. If your memory is really a graph of
people and events, use Zep. Jamgate is worth a look if what you want is one small memory of
yourself that several agents share, on a disk you own, and you care more about it staying
clean than about it being clever.

## Privacy

Your memories are never sent anywhere. There is no outbound request carrying your data, no
telemetry, no accounts, no keys, and nothing talks to a cloud model. The store, the gate and
the embedding model all run on your machine.

Two things do touch the network, both of them downloads and neither carrying your text: `npx`
fetching the package from npm, and — only if you installed the optional semantic package — the
embedding model's first-run download from Hugging Face (~23 MB, then cached). Both stop after
install.

There is also a local decision log. Every gate verdict (saved, duplicate, superseded,
conflict, possible_duplicate, rejected) is appended to a size-capped JSONL file that rotates
on its own and never leaves the machine. I keep it because a future local classifier will need
real examples to be any good. It lives beside the store — `gate.log` in the same directory as
`JAMGATE_STORE`, or `~/.jamgate/gate.log`. `JAMGATE_GATE_LOG` overrides the path and
`JAMGATE_GATE_LOG=off` turns it off. It holds the memory text, so if that bothers you, turn it
off. (It follows the store rather than the home directory so it stays writable under a
hardened systemd unit with `ProtectHome=true`; see D-037.)

## Status

I use this daily, it holds my real memory, and it has not lost a record. That is the strongest
claim I can make honestly. It is not battle-tested, because there has only ever been one
battle.

What works today: the gate itself (rule pre-filter, credential refusal, exact dedup,
time-aware supersession, the source-trust conflict guard), atomic durable writes with locking
and schema migration, fuzzy recall in any script with optional local embeddings on top, the
`setup` wizard for ten clients, and `import --from claude|chatgpt` for moving your memory off
another product. Optional and less exercised: remote mode over HTTP with a bearer token and
MCP OAuth, a small REST API on the same port, and namespaces. Those last three work and are
tested, but I am the only person who has ever pointed anything at them — the local stdio path
is the one that gets used every day.

491 tests on Node 20 and 22, run against a real MCP handshake on both transports. The full
history is in [`CHANGELOG.md`](./CHANGELOG.md), and every non-obvious decision, including the
ones I got wrong and reversed, is written up in [`DECISIONS.md`](./DECISIONS.md).

Next: better recall ranking, a `reindex` command, and a thin LLM classifier for the ambiguous
cases the rules cannot judge. MIT, and I am not trying to make money from it.

## Development

```bash
npm install
npm run build   # compile TypeScript to dist/
npm test        # compile and run the test suite (built-in node:test, no extra deps)
```

CI runs the build and tests on Node 20.x and 22.x for every push and pull request.

## Contributing

The most useful thing you can do right now is install it and tell me what broke, especially
on macOS or Windows, which I have never run. After that: recall ranking, which is the part
I'm least happy with.

[`AGENTS.md`](./AGENTS.md) gets you oriented and [`RULES.md`](./RULES.md) has the detail.
Both are written for an AI agent as much as for a person, since most of this was built with
one.

## License

[MIT](./LICENSE)
