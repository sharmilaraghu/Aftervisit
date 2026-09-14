# MVP consolidation — what changed

One session, seven phases, six commits on top of `787e008`. Net **45 files, +4,256 /
−3,323**. `pnpm run verify` green throughout: 263 tests, clean typecheck, clean lint.

The job was to cut the console down to the four demo paths — enrol a patient with a note,
watch calls run and get triaged, close the episode, bring the patient back — and to delete
rather than rework anything off them.

---

## The commits

| | |
|---|---|
| `19f7463` | Prune the console to the four demo paths |
| `0037320` | Rebuild the dashboard as Today, one severity-ordered list |
| `b1c5b8a` | One wizard route for writing a follow-up |
| `c4e5e68` | **Fix: the retry ladder never scheduled a single retry** |
| `3f415e4` | Close an episode with a summary, and amend one still running |
| `54b2196` | **Fix: the roster was printing dark ink on the dark bench** |

---

## Two real bugs found

**The retry ladder had never worked.** `make_interval`'s `mins` parameter is an integer;
`scheduleRetry` passed `retry_delay_minutes::float / time_scale`, a double. Postgres
matched no function and refused the statement with `42883` — every time, since the day it
was written. `completeCall` runs inside the tick's per-call `try/catch`, which exists so
one bad row cannot fail a whole run, so nothing surfaced: counters read `finished: 1`, no
error logged, no second attempt inserted.

That is the product's core mechanism. A patient who does not pick up was meant to be tried
three times before anyone concluded they had gone quiet; instead attempt one was the only
attempt, and "every attempt went unanswered" fired on a single unanswered call. Fixed with
`secs`, which takes a double and also keeps the demo clock honest at 1440×.

The pure test suite could never have caught it — it has no database, so that SQL never ran.
It surfaced only by running the whole loop offline against the fake server.

**The roster was unreadable.** `RosterTable` prints dark ink and got its light ground from
the `RosterGroups` wrapper deleted in Phase 2. The header band kept its own background, so
the table looked deliberate while every patient name under it was invisible on the dark
bench. Found by looking at the rendered page; HTTP 200s had been passing all along.

---

## Routes

8 console routes became 6, plus the wizard.

```
/                     landing (Persuade surface; copy-accuracy pass only)
/dashboard            "Today" — every patient ordered by severity
/patients             roster
/patients/[id]        record · episode history · call log · amend · close
/patients/[id]/edit   demographics
/plan/new             THE WIZARD, five steps, one route
/plans/[id]           redirects to /followups/[patientId]#plan (see "Goal-based calls" below)
/calls/[id]           transcript + triage
```

**Deleted:** `/patients/new`, `/patients/[id]/new-plan` (two ways into a plan, both
redirecting to a third route to finish — crossing that redirect is what made backward
navigation impossible), and `/escalations` (a queue with no nav entry; it folded into
Today).

**Deliberate narrowing:** a patient can no longer be created without a note. Every one of
the four scenarios starts with one.

## Components

27 → 18. Deleted: `Fortnight`, `LiveWeekBand`, `ParameterBand`, `PatientCorrections`,
`UnarchivePatient`, `EscalationCard`, `ListFilter`, `RosterGroups`, `NoteComposer`.
Added: `Wizard`, `Stepper`. `AmendNote` was deleted in Phase 2 and restored in Phase 6.

Library follow-on: `lib/db/parameters.ts` deleted entirely; `getFortnight`,
`getWeekSummary`, `getActivity`, `getResolvedQueue`, `archivePatient`/`unarchivePatient`
removed. Archive went as a **pair** — removing only the undo would have made archiving a
one-way trap a code comment says was deliberately fixed once.

---

## The wizard (scenario 1)

`/plan/new` owns all five steps.

Steps 1–3 are panes of **one `<form>`**, switched with `hidden` and never unmounted — an
unmounted input is absent from the submission, which would silently revert a timezone the
doctor had already set, and there is no session to keep a half-written note in between two
routes. Back-navigation therefore loses nothing because the fields were never gone.

