# The database

Nine tables in Neon Postgres, reached through Drizzle. `schema.sql` in this directory is
the DDL dumped from the live database; this file explains what each table is *for* and
why it is shaped the way it is.

**The schema is owned by `lib/db/schema.ts`.** Change it there and run
`pnpm run db:generate` — never hand-write SQL in `drizzle/`, and never edit `schema.sql`
expecting anything to happen.

## Three constraints that shaped all of it

The CALL-E API has no endpoint to list calls, no transactions on the Neon HTTP driver,
and no scheduling API. So:

- **A `call_id` we fail to persist is a call we can never read back.** Every dispatch
  writes its row *before* it dials and stores CALL-E's id the instant `create` returns.
- **Every mutation that could race is a single conditional `UPDATE … RETURNING`**, and
  every derived write is idempotent behind a unique index. There is no transaction to
  roll back into.
- **AfterVisit owns the calendar**, which is why `scheduled_calls` exists at all.

Every enum is a `text` column with a `CHECK`, never a Postgres enum type: adding a value
stays an ordinary migration instead of type surgery.

---

## The tables

### `patients`
Who may be called, and whether they agreed to be.

`ai_call_consent` (`unknown | granted | declined`) is the one column that authorises a
phone to ring. `dial()` refuses anything but `granted`, with a visible reason — a doctor
recording enrolment is the human "press to call" that a manual tool would have, moved
earlier. `unknown` and `declined` are deliberately distinguishable: a patient who
actively refused is not the same as one nobody asked.

`timezone` has no default on purpose. A wrong zone means every call for the life of the
plan lands at the wrong hour, silently. `uniq_patients_phone` is partial on non-archived
rows, so two live patients can never share a number and get phoned twice.

### `consultation_notes`
What the doctor wrote, and how the compiler read it.

`body` is the grounding source: the compiler may not name a medication the note does not
contain. `escalation_note` is the doctor's own wording for what should be flagged, kept
verbatim because it is handed to the triage model as their reference standard.
`compile_provider` and `compile_model` are persisted so which model compiled a note
stays a checkable claim rather than a README sentence. `amended_at` marks a
note added to after the fact.

### `visits`
What the front desk booked, and whether the doctor has got to it.

