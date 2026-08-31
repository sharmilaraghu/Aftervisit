# Care Loop

A clinical follow-up agent built on **CALL-E**. A doctor writes a free-form note
after a consultation; Care Loop *compiles* it into a structured, reviewable
follow-up plan; the doctor approves it in one click; and the agent then owns the
whole workflow — scheduling, dialing, extracting typed answers, retrying,
escalating — until the patient resolves or a clinician takes over.

The failure mode this exists to catch: **a patient who quietly stops engaging and
nobody notices for a week.**

> **This is a hackathon prototype. It is not for use with real patient data.**
> Every patient, clinician and clinic in this repository is fictional, and every
> committed phone number is in the US fiction-reserved `555-01xx` range.

---

## The claim

The differentiator is not "an AI that calls patients". It is that the agent owns
the **workflow**, not just the conversation — and that is **forced by the API,
not chosen for flavour.**

CALL-E's `CreateCallInput` is `{task, recipients, resultSchema, metadata,
webhookUrl}`. There is no `scheduledAt` and no retry policy. There is also no
endpoint that lists calls. So a system that follows a patient for seven days has
to own the calendar, and has to persist every `call_id` the instant it is
created, or the result is unrecoverable. A neighbouring product on the same SDK
cannot truthfully claim otherwise without also building the calendar.

The second checkable claim: **the model translates, the rule engine decides.**
`lib/rules/engine.ts` is pure — no IO, no clock, no model, no randomness. You can
read it in one sitting and verify that no escalation is ever model judgment.

## Running it

```bash
./start.sh                      # dev server on :3001, with the dial banner
./start.sh --migrate --seed     # fresh clone: migrate, seed, then run
./demo-tick.sh --every 5        # drive the scheduler during a demo
pnpm run verify                 # 162 tests, typecheck, lint
```

Configuration lives in `.env` (copy `.env.example`). Every credential is
optional and the product degrades honestly without each one:

| Absent | What happens |
|---|---|
| `DATABASE_URL` | The console throws a named error rather than rendering an empty practice. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Compiling is **refused** and you get a blank, hand-editable plan. It never invents a generic follow-up. |
| `CALLE_API_KEY` | Nothing can be dialled. The top bar says so on every page. |
| `CARELOOP_CALL_ALLOWLIST` | Treated as empty, never as permission. Every call is refused with a visible reason. |
| `CARELOOP_TICK_TOKEN` | `POST /api/tick` returns 503 — the door is shut, not open. |

**Calls are live whenever `CALLE_API_KEY` is set.** They cost money and they
reach people.

## How a follow-up happens

```
doctor's free-text note
  → compile.ts    Gemini (OpenAI fallback), strict schema, every defaultable field NULLABLE
                  → defaults.ts stamps provenance (note | default | clinician)
                  → grounding.ts refuses any medication not present in the note
                  → guard phase 1 on each question, individually, UNMASKED
  → review UI     defaults visibly marked; the doctor edits and approves
  → expand.ts     approved plan → one scheduled_calls row per occurrence, dated
  → tick.ts       reconcile → atomic batch claim → guard → dial → persist call id
                  → retry.ts schedules the next attempt if unanswered
  → extract.ts    CALL-E's structuredResult → typed slots; unmappable is a real status
  → engine.ts     PURE rule evaluation. No model. Escalate on any hit
  → queue         a clinician sees the rule, the reason, and the patient's own words
```

## The safety model

This is the differentiator, not the overhead.

**The port is the only door.** `lib/calle/port.ts` is the only file that may
import `@call-e/calle`. Guard re-inspection, E.164 validation and the dial
allowlist all live *inside* `dial()`, so no call site can skip them.

**The allowlist is not optional.** The scheduler dials with nobody pressing a
button, so `CARELOOP_CALL_ALLOWLIST` *is* the human gate, moved into code. An
absent allowlist is empty, never permission.

**The guard is bidirectional and three-phase.** It rejects advice, diagnosis,
dosage changes, prognosis, false reassurance and anything attributed to the
doctor — and it *also fails a script that is missing* the AI disclosure, the
emergency stop, the non-advice statement, the emergency handoff or the human
handoff. Phase 1 inspects each question unmasked before it can enter the approved
set; phase 2 inspects the assembled script with approved questions masked; phase
3 inspects the transcript afterwards, **agent turns only** — a patient saying "I
stopped taking it" is the disclosure the call exists for.

**Uncertainty routes to a human.** Unmappable, unknown and missing are real
statuses with a real destination. Nothing is guessed to keep a loop closed.

**Care Loop never gives clinical advice and never diagnoses.** No code path makes
a clinical decision. Escalation is routing, never a verdict.

**Phone numbers are masked everywhere**, without exception.

**No auth, deliberately** — and the chrome says so rather than implying a login.

## The demo clock

A persisted `timeScale` on the plan (1 = real time, 1440 = one clinical day per
minute) is applied **once, at expansion time**. Everything downstream sees
ordinary UTC instants and has no idea a demo clock exists — so the mechanism
being demonstrated at 1440× is byte-identical to the one that ships at 1×.

The retry ladder is exercised against a second, deliberately silenced line
(`CARELOOP_UNANSWERED_PHONE`) that genuinely never answers. No fake `no_answer`
rows are ever seeded.

## Layout

```
app/
  page.tsx              landing — the pitch
  (console)/            dashboard · patients · plans · calls · queue
  api/tick/             the scheduler door for an external cron
lib/
  calle/port.ts         the ONLY place that talks to CALL-E
  calle/fake-server.ts  offline stand-in so the suite runs with no API key
  plan/                 compile → defaults → grounding → result-schema → extract
  script/build.ts       assembleTask (pure, tested) — all safety language lives here
  script/guard.ts       the three-phase clinical guard
  rules/                the closed rule DSL, the catalog, the pure evaluator
  schedule/             expand (pure) + store · tick · trigger (IO)
  db/                   Drizzle schema, queries, Neon client
  time/clock.ts         injected time; zone-correct wall-clock arithmetic
data/                   seeded patients, demo notes, red-flag term lists
skill/                  the installable Care Loop agent skill + worked examples
```

## Stack

Next.js 16 (App Router, Turbopack, React 19) · TypeScript · Neon Postgres +
Drizzle · CALL-E SDK · Gemini with an OpenAI fallback, for the note compiler only
· Vitest for the pure, safety-bearing logic · plain CSS tokens, no Tailwind, no
component library, no icon package.

## Tests

162, running on **zero credentials** — `lib/calle/fake-server.ts` fakes CALL-E's
HTTP API as an injectable `fetch`, so the whole pipeline is exercised without
placing a call or touching a database.

```bash
pnpm run verify
```

## Built for

The *CALL-E: Your Code Is Calling* hackathon. Ships alongside an installable
`skill/` package, because the judging criteria ask whether the contribution is
reusable — see `skill/SKILL.md` for the pattern stated independently of this
codebase.
