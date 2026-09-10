import { describe, expect, it } from "vitest";

import { evaluate, type EvaluationInput, type EvaluatedSlot } from "@/lib/rules/engine";
import { defaultRules, lockedRules, withLockedRules } from "@/lib/rules/catalog";
import type { PlanRule } from "@/lib/rules/types";

const NOW = new Date("2026-08-30T09:00:00Z");

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    slots: [],
    rules: [...lockedRules(), ...defaultRules()],
    reached: true,
    noAnswerExhausted: false,
    attemptsMade: 1,
    now: NOW,
    ...overrides,
  };
}

function slot(overrides: Partial<EvaluatedSlot> = {}): EvaluatedSlot {
  return { questionId: "symptom_severity", status: "answered", ...overrides };
}

describe("evaluate — purity", () => {
  it("returns the same result for the same input, every time", () => {
    const args = input({
      slots: [slot({ questionId: "requests_clinician", valueBool: true })],
    });
    expect(evaluate(args)).toEqual(evaluate(args));
  });

  it("never mutates the input it was given", () => {
    const slots = [slot({ status: "unmappable" })];
    const rules = lockedRules();
    const frozen = JSON.stringify({ slots, rules });
    evaluate(input({ slots, rules }));
    expect(JSON.stringify({ slots, rules })).toBe(frozen);
  });

  it("reads no clock — `now` is injected and nothing else is consulted", () => {
    const args = input({ now: new Date("2001-01-01T00:00:00Z") });
    expect(evaluate(args)).toEqual(evaluate(args));
  });
});

describe("evaluate — a clear call", () => {
  it("raises nothing when every answer mapped", () => {
    const result = evaluate(
      input({
        slots: [
          slot({ questionId: "symptom_change", valueText: "better" }),
          slot({ questionId: "requests_clinician", valueBool: false }),
        ],
      }),
    );
    expect(result.hits).toEqual([]);
    expect(result.shouldPause).toBe(false);
  });
});

describe("evaluate — the floor", () => {
  it("escalates urgently when the patient asks for a clinician", () => {
    const result = evaluate(
      input({
        slots: [
          slot({
            questionId: "requests_clinician",
            valueBool: true,
            utterance: "Can I speak to someone please?",
          }),
        ],
      }),
    );

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ruleId).toBe("patient_requests_clinician");
    expect(result.hits[0].urgent).toBe(true);
    expect(result.hits[0].utterance).toBe("Can I speak to someone please?");
    expect(result.shouldPause).toBe(true);
  });

  it("escalates urgently on emergency language", () => {
    const result = evaluate(
      input({ slots: [slot({ questionId: "emergency_language_heard", valueBool: true })] }),
    );
    expect(result.hits[0].ruleId).toBe("emergency_language");
    expect(result.shouldPause).toBe(true);
  });

  it("cannot be disarmed by a plan that omits them", () => {
    const restored = withLockedRules([] as PlanRule[]);
    const result = evaluate(
      input({
        rules: restored,
        slots: [slot({ questionId: "requests_clinician", valueBool: true })],
      }),
    );
    expect(result.hits[0].ruleId).toBe("patient_requests_clinician");
  });

  /*
   * The floor is exactly this and no more. Everything a model can read from a
   * transcript is read by the model; these are the facts that survive it being
   * unavailable, so the set staying small is the guarantee, not an omission.
   */
  it("is four rules, three of them locked", () => {
    const all = [...lockedRules(), ...defaultRules()];
    expect(all).toHaveLength(4);
    expect(all.filter((r) => r.source === "locked")).toHaveLength(3);
    expect(all.map((r) => r.rule.kind).sort()).toEqual([
      "emergency_language",
      "no_answer_exhausted",
      "patient_requests_clinician",
      "unmappable_response",
    ]);
  });
});

