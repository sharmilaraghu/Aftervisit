# Safety

An autonomous dialer has no human at the moment of the call. Every gate a manual
tool gets for free — someone reading the number, someone deciding to press the
button, someone hearing the first sentence — has to be moved into code and made
checkable. This is that list.

Each rule below is written the way it is because something went wrong first.

---

## Explicit intent

**A recorded agreement at enrolment is what authorises every later call.**

There is no "press to call" on a scheduled dialer, so intent moves earlier rather
than disappearing: the person being called agreed to automated follow-up, that
agreement is a field on their record, and the dial function takes it as a
**required** argument. A new call site that forgets it fails to compile rather
than defaulting to calling someone who never agreed.

Consent that is anything other than an explicit grant is a **visible refusal on
the call row**, never a silent skip.

Do not re-ask for consent on every call. It is a condition of enrolment, not a
question; asking it daily trains people to say yes to anything a machine asks.

## Phone numbers

**E.164 or an explicit refusal — never a guess.**

Parse to E.164 once, at the edge, and re-validate inside the dial function so no
call site can bypass it. A number that will not parse is an error a human sees,
not a number to normalise hopefully. Never infer a country code from a locale, an
IP address, or the timezone of whoever is logged in.

Derive the routing region from the number itself. A call placed without one can
be accepted by the API and then reach nobody — the symptom is a call that returns
instantly with an identical start and completion time, and it costs you a real
attempt to learn that.

## Masking

**Mask in every summary, log, screen and transcript excerpt.** Show the country
code and the last two digits, nothing else. The full number exists in exactly one
place — the dial call itself.

This is not only a privacy rule. Console screenshots end up in demos, videos and
bug reports, and a number is the one field on the screen that reaches a real
person if it leaks.

## Credentials

The provider key belongs to the server and nowhere else. It is never sent to a
browser, never written into a task string, never logged, and never committed —
only an example file with empty values is.

Keep one module as the only importer of the provider SDK. Every refusal rule
lives inside it, so "no call site can skip a check" is something a reader can
verify by grepping for one import rather than trusting a convention.

## No hidden schedules

**A recurring workflow must be visible as rows before it runs.**

Expand an approved plan into one dated row per occurrence and show all of them.
The calendar is the artifact; a promise that calls will happen is not. Anyone
looking at the record can see what will be dialled, when, in whose timezone,
before anything rings.

Compute each occurrence as a local wall-clock time in the recipient's own zone
and then convert to an instant, so a plan spanning a daylight-saving change still
calls at the right local hour on both sides.

## No duplicate jobs

Every scheduled attempt carries a business-stable idempotency key —
`plan:occurrence:attempt` — and a unique index behind it. Two schedulers racing
produce one row and exactly one of them dials.

Claim work with a single conditional `UPDATE … RETURNING`. If the driver has no
transactions, that constraint is doing all the work, so it has to be an index and
not a check in application code.

Create retries **lazily**: attempt 2 exists because attempt 1 failed. Materialising
the whole ladder up front puts rows on screen for calls that will mostly never
happen.

**Refuse to dial anything too old.** A queue that was down for a day must not wake
up and call forty people at once. Past a fixed staleness window, retire the row
with a reason instead of dialling it.

## Cancellation

Cancellation is first-class, reachable in one click, and never behind a
confirmation that a person in a hurry has to read:

- **Stop everything now** — skip every unplaced call and pause the schedule.
- **End the follow-up** — close it for good; remaining calls are dropped and the
  record is kept.
- **Pause and resume** — on resume, calls missed while stopped are *skipped*, not
  dialled all at once.

State plainly what cancellation cannot do. If the provider has no cancel endpoint,
a call already in progress will finish, and the interface should say so rather
than implying a reach it does not have.

## Boundaries: medical, legal, financial, emergency

**The agent never advises, never diagnoses, never concludes.** There is no code
path that reaches a clinical judgement. Uncertainty becomes a human's problem
through an escalation, and an escalation is *routing*, never a verdict.

Four things must be in the task text, and their **absence** is a violation:

1. a disclosure that the caller is an AI assistant, in the first turn;
2. a non-advice statement;
3. an emergency handoff to the local emergency number;
4. an **emergency stop** — end the call when the person describes something urgent.

The emergency stop is the one to copy verbatim. A real transcript answered *"I
feel like fainting and I don't have bladder control"* with "I can't answer that
one" and moved to the next question, because the can't-answer deflection was
written broadly enough to swallow a disclosure. Scope that deflection to questions
the person **asks you**, and make urgency end the call.

Never let a model author the questions freely. Ground every one in the source
note: a compiler that names a medication the note does not contain is refused
outright, not warned about.

---

## The guard

Three phases, and the ordering is the whole point:

- **Phase 1** inspects each question *individually and unmasked*, before it can
  enter the approved set.
- **Phase 2** inspects the assembled script with approved questions masked out.
- **Phase 3** inspects the transcript afterwards, **agent turns only**.

Why phase 1 must come first: phase 2 exempts approved questions, so if a question
that failed inspection could reach the approved list, listing it would launder it
straight past the check that rejected it. Phase 3 skips the caller's own turns
because someone saying "I stopped taking it" is the disclosure you called for.

The guard is **bidirectional** — it fails a script that is *missing* any of the
four clauses above, not only one that says something forbidden.

Inspect a fourth time inside the dial function itself. It is not redundant: it is
what makes it impossible for a new call site to dial text that nothing checked.

**Known limitation, stated rather than hidden:** phase 3's patterns are
English-only, so a non-English call's agent turns are not phase-3-checkable. The
safety clauses stay enforced in the English task text that phases 1 and 2 inspect.

## Fail closed, everywhere

- A model that times out, errors, or returns something unparseable **queues the
  call for review**. It never returns "nothing to see here".
- An absent allowlist is treated as empty, never as permission.
- A refusal is a **visible row with its reason in words**. Silence is
  indistinguishable from success, and an operator cannot act on a call that
  simply never appeared.
- Keep a pure evaluator — no IO, no clock, no model, no randomness, with `now`
  injected — as the floor underneath the model. That is what makes "an outage
  cannot silence someone who asked for a person" a claim a reader can check
  against one file, rather than a slogan.
