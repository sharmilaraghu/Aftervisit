---
name: care-loop
description: Compile a clinician's free-text note into a structured, reviewable follow-up plan, then run it as autonomous phone calls with CALL-E — scheduling, retries, typed extraction, and rule-based escalation to a human. Use when building clinical or high-stakes follow-up where an uncertain answer must reach a person rather than be guessed.
---

# Care Loop

A pattern for making an outbound calling agent own a **workflow** rather than a
conversation. The differentiator is not that an AI can phone someone; it is that
the calendar, the retries, the escalation and the resolution are all things you
can look at.

## When to use this

Reach for it when all of the following are true:

- someone must be contacted repeatedly over days, not once;
- the answers are typed, not free-form — you need slots, not a summary;
- an answer nobody can map must reach a human rather than be guessed at;
- the party being called never logs in, and is owed consent and a way out.

Clinical follow-up is the worked example. Post-discharge checks, medication
adherence, trial compliance, safeguarding check-ins and welfare calls all share
the shape.

## The four laws that come from the CALL-E API

These are properties of the API, verified against the SDK, and each one forces a
design decision. Any agent built on CALL-E inherits them.

1. **No endpoint lists calls.** A `call_id` you fail to persist is a result you
   can never read back. Write the row *before* dialling and store the id the
   instant `create()` returns, before any wait.
2. **No mid-call tool calling.** Everything the agent may say has to be inlined
   into the task text up front. Anything absent cannot happen mid-call, so it
   must be deferred to a human rather than improvised.
3. **No transactions** on an HTTP Postgres driver. Every racy mutation becomes a
   single conditional `UPDATE … RETURNING`; every derived write is idempotent
   behind a unique index.
4. **No scheduling API.** `CreateCallInput` is `{task, recipients, resultSchema,
   metadata, webhookUrl}` — no `scheduledAt`, no retry policy. **Owning the
   calendar is forced by the API, not chosen.**

## The pipeline

```
free-text note
  → compile     strict schema; every defaultable field NULLABLE
  → defaults    provenance stamped in code: note | default | clinician
  → grounding   refuses any medication not present in the note
  → guard       phase 1, per question, unmasked
  → review      defaults visibly marked; a human edits and approves
  → expand      one dated row per occurrence; timeScale applied ONCE
  → tick        reconcile → atomic claim → guard → dial → persist id
  → extract     structuredResult → typed slots; unmappable is a real status
  → engine      PURE rule evaluation; escalate on any hit
  → queue       a human sees the rule, the reason, and the caller's own words
```

## The five rules worth copying

**1. Every defaultable field is nullable, and code fills the nulls.**
Tell the model "return null if the note does not state this; never infer". Fill
the nulls in a pure function afterwards and record which branch you took. This
is the only thing that makes a "Defaulted" mark in a review UI trustworthy —
otherwise the model can claim a value came from the source when it did not.

**2. A pure function sets the floor; the model reads on top of it.**
Keep the evaluator free of IO, clocks, models and randomness — inject `now` — and
let it be the thing that *raises* the escalation. A model on top can add the
severity and the summary, as long as it fails closed. "No escalation depends on
a model answering" then becomes a claim someone can check by reading one file,
rather than a slogan.

**3. Null is a signal, not an absence.**
Distinguish three states: not fetched yet, returned null (**unmappable**), and
key absent (**missing**). A jsonb column cannot tell the first two apart, so
store an explicit status. Conflating them either loses the escalation entirely
or fires it on every in-flight call.

**4. A refusal is a visible row, never a silent skip.**
When an autonomous dialer declines to call — number not allowlisted, guard
violation, missing key — write the reason where a human will see it. Silence is
indistinguishable from success.

**5. The allowlist replaces the human "press to call" button.**
A scheduler dials with nobody watching, so the gate has to live in code. Treat an
absent allowlist as empty, never as permission. Fail closed.

## Safety

An autonomous dialer has no human at the moment of the call, so every gate a
manual tool gets for free has to move into code. `references/safety.md` is the
full list — explicit intent, E.164, masking, credentials, visible schedules,
idempotency, cancellation, and the boundaries around medical, legal, financial
and emergency content — with the incident behind each rule.

The three that are least obvious:

- **The guard runs in three phases and the ordering is load-bearing.** Phase 2
  exempts approved questions, so phase 1 must inspect each question unmasked
  *before* it can be approved — otherwise listing a rejected question launders it
  past the check that rejected it.
- **The guard is bidirectional.** A script *missing* the AI disclosure, the
  emergency stop, the non-advice statement or the emergency handoff fails.
  Absence is a violation.
- **Everything fails closed.** A model that times out queues the call for review;
  an absent allowlist is empty, not permissive; a refusal is a visible row with
  its reason in words.

## Examples

`references/examples.md` works three shapes end to end, from real calls:

- **New medication** — tolerance and adherence after a new prescription, and what
  a "Defaulted" mark has to be built on to be honest.
- **Post-discharge** — a week of daily checks; why "seven days" is calendar days
  and not seven answered calls.
- **Silence** — what nobody answering looks like, the retry ladder, and the bug
  that makes an unmappable-answer rule fire on a call nobody picked up.

## What this pattern refuses to do

- give advice, diagnose, or reach a clinical conclusion;
- guess an answer to keep a loop closed;
- weaken a safety gate to make a demo smoother;
- dial a number that was not explicitly armed.