describe("evaluate — unmappable answers", () => {
  it("escalates an unmappable answer, carrying the words that caused it", () => {
    const result = evaluate(
      input({
        slots: [
          slot({
            status: "unmappable",
            utterance: "Well, it's the same as it was, more or less.",
          }),
        ],
      }),
    );

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ruleId).toBe("unmappable_response");
    expect(result.hits[0].utterance).toBe("Well, it's the same as it was, more or less.");
  });

  /*
   * It escalates; it does not stop the follow-up.
   *
   * This was urgent once, and it cost a real patient both remaining attempts:
   * a declined call produced `missing` slots, the rule fired, the plan paused,
   * and `scheduleRetry` refuses a plan that is not active. The commonest reason
   * a call is useless must not be the thing that disables the retry ladder.
   */
  it("does not pause the plan — a retry may still get a clean answer", () => {
    const result = evaluate(
      input({ slots: [slot({ questionId: "pain_score", status: "missing" })] }),
    );
    expect(result.hits[0].ruleId).toBe("unmappable_response");
    expect(result.hits[0].urgent).toBe(false);
    expect(result.shouldPause).toBe(false);
  });

  it("names the question when only one could not be mapped", () => {
    const result = evaluate(
      input({ slots: [slot({ questionId: "pain_score", status: "unmappable" })] }),
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].reason).toContain('"pain score" could not be mapped');
  });

  /*
   * One hit for the call, not one per slot. A real call raised five identical
   * rows in the queue, which buries everything else waiting there.
   */
  it("raises one hit for the whole call, naming every question it covers", () => {
    const result = evaluate(
      input({
        slots: [
          slot({ questionId: "pain_score", status: "unmappable" }),
          slot({ questionId: "moving_normally", status: "missing" }),
        ],
      }),
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].reason).toContain("2 answers could not be mapped");
    expect(result.hits[0].reason).toContain("pain score");
    expect(result.hits[0].reason).toContain("moving normally");
  });

  /*
   * Silence is not an unmappable answer. Without this gate every unanswered
   * call would raise it on every question.
   */
  it("stays silent when nobody spoke", () => {
    const result = evaluate(
      input({
        reached: false,
        slots: [
          slot({ questionId: "pain_score", status: "missing" }),
          slot({ questionId: "moving_normally", status: "missing" }),
        ],
      }),
    );
    expect(result.hits.map((h) => h.ruleId)).not.toContain("unmappable_response");
  });
});

describe("evaluate — nobody ever answered", () => {
  it("escalates once every attempt for the day has gone unanswered", () => {
    const result = evaluate(
      input({ reached: false, noAnswerExhausted: true, attemptsMade: 3 }),
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ruleId).toBe("no_answer_exhausted");
    expect(result.hits[0].reason).toContain("3 attempts");
  });

  /*
   * A ladder that exhausted because the number could not be dialled and one
   * that exhausted because a patient did not pick up are the same row in the
   * queue and two completely different jobs for whoever opens it.
   */
  it("says the number was refused, not that nobody answered", () => {
    const result = evaluate(
      input({
        reached: false,
        noAnswerExhausted: true,
        attemptsMade: 3,
        networkRefusedAll: true,
      }),
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ruleId).toBe("no_answer_exhausted");
    expect(result.hits[0].ruleLabel).toBe("This number could not be reached");
    expect(result.hits[0].reason).toContain("network refused every one");
    expect(result.hits[0].reason).not.toContain("nobody spoke");
  });

  it("keeps the unanswered wording when the flag is absent", () => {
    const result = evaluate(
      input({ reached: false, noAnswerExhausted: true, attemptsMade: 3 }),
    );
    expect(result.hits[0].reason).toContain("nobody spoke");
  });

  it("stays quiet while attempts remain", () => {
    const result = evaluate(
      input({ reached: false, noAnswerExhausted: true, attemptsMade: 2 }),
    );
    expect(result.hits).toEqual([]);
  });

  /* The reason a clinician reads must not name a failure code — nothing reads
     one any more, and CALL-E publishes no enum for them. */
  it("explains itself without quoting a failure code", () => {
    const result = evaluate(
      input({ reached: false, noAnswerExhausted: true, attemptsMade: 3 }),
    );
    expect(result.hits[0].reason).not.toMatch(/failure code/i);
    expect(result.hits[0].reason).toContain("nobody spoke");
  });
});

describe("evaluate — ordering", () => {
  it("puts urgent hits first, so a queue reads worst-first", () => {
    const result = evaluate(
      input({
        slots: [
          slot({ questionId: "pain_score", status: "unmappable" }),
          slot({ questionId: "requests_clinician", valueBool: true }),
        ],
      }),
    );
    expect(result.hits[0].urgent).toBe(true);
    expect(result.hits[0].ruleId).toBe("patient_requests_clinician");
    expect(result.shouldPause).toBe(true);
  });

  it("evaluates every rule rather than stopping at the first hit", () => {
    const result = evaluate(
      input({
        slots: [
          slot({ questionId: "requests_clinician", valueBool: true }),
          slot({ questionId: "emergency_language_heard", valueBool: true }),
        ],
      }),
    );
    expect(result.hits.map((h) => h.ruleId).sort()).toEqual([
      "emergency_language",
      "patient_requests_clinician",
    ]);
  });
});