Steps 4–5 render on the server because they need the compiled questions, which do not
exist until the form is submitted. That seam is the only one: before it nothing is
written, after it the draft *is* the plan. Stepping back into 1–3 opens the saved values
and updates in place — except a changed note, which cancels the draft and compiles a fresh
one, because questions compiled from a note since rewritten would claim a provenance they
no longer have.

`updatePlanDraft` now takes **partial** fields and marks provenance only for what it was
given. Step 3 offers "From the note" on every schedule control, and writing all five on
every save would have relabelled the compiler's inference as the doctor's choice the moment
they walked past the step — which is exactly what the "Defaulted" mark exists to
distinguish. Verified: a plan compiled with `localTime` and `durationDays` as `clinician`
and `cadence` left as `note`.

`?patient=` is the returning patient: record prefilled, nothing clinical carried.

## Today (scenario 2)

Seven queries and four panels became one severity-ordered list. `getToday()` returns one
fully-populated row per patient — severity, the model's one-line summary, which of the
doctor's escalation notes matched, the patient's own words, last call, next due, silence —
so the page renders rather than synthesises.

`lastCallAt` is deliberately not the roster's `lastHeard`: `lastHeard` is the last time
somebody *answered*. A patient dialled three times into silence has a recent last call and
no last heard, and the gap between them is the failure this product exists to catch.

Every patient appears, not every escalation — a patient nobody has reached has no
escalation to their name and is exactly who the page must not lose.

Severity is a **display mapping**, not a migration: `severe | escalate | low` stay stored;
`SEVERITY_LABEL` is the one place they become Escalating / Medium / Low.

## The call loop (scenario 5, verified offline)

Ran end to end against `lib/calle/fake-server.ts` with the port injected and
`CALLE_API_KEY` deleted from the process — no real call was placed and none could be.
Dial → transcript → extraction → the pure floor → triage → escalation → severity on Today,
with **"Matched your note: Dizziness on standing, or any fainting"** landing on the row.

Triage **fails closed**: with no model configured it returns `unavailable` / `escalate` —
never `low` — with a reason a clinician reads.

The fake server needed fixing first: it returned `call_fake_1` for every call, so
`uniq_calle_call_id` refused the second row of any multi-patient tick. Ids are now distinct
per call with a per-instance token.

## Episodes (scenarios 3 and 4)

`follow_up_plans.closing_summary` is the session's **one schema change** (migration
`0006_sour_shockwave`, one additive column). Closing asks how it resolved and prints it
against the episode. Ending a follow-up from the queue carries the note written there
through as the same fact rather than asking twice.

**Amending a live plan** was restored on request. A patient reviewed mid-course who needs
one more thing watched is not a new episode: a second plan would dial them twice a day and
cannot exist anyway (`uniq_live_plan_per_patient`). The addition appends to the note the
questions were compiled from, the merge is strictly additive, and the result schema is
re-frozen or the new question is asked and its answer discarded. Verified: 6 questions → 9,
none rewritten, `ankle_swelling` in the frozen schema, plan still `active`.

## Goal-based calls (supersedes the plan review and the question list)

The doctor's job shrank to writing the note and pressing **Save and start follow-up**.
`consultAction` reads the note (`compileNote`), writes the plan, marks the visit seen, and
runs `startPlan`, which expands the calendar at once — a start whose every call today has
already passed begins tomorrow instead of refusing. A note that cannot be read (no model,
ungrounded) starts nothing and the form says why. Then one bounded tick, and a redirect to
`/followups/[patientId]?started=1`.

The parser no longer writes questions. It returns a `goal`, up to five things to find out
(`watchPoints`, each with the note's own words, checked with `groundedPhrase` and guard
phase 1 — a topic that fails either is dropped, never asked) and the schedule with quotes.
Code fills the gaps: 7 days, daily, 10:00, 3 attempts. The call task (`assembleTask`)
carries the goal and topics under WHAT TO FIND OUT; the agent phrases its own questions
inside the unchanged safety frame, and phase 2 masks the goal and topics as vetted text.

