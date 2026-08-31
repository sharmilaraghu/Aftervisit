# Care Loop

A clinical follow-up agent built on **CALL-E**. A doctor writes a free-form note after a
consultation; Care Loop *compiles* it into a structured, reviewable follow-up plan; the
doctor approves it in one click; and the agent then owns the whole workflow — scheduling,
dialing, extracting typed answers, retrying, escalating — until the patient resolves or a
clinician takes over.

Built for the *CALL-E: Your Code Is Calling* hackathon (submission via a PR to
`CALLE-AI/awesome-phone-call-agents` + a ~3 minute demo video).

The failure mode this product exists to catch: **a patient who quietly stops engaging and
nobody notices for a week.**

The differentiator is not "an AI that calls patients". It is that the agent owns the
**workflow**, not just the conversation. So the code makes the workflow the visible
artifact: a plan expands into dated rows you can see, a tick moves them, a pure rule engine
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
doctor's free-text note
  → compile.ts    Gemini (OpenAI fallback), strict schema, every defaultable field NULLABLE
                  → defaults.ts stamps provenance (note | default | clinician)
                  → grounding.ts refuses any medication not present in the note
                  → guard phase 1 on each question, individually, UNMASKED
  → review UI     defaults visibly marked; the doctor edits and approves
  → expand.ts     approved plan → one scheduled_calls row per occurrence, dated
  → tick.ts       reconcile → atomic batch claim → guard → dial → persist call id
                  → after() waiter → retry.ts schedules the next attempt if unanswered
  → extract.ts    CALL-E's structuredResult → typed slots; unmappable is a real status
  → engine.ts     PURE rule evaluation. No model. Escalate on any hit
  → queue         a clinician sees the rule, the reason, and the patient's own words
```

## Hard rules (always)

1. **The port is the only door.** `lib/calle/port.ts` is the only file that may import
   `@call-e/calle`. Guard re-inspection, E.164 validation and the dial allowlist all live
   inside `dial()`, so no call site can skip them.
2. **The scheduler dials autonomously — so the allowlist is not optional.**
   `CARELOOP_CALL_ALLOWLIST` is what replaces the human "press to call" gate that a manual
   tool would have. A scheduled call to a number not on the list is refused with a visible
   reason. Never silently skipped, never quietly simulated.
3. **Never weaken the guard, the AI disclosure, the emergency stop, or the emergency
   handoff** to make a demo smoother. If they get in the way, that *is* the demo.
   *Consent moved off the call deliberately* — it is a condition of enrolment recorded on
   the patient record, not a question re-asked every day. What replaced it in the guard is
   stricter: a script must tell the agent to **stop the call** when a patient describes
   something urgent, because a real transcript had it answer "I can't answer that one" to
   "I feel like fainting and I don't have bladder control" and ask the next question.
4. **Care Loop never gives clinical advice and never diagnoses anyone.** There is no code
   path that makes a clinical decision. An uncertain call becomes a human's problem via an
   escalation. Escalation is routing, never a verdict.
5. **The model translates; the rule engine decides.** `lib/rules/engine.ts` is pure — no IO,
   no clock (`now` is injected), no model, no randomness. Keep it that way; it is what makes
   "escalation is never model judgment" a checkable claim rather than a slogan.
6. **Defaults are applied by code, never by the model.** Every defaultable field is nullable
   in the compiler's output schema and filled deterministically afterwards. That is the only
   thing that makes the "Defaulted" marking in the review UI trustworthy.
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
  DESIGN.md               ← written by impeccable from the shipped code
  app/
    page.tsx              landing — the pitch
    (console)/            patients, plans, calls, queue
    api/tick/             the scheduler door for an external cron
  lib/
    calle/port.ts         the ONLY place that talks to CALL-E
    calle/fake-server.ts  offline stand-in so the suite runs with no API key
    plan/                 provider → compile → defaults → grounding → result-schema → extract
    script/build.ts       assembleTask (pure, tested) — all safety language lives here
    script/guard.ts       the three-phase clinical guard
    rules/                the closed rule DSL, the catalog, the pure evaluator
    schedule/             expand · retry · select (pure) + tick · dispatch · reconcile (IO)
    patients/kpi.ts       contact rate, adherence, drift — pure
    phone/normalize.ts    E.164, or an explicit refusal — never a guess
    db/                   Drizzle schema, queries, Neon client
  data/                   seeded patients, demo notes, red-flag term lists
  skill/                  the installable Care Loop agent skill + worked examples
```

## Stack

- **Next.js 16** (App Router, Turbopack, React 19) + TypeScript. **Read
  `node_modules/next/dist/docs/` before writing Next code** — this version differs from
  training data (see the generated block below).
- **Neon Postgres** + **Drizzle ORM**. Migrations are generated, never written by hand.
- **CALL-E SDK** (`@call-e/calle`) behind `lib/calle/port.ts`.
- **Gemini** for the note compiler only, with **OpenAI as a fallback** behind one
  provider interface (`lib/plan/provider.ts`). Which one actually ran is persisted on
  the note, so "Gemini with a fallback" stays a checkable claim. Screening questions are
  never model-authored free text beyond what the doctor's note grounds.
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
