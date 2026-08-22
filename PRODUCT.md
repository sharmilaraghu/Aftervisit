# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — a clinician or practice nurse at a small clinic.** They are at a desk the day
after a consultation. Their job is to know which patients are drifting, without working a
recall list by phone. They are the clinical author of everything the agent says: they write
the note, they approve the plan, and they are the only party permitted to make a clinical
decision.

**Named in demo fixtures:** "Dr Rao" at "Bridgeview Family Practice". Both are fictional.

**Patients are subjects, not users.** They are phoned. They never log in, never see the
console, and are never asked to operate anything. What the product owes them is consent, an
AI disclosure, an emergency handoff, and a human who reads what they said.

**Secondary, and factual for this build — hackathon judges.** They meet the console cold,
via a deployed URL, with no narration and no onboarding. This is a real audience with a real
constraint, not a hypothetical.

## Product Purpose

A doctor writes a free-form note after a consultation. Care Loop **compiles** it into a
structured, reviewable follow-up plan; the doctor approves it in one click; and the agent
then owns the whole workflow — scheduling, dialing, extracting typed answers, retrying,
escalating — until the patient resolves or a clinician takes over.

The failure mode this product exists to catch: **a patient who quietly stops engaging and
nobody notices for a week.**

Success is that the drift is visible on day two instead of day seven, and that a clinician
spent no time dialing to find it.

## Positioning

The differentiator is **not** "an AI that calls patients". It is that the agent owns the
**workflow**, not just the conversation. A plan expands into dated rows you can see, a tick
moves them, a pure rule engine decides, a queue collects.

That position is forced by the API rather than chosen for flavour. CALL-E exposes no
scheduling endpoint — `CreateCallInput` is `{task, recipient(s), resultSchema,
recipientResultSchema, metadata, webhookUrl}`, with no `scheduledAt` and no retry policy. So
**Care Loop owning the calendar is a consequence of the API, not a design flourish.** A
neighbouring product built on the same SDK cannot truthfully claim otherwise without also
building the calendar.

Second, checkable claim: **the model translates, the rule engine decides.** Escalation is
never model judgment, because the evaluator is pure — no IO, no clock, no model, no
randomness.

## Operating Context

**The pipeline, as a factual workflow:**

```
doctor's free-text note
  → compile      strict schema; every defaultable field nullable
  → defaults     provenance stamped in code: note | default | clinician
  → grounding    refuses any medication not present in the note
  → guard        phase 1, per question, unmasked
  → review UI    defaults visibly marked; the doctor edits and approves
  → expand       one dated scheduled_calls row per occurrence
  → tick         reconcile → atomic batch claim → guard → dial → persist call id
  → extract      CALL-E's structuredResult → typed slots; unmappable is a real status
  → engine       pure rule evaluation; escalate on any hit
  → queue        a clinician sees the rule, the reason, and the patient's own words
```

**Three honest tick triggers, one function:** page load on console pages; `POST /api/tick`
behind `CARELOOP_TICK_TOKEN` for a real cron; a client poller. A self-perpetuating
`after()` + `setTimeout` chain was explicitly rejected — it looks like a background worker,
dies silently with the process, and reads as a lie the moment a judge asks.

**The demo clock is real, not simulated.** A persisted `timeScale` on the plan (1 = real
time, 1440 = one clinical day per minute) is applied **once, at expansion time**. Everything
downstream sees real timestamps; the mechanism under demo is byte-identical to production.

**The evaluation scenes are three, all confirmed:** a ~3 minute demo video recorded against
the running app; a public deployed URL judges click into unaccompanied; and stills in the
submission PR and README that must read without narration.

**Submission context:** the *CALL-E: Your Code Is Calling* hackathon — a PR to
`CALLE-AI/awesome-phone-call-agents`, plus a Devpost entry. The console ships alongside an
installable `skill/` package, because the judging criteria ask whether the contribution is
reusable.

