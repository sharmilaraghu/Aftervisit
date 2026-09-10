# Worked examples

Three shapes of follow-up, written from calls that actually happened. Each shows
what the note compiles into, what the caller hears, and where the pattern earns
its keep.

---

## 1 · New medication — tolerance and adherence

The commonest shape: a drug started today, and a week of daily checks that it is
being taken and tolerated.

## The note

> Asha K, 54. Started metformin 500mg BD today for newly diagnosed type 2
> diabetes. Counselled on GI side effects. Follow up daily for a week — I want to
> know she is taking it and tolerating it. Escalate to me same day if she reports
> vomiting or cannot keep fluids down.

## What compiles out of it

| Field | Value | Provenance |
|---|---|---|
| `reason` | New metformin · tolerance and adherence | note |
| `durationDays` | 7 | **note** — "daily for a week" |
| `cadence` | daily | **note** |
| `localTime` | 10:00 | **default** — the note never says a time |
| `maxAttempts` | 3 | **default** — never offered to the model at all |

The doctor sees "Defaulted" against the time and the retry ladder, and nothing
else. That mark is only honest because `localTime` was nullable in the compiler's
schema and a pure function filled it afterwards.

**Grounding:** `metformin` appears in the note, so a call may name it. Had the
model produced `insulin`, the compile would have been refused outright — not
warned about.

**Red flags:** the condition list ships with `vomiting`, `can't keep water down`
and the universal set. The compiler additionally proposes `cannot keep fluids
down` from the note itself; it renders marked as an addition and the doctor can
delete it.

## What the call asks

1. "Have you been able to take it as prescribed since we last spoke?" → yes / no
2. "Any side effects or new symptoms — would you say none, mild, moderate or
   severe?" → one of `none, mild, moderate, severe`
3. "Would you like someone from the care team to call you back?" → yes / no

Each is inspected unmasked before it can enter the script.

## Day 3

> "I threw up twice yesterday and I couldn't keep water down."

The floor does not have to understand her to route her: the transcript carries
emergency language, which is one of the four conditions the pure evaluator checks.
On top of it the model reads the call and returns `severe`, and severe pauses the
plan. The clinician's queue then shows the rule that fired, the model's one-line
reason, and that sentence verbatim.

Either half alone is enough to route her. That is the point of having both: a
model outage cannot silence a caller who used those words, and a floor of four
conditions was never going to grasp what she meant.

Note what did *not* happen: nothing concluded anything about Asha. The agent did
not say this sounds like a side effect, did not suggest stopping the drug, and
did not reassure her. It routed.


---

## 2 · Post-discharge — a week of daily checks

## The note

> Daniel O, 67. Day 2 post inguinal hernia repair. Wound clean and dry on
> discharge. Daily wound check for a week — redness, discharge, fever.

## The shape

Seven occurrences, one per calendar day, materialised at approval. The doctor
sees all seven dated rows before anything is dialled — which is the point: the
calendar is the artifact, not a promise about one.

## What "seven days" means

Seven **calendar days from approval**, not seven answered calls. A day nobody
picks up still consumes a day. The review screen says so, because a clinician
would otherwise reasonably assume the plan keeps going until it gets seven
answers.

The asymmetry that follows:

- a **new occurrence** may not be scheduled past the end date;
- a **retry** may land after it, because it belongs to a day inside the window.

That is one missing `WHERE` clause between the two insert paths, and it is worth
writing a test for.

## Timezones

`patients.timezone` is NOT NULL with **no default**. A `default 'UTC'` is exactly
how "10:00" silently becomes the server's 10:00 and drifts an hour when the
clocks change. Compute each occurrence as a local wall-clock time in the
patient's own zone, then convert to a UTC instant — so a plan spanning a
daylight-saving change still calls at 10:00 on both sides, and the UTC instants
are deliberately *not* evenly spaced.


---

## 3 · Silence — what nobody answering looks like

The failure this pattern exists to catch: someone quietly stops engaging and
nobody notices for a week.

## What CALL-E gives you

A no-answer is **a failed attempt with `failure_code: "no_answer"`** — a real
signal from the API, not something to infer from an empty result. `structuredResult`
comes back `null`.

## The retry ladder

Attempts are created **lazily**: attempt 2 exists only because attempt 1 actually
failed. Materialising the whole ladder up front would put rows on screen for
calls that will probably never happen.

```
attempt 1  no_answer  →  attempt 2 scheduled  (+ retryDelayMinutes)
attempt 2  no_answer  →  attempt 3 scheduled
attempt 3  no_answer  →  no_answer_exhausted  →  queue
```

Each insert is `ON CONFLICT DO NOTHING` on `(plan_id, occurrence, attempt)`, so
two schedulers racing to create the same retry produce one row and exactly one of
them dials.

## The bug worth knowing about

When nobody answers, **every** slot comes back `missing`. If your "answer could
not be mapped" rule fires on missing slots without checking whether anyone was
actually reached, it raises once per question and urgently pauses the plan on the
*first* unanswered call — before the retry ladder makes its second attempt.

Silence is not an unmappable answer. Gate the unmappable rule on `reached`, and
let a separate rule own exhausted attempts.

## Making the demo honest

Point the retry demo at a second line that genuinely never answers, and let the
ladder run for real. Do not seed fake `no_answer` rows: the one beat in the demo
that proves the agent notices silence is worth the ninety seconds it takes.
