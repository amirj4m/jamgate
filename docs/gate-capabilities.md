# What the gate can and cannot judge today

Input document for the classifier phase (D-004 / RULES §5.3). Written 2026-08-05, after
auditing the real production gate log (76 decisions, 2026-07-21 → 2026-07-27) and the real
store (43 records at audit time).

The purpose is narrow: state exactly which decisions the gate makes today, by what mechanism,
and where a rule-based gate is structurally blind. Every failure class below is named with a
real example from the real log — not a hypothetical.

**Read this first, before writing any classifier code.** Two of the failure classes below are
already solved by cheaper means than a model call, and a classifier that re-solves them adds
cost and latency for nothing.

---

## 1. What the gate decides today, and by what mechanism

There are exactly four mechanisms. Knowing which one produces a given verdict is what tells
you whether a model could do better.

| # | Decision | Mechanism | Where |
|---|---|---|---|
| 1 | too short | **length** — `< 4` characters | `prefilter.ts` |
| 2 | credential | **regex shapes + entropy/keyword** | `secrets.ts` |
| 3 | pleasantry | **fixed word list** (20 entries) | `prefilter.ts` |
| 4 | not a statement | **token count** — `< 2` meaningful words | `junk.ts` |
| 5 | question | **regex** — leading interrogative / trailing `?` | `junk.ts` |
| 6 | transient | **keyword list** + absence of `type` | `junk.ts` |
| 7 | invalid type/source | **enum membership** | `types.ts`, `pipeline.ts` |
| 8 | duplicate | **exact string equality**, normalized | `fileStore.ts` |
| 9 | superseded | **subject string equality** + recency | `fileStore.ts` |
| 10 | conflict | **integer trust comparison** on `source` | `fileStore.ts` |
| 11 | possible_duplicate | **cosine threshold** ≥ 0.88 | `fileStore.ts`, `vector.ts` |
| 12 | related hint | **cosine band** 0.60–0.88 | `fileStore.ts`, `vector.ts` |
| 13 | subject derivation | **7 keyword regexes + one copula pattern** | `subject.ts` |

Grouped by kind:

- **Structural / exact (7, 8, 9, 10):** these are *decidable*. Enum membership, string
  equality, an integer comparison. They are right by construction and a model would only
  introduce error. **Do not route these to a classifier, ever.**
- **Thresholds (1, 11, 12):** a number separates two populations. Correct only insofar as the
  populations actually separate — see §3.1, where they measurably do not.
- **Keyword / regex (2, 3, 4, 5, 6, 13):** a hand-written list stands in for a semantic
  judgment. These are the ones that fail on inputs nobody thought of, and they fail *silently*
  and *asymmetrically* (see §3.2, §3.3).
- **Not implemented at all:** salience. RULES §3 defines "worth keeping" as four
  sub-questions — durable, changes-the-answer, specific, type — and **the gate asks none of
  them.** Anything that is not junk, not a credential, not a question and not transient is
  stored. This is the single largest gap and it is the classifier's actual job.

## 2. What the gate does NOT judge at all

1. **Salience.** RULES §3's criterion is unimplemented. Today the calling agent is the only
   salience filter (RULES §5.2), which is by design — but there is no backstop when the agent
   is wrong, and the audit shows it is wrong in a specific, repeatable way (§3.4).
2. **Whether the `type` is truthful.** The enum is now enforced (D-054) but the *choice* is
   not judged. This produced the largest single failure in the real store: 17 of 39 active
   records expired and invisible because a client filed durable facts as `state` (D-055).
3. **Whether the `subject` is meaningful.** Any non-empty string is accepted. A wrong subject
   silently retires an unrelated memory (§3.3).
4. **Whether the `source` is truthful.** `user-explicit` is self-reported by the agent and
   drives the trust ladder that decides conflicts. Nothing verifies it.
5. **Whether one memory contradicts another** in any sense other than sharing a subject
   string. Two active records may flatly contradict each other and the gate will not notice
   unless the `subject` field happens to match.