## Capabilities and Constraints

### Build state — what is true today

The repo is a **scaffold with the safety core built and tested, and nothing else**. Shipped
and verified: `lib/phone/normalize.ts` (E.164 or a typed refusal, plus `maskPhone`),
`lib/script/guard.ts` (the three-phase clinical guard), `lib/calle/port.ts` (the only door to
CALL-E), `lib/calle/fake-server.ts`, `lib/config.ts`, `start.sh`. The only route is `/`, and
it is an explicitly labelled scaffold page that lists what is not built.

**Not built yet:** the database and seeds, the task assembler, the rule DSL and evaluator,
the note compiler, the scheduler, extraction, the KPI layer, and the entire console
(`/patients`, `/patients/<id>`, `/patients/<id>/new-plan`, `/plans/<id>`, `/calls/<id>`,
`/queue`, `/api/tick`). Capability statements elsewhere in this file describe **confirmed
product truth**, not shipped surface area.

### What a clinician will be able to do, end to end

Write a consultation note → see it compiled into a plan with every defaulted field marked as
defaulted → edit it → approve it once → watch it expand into dated rows → let it run → read
typed answers with the patient's verbatim words behind each flag → take over from a queue
when a rule fires.

### Locked product behaviour

- An **urgent escalation pauses the plan** → clinician queue → a human resumes or closes it.
  Duration expiring closes it `completed`. **A clear call never ends a plan.**
- Three rules can never be removed, by compiler or clinician: `patient_requests_clinician`,
  `unmappable_response`, `emergency_language`.
- **Unmappable, unknown, or missing answers escalate by default.** An uncertain call becomes
  a human's problem; it is never resolved by guessing.
- Red flags: a tested global list per condition seeds every plan. Compiler-added terms are
  rendered **marked as additions, and are deletable**. The clinician stays the clinical
  author.
- **"7 days" is calendar-anchored** from approval, not "7 completed contacts". A follow-up
  window is a clinical interval, not a quota. Retries may spill past the end date; new
  occurrences may not. The review screen says so.
- `patients.timezone` (IANA) is required — `"10:00"` without a zone means the server's 10:00
  and drifts across DST.
- **Consent to be called by an AI** is a field on the patient record *and* a first-call
  consent gate. Not optional.

### Hard constraints

- **The guard, the consent gate, the AI disclosure, and the emergency handoff are never
  weakened to smooth a demo.** If they get in the way, that *is* the demo.
- **Care Loop never gives clinical advice and never diagnoses.** No code path makes a
  clinical decision. Escalation is routing, never a verdict.
- **The dial allowlist fails closed.** The scheduler dials with nobody pressing a button, so
  `CARELOOP_CALL_ALLOWLIST` *is* the human gate, moved into code. Absent config is treated as
  empty, never as permission. A number not on the list is refused with a visible reason —
  never silently skipped, never quietly simulated.
- **Calls are live whenever `CALLE_API_KEY` is set.** They cost money and they reach people.
- **Phone numbers are masked everywhere.** A full number on screen is a P0 — this UI ends up
  in a published video and on a public URL.
- **No auth, deliberately.** The chrome must say so ("Dr Rao · demo, no auth") rather than
  implying a login.
- **Hackathon prototype. Not for use with real patient data.** This must be stated on the
  landing page and in the README.
- Without `OPENAI_API_KEY`, compiling a note is **refused** and the review screen shows a
  blank hand-editable plan. It never silently invents a generic follow-up plan.
- Without `DATABASE_URL`, data pages throw a named error rather than rendering an empty
  console.
- Technical shape that constrains any interface work: Next.js 16 App Router, React 19,
  plain CSS tokens in `app/globals.css` with inline styles. **No Tailwind, no component
  library, no icon package, no `public/` directory.** Typefaces are self-hosted through
  `next/font/google`.

