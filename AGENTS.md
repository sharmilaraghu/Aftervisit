# Care Loop

A clinical follow-up agent built on **CALL-E**. A doctor writes a free-form note after a
consultation and presses *Save and start follow-up*; Care Loop reads the note into a goal,
the things the doctor wants found out (each quoting the note) and a schedule; and the agent
then owns the whole workflow — scheduling, dialing, asking in its own words, extracting typed
answers, retrying, escalating — until the patient resolves or a clinician takes over.

Built for the *CALL-E: Your Code Is Calling* hackathon (submission via a PR to
`CALLE-AI/awesome-phone-call-agents` + a ~3 minute demo video).

The failure mode this product exists to catch: **a patient who quietly stops engaging and
nobody notices for a week.**

The differentiator is not "an AI that calls patients". It is that the agent owns the
**workflow**, not just the conversation. So the code makes the workflow the visible
artifact: a plan expands into dated rows you can see, a tick moves them, a pure floor
decides, a queue collects.

> **This is a hackathon prototype. It is not for use with real patient data.**

---

## The four laws that come from the CALL-E API

These are not preferences. They are properties of the API, verified against the installed
SDK, and every one of them shapes code you will touch.

1. **There is no endpoint to list calls.** A `call_id` we fail to persist is a call we can
   never read back. Every dispatch writes its row *before* it dials, and stores CALL-E's id
   the instant `create` returns, before anything waits.
2. **There is no mid-call tool calling.** Anything the agent may say has to be inlined into
   the task text up front. Anything absent is deferred to a human, never guessed.
3. **There are no transactions** on the Neon HTTP driver. Every mutation that could race is
   a single conditional `UPDATE … RETURNING`; every derived write is idempotent behind a
   unique index.
4. **There is no scheduling API.** `CreateCallInput` is `{task, recipient(s), resultSchema,
   recipientResultSchema, metadata, webhookUrl}` — no `scheduledAt`, no retry policy. Care
   Loop owning the calendar is forced by the API, not a design flourish.

Webhooks are also unsigned and delivered at-least-once, so a receiver must re-fetch through
the authenticated API before trusting anything a webhook claims.

## How a follow-up happens

```
doctor's free-text note → "Save and start follow-up"
  → compile.ts    OpenAI structured output, strict schema, every defaultable field NULLABLE:
                  reason, goal, what to find out (topic + note quote + unit), schedule +
                  wait + quotes
                  → grounding.ts refuses any medication not present in the note
                  → defaults.ts fills gaps in code (7 days or one call after a wait, daily,
                    10:00, 3 attempts) and stamps provenance (note | default)
                  → each topic's quote must be in the note; guard phase 1 on the goal and
                    each topic, UNMASKED; a refused topic is dropped, never asked
  → plans.ts      startPlan → one scheduled_calls row per occurrence, dated from the wait
                  (a start after today's call time begins a day later if that keeps a call)
  → tick.ts       reconcile → atomic batch claim → build.ts goal task → guard → dial →
                  persist call id → store.ts schedules the next attempt if unanswered
  → extract.ts    fixed result schema → typed slots + per-topic findings and readings;
                  unmappable is real
  → engine.ts     PURE evaluation of four locked conditions. No model. The floor
  → triage.ts     a model reads the transcript on top: severity, summary, the doctor's
                  own escalating conditions. Fails closed; never speaks to a patient
  → Today         a clinician sees the rule, the reason, and the patient's own words
```

## Hard rules (always)

1. **The port is the only door.** `lib/calle/port.ts` is the only file that may import
   `@call-e/calle`. Guard re-inspection, E.164 validation and the dial allowlist all live
   inside `dial()`, so no call site can skip them.
