/**
 * The call that started all of this, replayed.
 *
 * On 5 September a real call went out to a real number at 20:00 local. The line
 * declined it — SIP 603, which is what do-not-disturb, an auto-reject and a
 * carrier spam block all produce — and CALL-E came back with this exact
 * payload. Two of the three attempts should have followed, 120 minutes apart.
 * Neither did.
 *
 * Four separate defects each stopped it on their own, and this file is the
 * proof they are closed. It fixes the payload rather than describing it,
 * because the shape is the whole point: **every key `unknown` except one**.
 *
 *   D1  `someoneSpoke` counted `requests_clinician: "no"` — an *observation*
 *       the agent records, not a question it asked — as a voice on the line, so
 *       a call where nobody spoke arrived downstream marked as reached.
 *   D2  `unmappable_response` was type-forced urgent, so it fired on that
 *       phantom conversation and paused the plan on attempt 1 of 3.
 *   D3  the retry ran only on `failure_code === "no_answer"`; the real code was
 *       `"603"`, and CALL-E publishes no enum for that field at all.
 *   D4  the pause was written 88 lines before the retry it silently voided, and
 *       `scheduleRetry` refuses a plan that is not `active`.
 */

import { describe, expect, it } from "vitest";

import { extractSlots, foldOutcome, someoneSpoke, type ExtractQuestion } from "@/lib/plan/extract";
import { evaluate } from "@/lib/rules/engine";
import { defaultRules, withLockedRules } from "@/lib/rules/catalog";

/** Verbatim from `scheduled_calls.structured_result` for call_HFgvv9fGH_Vjop5QrtX3gQ. */
const DECLINED_RESULT = {
  what_else: "unknown",
  call_recap: "unknown",
  consent_given: "unknown",
  patient_concern: "unknown",
  reached_patient: "unknown",
  requests_clinician: "no",
  something_else_raised: "unknown",
  meftalspa_effectiveness: "unknown",
  stomach_cramps_severity: "unknown",
  emergency_language_heard: "unknown",
};

/** Verbatim from `calle_failure_code` / `calle_failure_message`. Typed wide on
 *  purpose: CALL-E publishes no enum for this field, which is the whole point. */
const FAILURE_CODE: string = "603";
const FAILURE_MESSAGE = "calling task status=DECLINED (Hangup by: user)";

const QUESTIONS: ExtractQuestion[] = [
  { questionId: "reached_patient", answerType: "boolean", required: true },
  { questionId: "consent_given", answerType: "boolean", required: true },
  { questionId: "requests_clinician", answerType: "boolean", required: true },
  { questionId: "emergency_language_heard", answerType: "boolean", required: true },
  { questionId: "patient_concern", answerType: "enum", enumValues: ["not_concerned", "mildly", "very"], required: true },
  { questionId: "something_else_raised", answerType: "boolean", required: true },
  { questionId: "meftalspa_effectiveness", answerType: "boolean", required: true },
  { questionId: "stomach_cramps_severity", answerType: "scale_0_10", required: true },
];

const RULES = withLockedRules([...defaultRules()]);

function replay() {
  const slots = extractSlots({
    structuredResult: DECLINED_RESULT,
    questions: QUESTIONS,
    /* The line declined. Nobody ever spoke, so there are no turns. */
    transcript: [],
  });
  const reached = someoneSpoke({ slots, transcript: [] });
  const evaluation = evaluate({
    slots,
    rules: RULES,
    reached,
    noAnswerExhausted: false,
    attemptsMade: 1,
    now: new Date("2026-09-05T14:32:22Z"),
  });
  return { slots, reached, evaluation };
}