Registration and consultation are two roles on two screens, and a visit is the hand-off
between them. The desk writes one ahead of time (`kind` is `consultation` or `post_op`,
`visit_date` is a calendar day in the patient's zone, `reported_symptoms` is the complaint
in the receptionist's words); the consult list is every row still `waiting`; writing the
note flips `status` to `seen` and sets `note_id` in one conditional `UPDATE … RETURNING`,
so the two facts cannot disagree and a second tab loses cleanly. `reported_symptoms` is
context for the doctor and deliberately **not** a grounding source: the compiler is
grounded against the note alone, at compile time and again before dialling, so a
medication named only here would be refused the moment a call was due.

### `follow_up_plans`
One episode of follow-up. A "course of treatment", and the closest thing to an episode
entity — there is no separate table, because an episode *is* a note plus a plan.

`status`: `awaiting_approval → active → paused → completed | cancelled`. Since goal-based
calls, `awaiting_approval` lasts only between writing the plan and `startPlan` in the same
request; nothing waits in it for a person.
`provenance` is one JSON map of field name → `note | default | clinician | locked`, which
is what makes the follow-up page's "from your note" / "default" marks trustworthy: defaults
are applied by code, never by the model.

`goal` (migration `0011`) is one sentence saying what the calls set out to find out; it is
the calling agent's goal. Nullable: plans written before it fall back to a fixed default
goal. `watch_points` holds what to find out — `{text, quote, unit}`, at most five, each
quote a phrase the note really contains. `unit` is null unless the note asks for a number,
and then one of a closed list (`TOPIC_UNITS`: celsius, fahrenheit, score_0_10, bpm, kg,
mmol_L, mg_dL, times_per_day — no blood pressure yet, which is two numbers). A call's
findings are stored by position (`topic_1`, `topic_2` …), so amending a note only ever
**appends** topics; it never reorders or rewrites them.

`dropped_topics` (migration `0012`) keeps what the note asked about that the calls will not
follow up — not in the note, not matching its words, refused by the guard, or past the cap —
with the reason, so the follow-up page can say "Not followed up" instead of dropping it
silently.

`start_after_days` (migration `0013`, default 0) is the wait before the first call, from a
note such as "recheck in 3 days". The window opens that many days after the start; with no
length of its own it is one call, and `duration_days` is 1, marked a default.

`result_schema` is the exact CALL-E schema frozen when the plan starts: the fixed keys plus
one nested `topic_n` object per topic, which carries a required `value` string when the
topic has a unit. Without it a superseded plan's older calls become
uninterpretable. Adding a topic mid-course re-freezes it, or the new answer is asked and
discarded.

`closing_summary` is how the episode resolved, in the clinician's words. The calls say
what was asked and answered and `close_reason` says it ended; neither says whether the
patient got better.

`uniq_live_plan_per_patient` is partial on `active | paused`: **one live plan per
patient**, so a double-submitted start or two tabs cannot produce two schedulers dialling
the same person on the same day.

### `plan_questions`
What every call records, with the guard's verdict on each.

For plans started since goal-based calls this holds **only the fixed observations** code
inserts — `reached_patient`, `requests_clinician`, `emergency_language_heard`,
`symptom_change`, `patient_concern`, `something_else_raised`, `goal_covered` — all
`source = 'locked'` and recorded from the call rather than asked. The agent asks about the
note's topics in its own words; those live in `follow_up_plans.watch_points`, not here.
Rows still exist because extraction walks them: a key in the schema with no row is recorded
by the agent and then dropped. Older plans keep their per-question rows.

`guard_status` is per row, and `assembleTask` will not build a task while any is refused.

### `scheduled_calls`
One row per (plan, occurrence, attempt) — the calendar the API does not provide.

Written **before** the dial, because a row that does not exist cannot record the
`call_id` that comes back. `idempotency_key` is `${planId}:o${n}:a${n}` — business-stable,
not a fresh UUID, or a retry would defeat CALL-E's deduplication entirely.

`uniq_call_slot` and `uniq_call_idem` make dispatch idempotent; `uniq_calle_call_id` is
partial and stops one CALL-E call being recorded twice. `outcome` is the single stored
derived value (`answered | no_answer | flagged | unmappable | refused`) and is folded from
whether anyone actually spoke — never from `calle_failure_code`, which has no published
enum and came back `"603"` the one time it mattered.

Never `select *` here: `transcript` is TOASTed jsonb.

### `extracted_slots`
CALL-E's `structuredResult` mapped to typed answers, one row per (call, question).

`status` distinguishes `answered` from `unmappable`, `missing` and `refused`. "The model
could not map this answer" is a real, visible state — never a silent null, and never a
guess at the nearest option. `question_id` deliberately has no foreign key, so answers to
older plans' questions stay readable. Per-topic findings are not slots: they stay on
`scheduled_calls.structured_result` and are read from there.

### `call_triage`
The model's reading of a finished call. One row per call.

`verdict` (`severe | escalate | low`) carries consequences: `severe` pauses the plan,
`escalate` queues it while the follow-up keeps dialling, `low` raises nothing. The UI
renders these as **Escalating / Medium / Low** — a display mapping only, so renaming a
badge can never quietly rename a behaviour.

`status` (`ok | unavailable | error | unparseable`) exists so "the model could not judge
this call" is a fact a clinician can see rather than a null anyone reads as "fine". Every
failure state carries verdict `escalate`: triage **fails closed**.

`matched_concerns` is which of the doctor's own escalating conditions the call touched, in
the doctor's wording. `quote` is one line the patient actually said — evidence, not
summary.

### `escalations`
Work queued for a human. Routing, never a verdict.

`dedupe_key` with `uniq_esc_dedupe` is what makes re-evaluating a finished call free: a
reconcile re-runs the pure engine and re-raises everything it finds, and the second raise
becomes a no-op. `paused_plan` records whether this escalation stopped the follow-up.
`status` is `open → acknowledged → resolved`, and the middle state is the human-in-the-loop
step: without it, a queue of five looks identical whether one has been read or none have.

`severity`, `summary` and `triage_id` are denormalised copies of the triage row so the
queue can be read in one query.

### `tick_runs`
One scheduler pass. `uniq_tick_lease` is partial on `finished_at is null`, so two ticks
cannot run at once — the lease *is* the row.

---

## What is derived and never stored

- **Plan health** (`on_track | drifting | escalated | never_reached | …`) is computed at
  read time in `lib/db/queries.ts`. A stored health value goes stale the moment a patient
  falls quiet, which is the exact failure this product exists to catch.
- **Contact rate, silence, the week band** — all read-time.
- The only stored derived value is `scheduled_calls.outcome`.

## Reading it

`lib/db/` holds every query. `dashboard.ts::getToday()` is the one the console's main
screen calls; `summary.ts::getPatientSummary()` assembles a patient's episode history.
Nothing outside `lib/db/` writes SQL.