2. **The scheduler dials autonomously — so consent is the gate.** A doctor enrols a
   patient (at the front desk, ahead of the visit), records that they agreed to automated
   follow-up, and after the consultation writes the note and presses **Save and start
   follow-up**; that button is the human "press to call" a manual tool would have, moved
   earlier. There is no separate plan review — the start page says what was read from the
   note and what code defaulted. `dial()` refuses any
   patient whose consent is not an explicit `granted`, with a visible reason — never
   silently skipped, never quietly simulated. `consentGranted` is a **required** field on
   `DialRequest` precisely so a new call site fails to compile rather than defaulting to
   dialling someone who never agreed.
   `CARELOOP_CALL_ALLOWLIST` is the **deployment lock**, answering a different question:
   may this instance reach the outside world at all. **It is closed by default** — unset
   or empty refuses every dial, a list allows only those numbers, and `*` opens it to any
   consenting patient. There is no auth, so a public console must not be able to dial
   until an operator deliberately opens it.
3. **Never weaken the guard, the AI disclosure, the emergency stop, or the emergency
   handoff** to make a demo smoother. If they get in the way, that *is* the demo.
   *Consent moved off the call deliberately* — it is a condition of enrolment recorded on
   the patient record, not a question re-asked every day. What replaced it in the guard is
   stricter: a script must tell the agent to **stop the call** when a patient describes
   something urgent, because a real transcript had it answer "I can't answer that one" to
   "I feel like fainting and I don't have bladder control" and ask the next question.
   *Known limitation of per-patient call language:* the phase-3 transcript guard's patterns
   are English-only, so a non-English call's agent turns are not phase-3-checkable — the
   safety clauses stay enforced in the English task text that phases 1 and 2 inspect.
4. **Care Loop never gives clinical advice and never diagnoses anyone.** There is no code
   path that makes a clinical decision. An uncertain call becomes a human's problem via an
   escalation. Escalation is routing, never a verdict.
5. **The model reads the call; four rules stand under it as a floor.**
   `lib/triage/triage.ts` reads the transcript and decides: the severity, the one-sentence
   summary a clinician reads first, and the match against the doctor's own escalating
   conditions. It replaced ten rule kinds that matched on typed slots — a substring matcher
   that fired inside a negation, threshold and enum comparisons no doctor ever authored —
   because deciding what a patient *meant* is not a thing a DSL does well. A real call
   settled it: the rules reported "answer could not be mapped" for a line that declined,
   and the model said "the call ended immediately with no speech from the patient."
   What remains in `lib/rules/engine.ts` is a **floor, not a language**: the patient asked
   for a person, emergency language, a reached call that did not find out what it set out
   to (`goal_covered` none, unknown or missing), nobody answered at all.
   It is still pure — no IO, no clock (`now` is injected), no model, no randomness — and
   keeping it that way is what makes "an outage cannot silence a patient who asked for a
   person" checkable rather than a slogan. Only two of the four pause a plan; unmappable
   escalates and keeps dialling, because pausing on attempt 1 of 3 disabled the retry
   ladder for the commonest reason a call is useless. Triage fails **closed** — an outage,
   a timeout or an unparseable answer all queue the call for review, never silence it —
   and a clinician overrides both.
6. **Defaults are applied by code, never by the model.** Every defaultable field is nullable
   in the compiler's output schema and filled deterministically afterwards. That is the only
   thing that makes the "from your note" / "default" marks on the follow-up page trustworthy.
7. **Never commit a real phone number.** Only US fiction-reserved `555-01xx`. India
   publishes no reserved range, so a plausible `+91` number probably belongs to someone. The
   real demo numbers come from the environment at seed time. (A hook scans for this.)
8. **Never commit anything that looks like patient data** — no real names paired with dates
   of birth, no MRN or NHS numbers, no SSNs. Seeded patients are fictional. (A hook scans
   for this too.)
9. **Never commit `.env*`** except `.env.example`, and never edit one through an agent.
10. **Never bypass git hooks** (`--no-verify`) or force-push. (A hook blocks both.)
11. **Never hand-edit `drizzle/*.sql` or the snapshots** — change `lib/db/schema.ts` and run
    `pnpm run db:generate`.
12. **Calls are live whenever `CALLE_API_KEY` is set, and they cost money and reach people.**
    Never place a call without the user asking for exactly that, in this session.