Every call now uses one fixed result schema plus a nested `topic_n` object per topic.
`consent_given` is gone (consent is enrolment). `unmappable_response` fires once, when a
reached call's `goal_covered` is none, unknown or missing — per-slot `unknown` on the
observations no longer routes routine calls to a person.

Removed: the plan review page, `QuestionEditor`, `PlanReview`, the coverage and anchors
modules, question CRUD, and the "Plans to review" band. Amending a running follow-up
replaces the goal and appends new topics, never rewriting existing ones — a call's findings
are stored by topic position. Migration `0011` adds `follow_up_plans.goal`.

A safety review then tightened the parse and the floor. `inspectFindOut` screens the goal
and every topic — advice and reassurance, anything that directs the calling agent (what to
skip, say or ignore, the urgent check), line breaks, and text over 200 characters — both
when the note is read and again in `assembleTask`. A topic whose text shares no meaningful
word with its own quote is dropped as unrelated. Dropped topics are kept with their reason
(migration `0012`, `dropped_topics`) and listed on the follow-up page as "Not followed
up". A note with no topic kept and only the default goal starts nothing. The floor no longer
trusts the agent's `goal_covered` alone: a reached call with topics and no clear answer
escalates. Plans from before goals are refused at dial time with a visible reason, and a
start that loses a race restores the plan it had superseded.

**A wait before the first call.** The parser returns `startAfterDays` with its quote.
`quoteSaysDelay` accepts it only when the delay word governs the number — "in 3 days",
"after three days", "2 days from now" — so "Day 3 after laparoscopic cholecystectomy" (a
real note) and "for 3 days" are never read as a wait, and a wait quoted with the same words
as the length is refused. With no stated length a wait is one call (`durationDays` 1, a
default). `expandPlan` takes `startOffsetDays`; `startPlan` uses the wait, and a day more
when that keeps more calls because today's time has passed. Migration `0013` adds
`follow_up_plans.start_after_days`. The notice reads "one call, 3 days from now (from your
note)".

**Measured values.** A topic may carry a unit from `TOPIC_UNITS` — a closed list, because
the unit's label is written into the task. Its result object gains a required `value`, and
the task asks for "the single number … never convert or estimate". `extractFindings` keeps a
value only when it is digits, the topic was answered clearly, and it sits inside `UNIT_RANGE`;
triage sees it, and the follow-up page shows it large ("3/10").

## Design pass

Two batched CDP sweeps at 1500px and 390px across seven routes, one confirming sweep. No
horizontal page scroll, no console errors. Beyond the roster fix: the wizard's schedule
step became a real two-column grid (`auto-fit` had fitted three columns and orphaned the
fourth field); the call page's 1,200-word agent script moved behind a disclosure (the page
had been 7,200px tall); the triage reason is dropped when it restates the summary.

Landing page, two factual errors fixed: "**three** escalation rules" is four, and "a pure
rule engine escalates — **no model required**" was the architecture before triage and is
now the opposite of the truth.

---

## Known gaps

- **Phase 8, the live call, has not run.** The allowlist is closed by default; a live
  run lists one owned number in `AFTER_VISIT_CALL_ALLOWLIST`. `docs/TESTING.md` has the scripts.
- **`AFTER_VISIT_WEBHOOK_TOKEN` is unset**, so `/api/calle/webhook` returns 503 and refuses
  everything. Correct fail-closed behaviour, but the webhook path is unproven end to end;
  completion currently relies on the in-process waiter and the reconciler.
- **`OPENAI_API_KEY` is empty**, so the Gemini fallback has nothing to fall back to.
  Gemini returned 503 twice during this session.
- **The seed has no escalation notes**, so `matched_concerns` only appears for patients
  created through the wizard.
- Parked deliberately: parameter history, archive/unarchive, the fortnight chart, resolved
  escalation history, patients without a plan, a `closed_by` column (`closePlan` writes the
  closer's name into `resumed_by`), and auth.
