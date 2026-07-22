---
name: memory-discipline
description: Work well with a shared Jamgate memory. Recall before answering anything about the user or their projects; save granular, standalone, durable facts one at a time, each with a specific dotted subject; never store secrets or transient chatter; and treat the gate's verdicts (duplicate, rejected, possible_duplicate) as correct answers, not errors to retry.
---

# Memory discipline (Jamgate)

Jamgate is a shared, cross-agent memory **gate, not a store**. What you save is read
back verbatim into every future session, on every device, and synced to the remote.
So save deliberately, and let the gate do its job. It exposes three tools:
`recall_memory`, `save_memory`, `forget_memory`.

## 1. Recall before you answer

At the start of a session, and **before answering anything about the user or their
projects** (preferences, setup, status, history), call `recall_memory` first. It is
cheap and it is the whole point of a shared memory — do not answer from assumptions
when the store may already hold the fact.

```
recall_memory { query: "editor preferences" }
recall_memory { query: "" }        // empty query → most recent memories
```

## 2. One fact per save — granular and standalone

Each `save_memory` call stores **one fact that makes sense on its own**. Never dump a
pasted profile, a multi-paragraph doc, or several unrelated facts in one call. A blob
gets one subject and behaves as one memory: later updates collide, and the gate can
only guess what a 1000-character dump is "about" (it will decline to guess and leave
it un-supersedable).

- ❌ `save_memory { text: "jam lives in Athens, uses Linux, is building Jamgate, prefers dark themes, banks with..." }`
- ✅ four separate saves, each with its own subject (below).

## 3. Always pass a specific `subject`

`subject` is dotted lowercase describing what the fact is about
(`editor.theme`, `location.city`, `project.jamgate.status`, `laptop.savings`).
**Subject equality drives time-aware supersession**: a new memory with the same
subject replaces the old one. So:

- **Updating a tracked value** (a status, a balance, a current choice, a progress
  figure) → reuse the **exact same subject string** the earlier memory used, with new
  text. Different spelling reads as a different topic and both stay active.
- If you omit `subject`, the gate derives a best-effort one and declines on long or
  multi-topic text — so passing it yourself is always better.

```
save_memory { text: "jam's ThinkBook savings: 5/10, €640", subject: "laptop.thinkbook.savings" }
// later, same counter, new value → SAME subject:
save_memory { text: "jam's ThinkBook savings: 7/10, €768", subject: "laptop.thinkbook.savings" }
```

- ❌ updating status under `project.status.new` when the old one was `project.status` → two live facts.
- ✅ reuse `project.status` verbatim → the old one is retired.

## 4. Choose `type` honestly

- `identity` — who the user is (durable).
- `preference` — durable likes/settings.
- `project` — work that lasts weeks/months.
- `state` — **short-lived** info; this is the ONLY correct home for anything transient.

Transient "right now" notes ("it's raining in Athens") are refused **unless** you give
them `type: "state"`, so its TTL can age them out. Don't file a weather report as a
permanent fact.

## 5. Set `source` truthfully

- `user-explicit` — only when the user actually said "remember this" / "save that".
- `user-confirmed` — the user confirmed a fact you surfaced.
- `agent-inferred` — your own conclusion (the default).

The gate trusts these differently and may return a **conflict** for the user to
resolve. When it does, **surface the conflict to the user — don't silently hide or
overwrite.**

## 6. Never send secrets

Do not attempt to save API keys, tokens, passwords, or other credentials — not even
"just this once". The gate refuses them and redacts them from its log, but the right
move is to **never send them in the first place.** A secret in a shared memory fans out
to every session and device.

- ❌ `save_memory { text: "jam's OpenAI key is sk-abc123..." }`
- ✅ `save_memory { text: "jam stores API keys in 1Password", subject: "tools.secrets-manager" }`

## 7. Respect gate verdicts — they are answers, not failures

- **`rejected` / `duplicate`** → correct outcome. Do **not** retry, reword, or force it.
- **`possible_duplicate` / a related-memory hint** → the save resembles an existing
  memory. **Check whether it's the same tracked value.** If so, re-save using the
  **existing memory's subject** (supersede it) instead of piling up a variant. The gate
  hands this back to you because only the conversation knows if "5/10" and "7/10" are
  the same counter — it can't. Answer that question; don't ignore the hint.

## 8. Forgetting

`recall_memory` prints each memory's id on its own final line as `id: <uuid>`. To
delete, pass that id **exactly** (or an unambiguous prefix of **8+ characters**) to
`forget_memory`. Strip any copy noise (quotes, commas, backticks).

```
forget_memory { id: "3f9a8c2e" }   // 8-char prefix is enough
```

---

**In one line:** recall first, save one durable standalone fact at a time with a
specific reused subject, honest type and source, never a secret, and trust the gate
when it says no.