13. **Commit with the repo's configured git identity** (`Sharmila Raghu`). Never pass
    `-c user.email=…` or otherwise override it. Conventional-style subject under 72 chars,
    imperative mood; the body explains *why*.
14. **No `Co-Authored-By` and no trailer lines at all** — not Claude, not Cursor, not any AI.

## Layout

```
Care Loop/
  AGENTS.md               ← this file: the shared rules, for every tool
  CLAUDE.md               ← imports this, then adds the Claude-only tables
  app/
    page.tsx              landing — the pitch
    (console)/            Follow-ups, consult list, one visit, register, patients, one follow-up, one call
    api/tick/             the scheduler door for an external cron
    api/calle/webhook/    CALL-E's callback — takes a call id, re-fetches, never trusts
  lib/
    calle/port.ts         the ONLY place that talks to CALL-E
    calle/fake-server.ts  offline stand-in so the suite runs with no API key
    plan/                 provider → compile → defaults → grounding → result-schema → extract
    script/build.ts       assembleTask (pure, tested) — all safety language lives here
    script/guard.ts       the three-phase clinical guard
    rules/                the closed rule DSL, the catalog, the pure evaluator
    triage/               the model's reading of a finished call — fails closed
    schedule/             expand (pure) + store · tick · trigger (IO)
    patients/parameters.ts  what the patient said, day by day — pure
    phone/normalize.ts    E.164, or an explicit refusal — never a guess
    db/                   Drizzle schema, queries, Neon client
  data/                   seeded patients, demo notes, red-flag term lists
  skills/care-loop/       the installable Care Loop agent skill + worked examples
```

## Stack

- **Next.js 16** (App Router, Turbopack, React 19) + TypeScript. **Read
  `node_modules/next/dist/docs/` before writing Next code** — this version differs from
  training data (see the generated block below).
- **Neon Postgres** + **Drizzle ORM**. Migrations are generated, never written by hand.
- **CALL-E SDK** (`@call-e/calle`) behind `lib/calle/port.ts`.
- **OpenAI** for the note compiler and call triage only, behind one provider
  interface (`lib/plan/provider.ts`), as strict structured output against a hand-written
  JSON Schema. Which model ran is persisted on the note, so the claim stays checkable.
  What to find out is grounded in the note: each topic carries a note quote, checked by
  code. The calling agent phrases its own questions under fixed safety instructions, and
  what it is told and says is guarded in phases 2 and 3.
- **Vitest** for the pure logic. No zod — schemas are hand-written JSON Schema objects
  with `as const satisfies JsonObject` plus a mirrored TS interface.
- Plain CSS with tokens in `app/globals.css`; inline styles in components.

## Dev

```bash
pnpm install
./start.sh                 # dev server + a banner saying how many numbers are armed
./start.sh --migrate       # apply pending migrations first
./start.sh --clean         # discard .next when Turbopack holds a stale graph
./start.sh --test          # the full gate, then exit
pnpm run db:seed           # demo patients and notes
pnpm run verify            # test + typecheck + lint — the gate before claiming done
```

## Project mode

**Hackathon build, not a production system.** Ship something that works and demos well; do
not gold-plate. No speculative abstraction, no config surface nobody asked for, no
exhaustive test scaffolding — tests exist for the pure, safety-bearing logic, and that is
the right amount.

**The exception is the safety model above.** It is the differentiator, not the overhead, and
it does not get traded for speed. When something is half-finished, say so in the UI rather
than faking it.

## Coding guidelines

1. **Think before coding.** State assumptions. If two readings of a request would produce
   materially different work, ask. If a simpler approach exists, say so.
2. **Simplicity first.** Minimum code that solves the problem. No abstraction for single-use
   code, no error handling for impossible scenarios.
3. **Surgical changes.** Touch only what you must. Don't "improve" adjacent code. Match the
   existing comment voice, which explains *why*, not *what*. Remove imports *your* change
   made unused; leave pre-existing dead code alone.
4. **Goal-driven execution.** For multi-step work, state a short plan with a verify step for
   each step. Never claim "done", "fixed", or "passing" without having run the command and
   read its output.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
