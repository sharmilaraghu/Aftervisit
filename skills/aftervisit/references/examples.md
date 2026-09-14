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
| `goal` | Find out whether she is taking the metformin and tolerating it. | note |
| topic 1 | whether she is taking the metformin | **note** — "she is taking it" |
| topic 2 | how she is tolerating it | **note** — "tolerating it" |
| `durationDays` | 7 | **note** — "daily for a week" |
| `cadence` | daily | **note** |
| `localTime` | 10:00 | **default** — the note never says a time |
| `maxAttempts` | 3 | **default** — never offered to the model at all |

The doctor sees "default" against the time and the retry ladder, and nothing
else. Had the note not said how long, the length would read "default" too — 7
days, filled by code. That mark is only honest because `localTime` was nullable in the compiler's
schema and a pure function filled it afterwards.

**Grounding:** `metformin` appears in the note, so a call may name it. Had the
model produced `insulin`, the compile would have been refused outright — not
warned about.

**Red flags:** the condition list ships with `vomiting`, `can't keep water down`
and the universal set. The compiler additionally proposes `cannot keep fluids
down` from the note itself; it renders marked as an addition and the doctor can
delete it.

## What the call is told to find out

The task carries the goal and the two topics under WHAT TO FIND OUT. The agent
asks about each in its own words — one short, neutral question at a time, never
leading — inside a fixed frame: the AI disclosure, the identity check, the stop
for anything urgent or a request for the care team, the refusal to advise.

Nothing about the wording is left to trust. The goal and each topic passed
phase 1 when the note was read, and a topic whose quote is not in the note is
dropped. What the agent actually said is checked in phase 3.

What comes back is typed: fixed keys (`reached_patient`, `requests_clinician`,
`emergency_language_heard`, `symptom_change`, `patient_concern`,
`goal_covered`, …) plus `topic_1` and `topic_2`, each `{answer, patient_words,
clarity}`. A topic that asks for a number — a temperature, a pain score — also
carries `value`, and its unit comes from a closed list, never free text. The
value is kept only when it is a plain number from a clearly answered topic and
inside a plausible range; "about 38, I think" stays in the patient's words.

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

Seven occurrences, one per calendar day, materialised the moment the doctor
starts the follow-up. The doctor
sees all seven dated rows before anything is dialled — which is the point: the
calendar is the artifact, not a promise about one.

## What "seven days" means

Seven **calendar days from the start**, not seven answered calls. A day nobody
picks up still consumes a day. The follow-up page says so, because a clinician
would otherwise reasonably assume the plan keeps going until it gets seven
answers.

The asymmetry that follows:

- a **new occurrence** may not be scheduled past the end date;
- a **retry** may land after it, because it belongs to a day inside the window.

## A wait is not a length

"Recheck in 3 days" is one call on day 3: a wait of three days, and a length of
one day filled by code and marked a default. "For 3 days" is three calls from
the next call time. The wait counts only when the word governs the number — "Day
3 after surgery" is a day since the operation, not a wait — and a wait quoted
with the same words as the length is refused, because a wrong wait pushes every
call past the days the doctor asked for.

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
