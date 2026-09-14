# Care Loop — MVP consolidation

You are working in an existing repo that already implements most of Care Loop, but it has
grown too complex and the console UI/flow is not demo-ready. **Your job is to simplify to a
smooth end-to-end MVP, not to rebuild from scratch and not to add features.**

Read `docs/HACKATHON_RULES.md` and `docs/call-e-documentation.md` before writing code.
`AGENTS.md` still governs (the port, the consent gate, no real phone numbers, no fake data,
no `--no-verify`, generated migrations only). Nothing in this prompt overrides those.

## The product, in one paragraph

A doctor writes a free-text note after a consultation. An LLM compiles it into follow-up
questions. The doctor edits and approves. CALL-E then calls the patient on schedule, we take
the transcript, an LLM reads it and assigns a severity (**escalating / medium / low**), and
the doctor's dashboard shows — at a glance — who needs a call back today. When the follow-up
run ends the doctor closes the episode with a saved summary; if the same patient returns with
a new issue, the doctor opens a new episode against the same patient record and the old
summary is one click away.

## The four scenarios that must work end to end

1. **New patient.** Multi-step wizard, forward *and* backward navigation, every step editable
   on re-entry, nothing lost when you go back:
   1. Name, age, phone, language, consent — plus the doctor's free-text follow-up note
   2. Escalation notes (what the doctor wants flagged, in their own words)
   3. Schedule: best time to call, timezone, frequency, duration
   4. Compiled questions — shown with provenance, fully editable, add/remove/reorder
   5. Review & approve the plan (one screen, one button)
2. **Calls run and get read.** CALL-E dials on schedule → transcript comes back → LLM triage
   assigns severity + one-line summary + which escalation note it matched → dashboard updates.
3. **Follow-up completes.** The doctor can close the episode; a saved summary of the issue and
   how it resolved lives on the patient record.
4. **Returning patient.** Existing patient, new issue → new note → new plan → new episode,
   with prior episode summaries visible.

## Ground rules for this work (token and scope discipline)

- **Reuse before rewrite.** `lib/plan/`, `lib/script/`, `lib/schedule/`, `lib/triage/`,
  `lib/calle/port.ts` are mostly right. Change them only where a scenario above is broken.
- **Delete is preferred to refactor.** Anything not on the four paths above gets removed, not
  reworked. Say what you deleted and why.
- **No new abstractions, no new config, no new tests except for logic you actually changed.**
- Do not read whole files you don't need. Do not run broad repo-wide greps for context you
  already have. Do not open `docs/` files other than the two named above (the rest are being
  deleted).
- Never claim a step passes without running `pnpm run verify` and reading the output.
- Never place a live call unless I ask for it in that message.

## Phases and checkpoints

Stop at every **CHECKPOINT** and wait for me. Do not continue past one on your own.

### Phase 0 — Docs cleanup
Delete every `.md` under `docs/` except `HACKATHON_RULES.md` and `call-e-documentation.md`.
Keep `AGENTS.md`, `CLAUDE.md`, `README.md`, `skills/care-loop/SKILL.md`. If `CLAUDE.md`/`AGENTS.md`
reference a deleted file, fix the reference. No other edits.
**CHECKPOINT 0:** list what you deleted.

### Phase 1 — Audit (read-only, no edits)
Walk the current console: routes under `app/(console)/`, `components/`, and the schema. Report,
in under one page:
- the actual current navigation graph and where it dead-ends or loops
- which of the four scenarios is broken today, and the single reason each is broken
- the concrete keep / delete list for `components/` and `app/(console)/` (there are ~26
  components and 8 routes — I expect a materially shorter list)
- what schema change, if any, "episodes" needs (prefer: reuse `consultationNotes` +
  `followUpPlans` with a status and a summary column rather than a new table)
- a proposed final route map
Then propose the phase plan for 2–6 as a short checklist.
**CHECKPOINT 1:** I approve the keep/delete list and the route map before you touch anything.

### Phase 2 — Prune and settle the data layer
Delete the agreed dead routes/components. Make the minimum schema change agreed in Phase 1 and
generate the migration with `pnpm run db:generate` (never hand-write SQL). Fix compile errors
from the deletions only — no opportunistic cleanup.
**CHECKPOINT 2:** `pnpm run verify` output, and the app boots via `./start.sh`.

### Phase 3 — The wizard (scenario 1)
One route owning all five steps with a visible stepper, back/next, per-step validation, draft
state that survives navigation in both directions, and a final review screen. Compiled
questions editable in-place. Approve = plan expanded into dated calls.
**CHECKPOINT 3:** I click through it myself, forwards and backwards, on desktop and 390px.

### Phase 4 — Dashboard (scenario 2)
One screen that answers "who do I call back right now": patients ordered by severity, each row
carrying the severity, the one-line summary from triage, which escalation note fired, when the
last call happened and when the next is due. Escalating is the only red on the page. One click
into the patient, one click into the call transcript.
**CHECKPOINT 4:** screenshot + I review.

### Phase 5 — Call → transcript → severity
Verify the real loop with the fake CALL-E server first: dial → webhook → re-fetch → transcript
→ triage → severity on the dashboard. Fix whatever breaks. Triage must fail closed. Confirm a
patient with no answered call still surfaces.
**CHECKPOINT 5:** show me the loop running end to end offline, with the row changing state.

### Phase 6 — Close-out and return (scenarios 3 and 4)
Close-episode action with a saved summary; patient page shows past episodes; "new issue" starts
a new note/plan on the existing patient and pre-fills nothing clinical.
**CHECKPOINT 6:** I walk both flows.

### Phase 7 — UI pass
Run `/impeccable` over the console as one surface (`Operate`). **Do not touch the landing page
— I like it as is.** Stay in the `app/globals.css` tokens and the existing `Badge`, `Button`,
`Panel`, `TopBar`. One batched CDP sweep at 1500px and 390px, fix everything that round shows
in one go, then at most one confirming sweep. Phone numbers stay masked.
**CHECKPOINT 7:** screenshots at both widths.

### Phase 8 — Live call
Only when I say so: one real call to one armed number, end to end, and we watch the severity
land on the dashboard.

## Definition of done

A doctor can, in one sitting: add a patient with a note → see compiled questions → edit them →
approve → watch a call happen → see a severity on the dashboard → open the transcript → close
the episode → bring the same patient back with a new issue. Nothing on that path is a stub, and
anything half-built says so on screen rather than pretending.