6. **Whether a memory is one fact or five.** Granularity is unjudged; see §3.5.

## 3. The failure classes, with real examples

### 3.1 The thresholds do not separate the populations

Already measured and documented in `vector.ts`, and it is the strongest evidence in the repo
that a threshold cannot do this job:

```
0.94  reworded duplicate     "jam builds Jamgate…" / "Jamgate is an open-source MCP server built by jam…"
0.87  same subject, NEW value "uses Windows" / "moved to Linux"     ← must NOT be a duplicate
0.83  reworded duplicate     "prefers dark theme…" / "likes a dark colour scheme…"
0.81  DIFFERENT facts        "jam uses Windows" / "jam uses Linux"  ← must NOT be a duplicate
0.76  reworded duplicate     "lives in Athens, Greece" / "home is in Athens, the capital"
0.67  same subject, NEW value ThinkBook savings "5/10, €640" / "7/10, €768"
```

The "restated" and "changed" populations **overlap**. 0.88 was chosen to sit above the
different-facts ceiling, accepting false negatives at 0.76–0.83. In the real store, 28 active
pairs sit in the 0.60–0.88 band.

**The question a threshold cannot answer, and a model can:** *is this the same fact restated,
or the same subject with a new value?* That is a semantic question about what changed, not a
distance question. It is the highest-value classifier target in the whole system.

### 3.2 Keyword lists are blind to paraphrase — asymmetrically

Two real instances, both found this phase:

```
jam's mysql password is Tr0ub4dor-And-Three            → REFUSED
the password for jam's mysql database is Tr0ub4dor…    → STORED       (D-050, now fixed)
```

One preposition apart. Fixed by widening a regex — which is exactly the treadmill: the next
phrasing nobody thought of walks through too. `secrets.ts` documents its own bind honestly:
precision-first, because a false positive (refusing a real memory) trains the user to work
around the gate.

The transience rule has the same shape. From the real log:

```
2026-07-21T18:49  rejected  "it's raining in Athens right now"     ← caught, keyword "right now"
2026-07-21T16:31  saved     "It is raining in Athens right now and jam said hi."   ← pre-fix
```

**What a model adds:** judging *whether the text asserts a credential / a passing observation*,
rather than matching the words that usually accompany one.

### 3.3 Auto-subject is a 7-rule guess that silently retires real memories

The worst real-data damage in the audit, and it came from `subject.ts`, not from a threshold:

```
07-21T13:11 saved      subject=location  "[profile+career] jam lives in Athens, Greece as an asylum seeker…"
07-21T15:35 superseded subject=location  "[finance] jam's accounting system lives in ~/Documents/accountant…"
07-21T15:35 superseded subject=location  "[profile+career] jam (Amir Ghasemi…) lives in Athens…"
07-21T15:36 superseded subject=location  "[finance-model] jam's bookkeeping lives in ~/Documents/accountant…"
```

Four unrelated memories — an asylum profile, a directory path, a bookkeeping method — all
matched `\b(lives?|living|located|resides?|based)\b` and each retired the one before it. The
survivor was later deleted, so all four facts are gone from recall.

A second live instance found in the same audit: the profile+finance master record carried
subject `email` — derived only because the text contains an email address — so any future
memory saved under subject `email` would have retired the user's entire master profile. (Both
now repaired in the data; D-040 fixed the cause for long/multi-topic text.)

**What a model adds:** *what is this text actually about?* A regex asks "does this text contain
a location-ish word", which is a different question with the same answer often enough to be
dangerous.

### 3.4 Nobody judges the `type`, and the caller gets it wrong in a specific pattern

The single largest failure in the real store. From the log, one session, `Anthropic/ClaudeAI`,
2026-07-25 18:25–18:36, all `type: state` (2-day TTL), all `user-explicit`:

```
saved state efood-payment-structure          ← how the user is paid
saved state income-detail-feb-jun-2026-periods
saved state payment-reconciliations-may-jun-2026
saved state bank-card-loss-june-2026          ← contains a permanent IBAN
saved state insurance-efka-registration       ← contains permanent government identifiers
saved state may-2026-financial-summary
… 14 in total
```

Forty-eight hours later all of them were invisible to recall. **44% of the live store.**

The pattern is legible and mechanical: a client treating `state` as "things from this session"
rather than as RULES §4's volatility layer. D-055 now warns the caller. But a warning is a
nudge, not a judgment.

**What a model adds:** *does this text describe something that will still be true next month?*
That is answerable from the text alone — "AMKA 20050204013" plainly is, "jam is tired today"
plainly is not — and it is not answerable by any rule available today.

### 3.5 Granularity is unjudged, and blended dumps poison everything downstream

```
07-24T08:18 saved (no subject)  "[updates 24 Jul 2026 — supersedes parts of earlier finance/housing/ThinkBook memories] (1) HOUSING: …"
```

The agent wrote the word "supersedes" *in the prose* because it had no structural way to say
it. That record is one of **13 active production records carrying no subject at all** — every
one permanently un-supersedable. And because they blend topics, 28 pairs land in the related
band, generating hints that are noise.

**What a model adds:** *is this one fact or several?* — and, if several, the split. This is
generation, not classification, and is probably a later phase than the first classifier.

### 3.6 Truthfulness of `source` is unverifiable in principle

`source` drives the trust ladder that decides `conflict`. It is self-reported by the calling
agent. A model asked to check it would be asking the same agent that supplied it. **This is
not a classifier target — it is a protocol limitation.** Note it and move on.

## 4. What this means for the classifier phase

Ranked by value-per-call, from the real data:

1. **Restatement vs. new value on the same subject** (§3.1). Highest value; no threshold can
   do it; the gate already knows which pairs to ask about (the 0.60–0.88 band), so the trigger
   set is small, well-defined, and already measured at ~28 pairs in a 39-record store.
2. **Is this durable?** (§3.4). Directly attacks the largest real failure. Answerable from the
   text alone. Cheap: one question, one of four answers.
3. **What is this about?** (§3.3) — subject derivation. Replaces the most damaging guesser in
   the system. Note the asymmetry that `subject.ts` already documents: a *missing* subject is
   safe, a *wrong* one destroys data. The classifier must be allowed to answer "I don't know".
4. **Salience** (§2.1). The formally-specified gap (RULES §3), but the audit found **zero junk
   stored** in real use — the calling agent really is a good filter. Lower urgency than its
   place in RULES suggests.
5. **Credential paraphrase** (§3.2). Real but narrow, and the cost asymmetry runs the wrong
   way: a false positive refuses a legitimate memory. Probably belongs as a *second opinion*
   on near-misses rather than as the primary check.

**Do not route to a classifier:** exact duplicate, supersession-by-subject, the trust
comparison, enum validation. These are decidable and correct today.

**Where the training data is:** `gate.log`, per D-025 — now including reversals (D-056), which
is the correction signal. Be aware of what the corpus is *not*: as of this writing it holds
~95 real decisions from one user, zero of them in a non-default scope, and only four
rejections, all from a single verification batch. **It is nowhere near enough to train on
yet.** The first classifier will have to be prompted, not trained, and the log's job is to
tell you whether it is doing better than the rules — which requires labelling the decisions it
would have changed.

## 5. Honest summary

The gate is a good *bouncer* and a poor *judge*. It reliably refuses things that are obviously
not memories, and it reliably handles the structural work — dedup, recency, trust, scoping —
which is genuinely the hard engineering and is correct today. What it cannot do is answer any
question of the form "what does this text mean": is it durable, is it about the same thing as
that one, is it one fact or five, is it a restatement or an update.

Every failure class in §3 is an instance of that one gap. The classifier is not an
optimization on the current design — it is the missing half of it, exactly as RULES §5.3 said
in the first place.