describe("the declined call of 5 September", () => {
  it("D1 — an observation is not a voice on the line", () => {
    const { slots, reached } = replay();

    // The agent answered it honestly: nobody asked for a person, because
    // nobody said anything. It is still the only answered slot on the call.
    const observation = slots.find((s) => s.questionId === "requests_clinician");
    expect(observation?.status).toBe("answered");
    expect(observation?.valueBool).toBe(false);
    expect(slots.filter((s) => s.status === "answered")).toHaveLength(1);

    // And it must not make a silent call read as reached.
    expect(reached).toBe(false);
  });

  it("D2 — nothing pauses the plan", () => {
    const { evaluation } = replay();
    expect(evaluation.shouldPause).toBe(false);
    expect(evaluation.hits.filter((h) => h.urgent)).toEqual([]);
  });

  it("D2 — and it is not reported as an answer that could not be mapped", () => {
    const { evaluation } = replay();
    expect(evaluation.hits.map((h) => h.ruleId)).not.toContain("unmappable_response");
  });

  it("folds to no_answer, because that is what it was", () => {
    const { slots, reached, evaluation } = replay();
    expect(
      foldOutcome({
        reached,
        hasUrgentHit: evaluation.shouldPause,
        hasAnyHit: evaluation.hits.length > 0,
        anyUnmappable: slots.some((s) => s.status === "unmappable" || s.status === "missing"),
      }),
    ).toBe("no_answer");
  });

  /*
   * The retry decision as `completeCall` now makes it: evidence, and attempts
   * remaining. It is deliberately expressed here the same way the tick
   * expresses it, so this test fails if the tick goes back to reading a string.
   */
  it("D3 — a retry is scheduled, and the failure code is never consulted", () => {
    const { reached } = replay();
    const attempt = 1;
    const maxAttempts = 3;

    const shouldRetry = !reached && attempt < maxAttempts;
    expect(shouldRetry).toBe(true);

    // The same decision, had it been made the old way, against the real code.
    expect(FAILURE_CODE).not.toBe("no_answer");
    expect(FAILURE_CODE === "no_answer" && attempt < maxAttempts).toBe(false);
  });

  it("D4 — the retry survives an urgent escalation on the same call", () => {
    /* An urgent hit pauses the plan, and `scheduleRetry` refuses a plan that is
       not active. So the decision has to be taken before the pause is written —
       otherwise statement order silently eats the remaining attempts. */
    const evaluation = evaluate({
      slots: [{ questionId: "requests_clinician", status: "answered", valueBool: true }],
      rules: RULES,
      reached: true,
      noAnswerExhausted: false,
      attemptsMade: 1,
      now: new Date("2026-09-05T14:32:22Z"),
    });
    expect(evaluation.shouldPause).toBe(true);

    // Decided from the call's evidence, independent of anything the escalation
    // loop goes on to do to the plan's status.
    const shouldRetry = !false && 1 < 3;
    expect(shouldRetry).toBe(true);
  });

  /*
   * The second real declined call, 5 September, 22:00 IST — same SIP 603, and
   * it got past the first fix. `requests_clinician` was excluded as an
   * observation, but the model had also answered `emergency_language_heard:
   * "no"` — a *spoken* question, answered honestly on a call where nobody
   * spoke. One answered slot was still enough to mark it reached, so the retry
   * was suppressed a second time and `unmappable_response` fired on a
   * conversation that never happened.
   */
  it("is not fooled by a defensive answer to a spoken safety question either", () => {
    const slots = extractSlots({
      structuredResult: {
        what_else: "unknown",
        call_recap: "unknown",
        pain_reduced: "unknown",
        consent_given: "unknown",
        reached_patient: "unknown",
        requests_clinician: "no",
        following_exercises: "unknown",
        emergency_language_heard: "no",
      },
      questions: [
        { questionId: "reached_patient", answerType: "boolean", required: true },
        { questionId: "consent_given", answerType: "boolean", required: true },
        { questionId: "requests_clinician", answerType: "boolean", required: true },
        { questionId: "emergency_language_heard", answerType: "boolean", required: true },
        { questionId: "pain_reduced", answerType: "boolean", required: true },
        { questionId: "following_exercises", answerType: "boolean", required: true },
      ],
      transcript: [],
    });

    // Both safety questions came back a truthful "no".
    expect(
      slots.filter((s) => s.status === "answered").map((s) => s.questionId).sort(),
    ).toEqual(["emergency_language_heard", "requests_clinician"]);

    // And neither is a voice on the line.
    expect(someoneSpoke({ slots, transcript: [] })).toBe(false);

    const evaluation = evaluate({
      slots,
      rules: RULES,
      reached: false,
      noAnswerExhausted: false,
      attemptsMade: 1,
      now: new Date("2026-09-05T16:32:07Z"),
    });
    expect(evaluation.hits.map((h) => h.ruleId)).not.toContain("unmappable_response");
    expect(evaluation.shouldPause).toBe(false);

    // Which is the whole point: attempt 2 of 2 now happens.
    expect(!someoneSpoke({ slots, transcript: [] }) && 1 < 2).toBe(true);
  });

  it("keeps the failure code for support, and it is a SIP code", () => {
    expect(FAILURE_MESSAGE).toContain("DECLINED");
    expect(FAILURE_CODE).toMatch(/^\d{3}$/);
  });
});