### Deliberately cut for the 3-minute demo

`book_appointment` (becomes a `rebook_requested` escalation with a **stub button** — there is
no calendar); the plan-v2 editing UI; webhooks (unsigned and at-least-once, so a receiver
must re-fetch through the authenticated API anyway); charts; more than two live patients
(seed ~8, dial 2). **Anything half-finished is said so in the UI rather than faked.**

### Open decisions

- Whether the deployed judge-facing instance runs with `CALLE_API_KEY` **unset** (nothing can
  dial) or armed. No auth plus a public URL means a stranger can approve plans and trigger
  ticks; the allowlist stops them reaching an arbitrary number, but the choice is unmade.

## Brand Commitments

- **The name is "Care Loop."**
- **Voice:** plain, specific, and unhedged. Refusals explain themselves in words a clinician
  would accept, and they already exist in code — "No country code. Care Loop will not guess
  one — a guessed code dials a stranger."; "Care Loop does not diagnose. Naming a condition
  on a follow-up call is practising medicine."; "This number is not on the dial allowlist.
  Care Loop's scheduler dials without anyone pressing a button, so it only calls numbers that
  were explicitly armed." That register is the product's voice and is binding.
- **The product never speaks as a clinician.** Only sentences the clinician actually wrote
  may be attributed to them.
- **Defaults are always visibly marked as defaulted.** This is a promise the UI makes, and it
  is only trustworthy because code — never the model — applies the defaults.
- No logo, wordmark, colour, typeface, or other identity asset exists or has been committed
  to.

## Evidence on Hand

**Real and usable:** the passing test suite (runs on zero credentials); the guard's own
refusal and rejection copy; the CALL-E API facts, verified against the installed SDK rather
than recalled. Once the build lands: seeded fictional patients, worked example notes, real
red-flag term lists, and genuine transcripts from genuine calls.

**Genuinely real in the demo:** the retry ladder is exercised against a second, deliberately
silenced phone line that actually never answers. No fake `no_answer` rows are seeded.

**Does not exist and must never be fabricated:** customers, users, testimonials, case
studies, press, pilot sites, benchmarks, accuracy figures, time-saved numbers, clinical
outcome claims, pricing, licensing, certifications, regulatory status, or any deployment
claim. There are no images, logos, or photographs in the repo. Every person and clinic named
anywhere is fictional, and every phone literal is US fiction-reserved `555-01xx`. The real
demo numbers come from the environment at seed time and are never committed.

## Product Principles

1. **The workflow is the visible artifact.** The product's claim is that the agent owns
   scheduling, retries, escalation and resolution — so those must be things you can look at,
   not things you are told about. A plan that expands into seven dated rows is the argument.
2. **The model translates; the rule engine decides.** Every decision boundary is pure,
   inspectable code. This is what makes "escalation is never model judgment" checkable rather
   than a slogan.
3. **Uncertainty routes to a human; it never resolves itself.** Unmappable, unknown, and
   missing are real statuses with a real destination. Nothing is guessed to keep a loop
   closed.
4. **Never weaken a safety gate to make something smoother.** The gates are the
   differentiator, not the overhead.
5. **Say what is half-built.** Scaffolding announces itself; a stub is labelled a stub. The
   product's credibility comes from not overstating itself.

## Accessibility & Inclusion

Best-effort, and recorded as such — no formal standard is a requirement for this build.
The working bar: interactive elements are keyboard reachable and carry a visible focus
state; body text measures ≥ 4.5:1 against its real background (the muted ink token is the one
that usually fails — measure it, don't assume); any motion added later honours
`prefers-reduced-motion`.

Product-specific inclusion facts, which are stronger than the above because they are clinical
rather than cosmetic: the patient is spoken to in plain language, told they are talking to an
AI, told the agent cannot give medical advice, and given an emergency instruction. Numbers,
ids and timestamps are always mono and tabular, because they get compared by eye.
