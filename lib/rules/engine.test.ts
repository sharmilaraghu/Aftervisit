import { describe, expect, it } from "vitest";

import { evaluate, type EvaluationInput, type EvaluatedSlot } from "@/lib/rules/engine";
import { lockedRules, withLockedRules } from "@/lib/rules/catalog";
import type { PlanRule } from "@/lib/rules/types";

const NOW = new Date("2026-08-30T09:00:00Z");

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    slots: [],
    rules: lockedRules(),
    redFlagTerms: [],
    reached: true,
    noAnswerExhausted: false,
    attemptsMade: 1,
    quietForDays: 0,
    taskCompleted: true,
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
    const a = evaluate(args);
    const b = evaluate(args);
    expect(a).toEqual(b);
  });

  it("does not read a clock: moving `now` alone changes nothing", () => {
    const slots = [slot({ questionId: "requests_clinician", valueBool: true })];
    const early = evaluate(input({ slots, now: new Date("2020-01-01T00:00:00Z") }));
    const late = evaluate(input({ slots, now: new Date("2030-01-01T00:00:00Z") }));
    expect(early).toEqual(late);
  });

  it("does not mutate its input", () => {
    const args = input({ slots: [slot({ questionId: "requests_clinician", valueBool: true })] });
    const snapshot = structuredClone(args);
    evaluate(args);
    expect(args).toEqual(snapshot);
  });
});

describe("evaluate — a clear call", () => {
  it("escalates nothing when every answer came back clean", () => {
    const result = evaluate(
      input({
        slots: [
          slot({ questionId: "reached_patient", valueBool: true }),
          slot({ questionId: "consent_given", valueBool: true }),
          slot({ questionId: "taking_as_prescribed", valueBool: true }),
          slot({ questionId: "symptom_severity", valueText: "none" }),
          slot({ questionId: "requests_clinician", valueBool: false }),
          slot({ questionId: "emergency_language_heard", valueBool: false }),
        ],
      }),
    );

    expect(result.hits).toEqual([]);
    expect(result.shouldPause).toBe(false);
  });
});

describe("evaluate — the three locked rules", () => {
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

  /*
   * The behaviour the whole product turns on. An answer nobody could map is
   * not an absence to be tidied away — it is the escalation.
   */
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
    expect(result.hits[0].urgent).toBe(true);
    expect(result.hits[0].utterance).toBe("Well, it's the same as it was, more or less.");
  });

  it("escalates a missing answer the same way, naming the question", () => {
    const result = evaluate(
      input({ slots: [slot({ questionId: "pain_score", status: "missing" })] }),
    );
    expect(result.hits[0].ruleId).toBe("unmappable_response");
    expect(result.hits[0].reason).toContain("pain score");
  });

  /*
   * One hit for the call, not one per slot. A real call raised five identical
   * rows in the queue, which buries everything else waiting there — and the
   * clinician takes one action, not five.
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

  it("names the single question when only one could not be mapped", () => {
    const result = evaluate(
      input({ slots: [slot({ questionId: "pain_score", status: "unmappable" })] }),
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].reason).toContain('"pain score" could not be mapped');
  });

  it("cannot be disarmed by a plan that omits them", () => {
    const withoutLocked: PlanRule[] = [];
    const restored = withLockedRules(withoutLocked);
    const result = evaluate(
      input({
        rules: restored,
        slots: [slot({ questionId: "requests_clinician", valueBool: true })],
      }),
    );
    expect(result.hits[0].ruleId).toBe("patient_requests_clinician");
  });
});

describe("evaluate — red flag terms", () => {
  const rule: PlanRule = {
    rule: { kind: "red_flag_term_heard", terms: ["vomiting", "threw up"], urgent: true },
    source: "default",
    label: "Red flag term heard",
  };

  it("fires when a listed term appears in the patient's words", () => {
    const result = evaluate(
      input({
        rules: [rule],
        slots: [slot({ utterance: "I threw up twice yesterday and couldn't keep water down." })],
      }),
    );

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].reason).toContain('"threw up"');
    expect(result.hits[0].utterance).toContain("threw up twice");
  });

  it("is case-insensitive", () => {
    const result = evaluate(
      input({ rules: [rule], slots: [slot({ utterance: "Lots of VOMITING." })] }),
    );
    expect(result.hits).toHaveLength(1);
  });

  it("stays silent when no term appears", () => {
    const result = evaluate(
      input({ rules: [rule], slots: [slot({ utterance: "All fine, no problems." })] }),
    );
    expect(result.hits).toEqual([]);
  });

  /*
   * The same sentence is attached to several slots whenever extraction cannot
   * pin an answer to its question. One red flag heard once must reach the queue
   * once, or an identical quote buries everything else waiting there.
   */
  it("fires once per sentence, not once per slot that carries it", () => {
    const words = "I threw up twice yesterday.";
    const result = evaluate(
      input({
        rules: [rule],
        slots: [
          slot({ questionId: "a", utterance: words }),
          slot({ questionId: "b", utterance: words }),
          slot({ questionId: "c", utterance: words }),
        ],
      }),
    );
    expect(result.hits).toHaveLength(1);
  });

  it("still reports two genuinely different sentences separately", () => {
    const result = evaluate(
      input({
        rules: [rule],
        slots: [
          slot({ questionId: "a", utterance: "I threw up twice yesterday." }),
          slot({ questionId: "b", utterance: "Still vomiting this morning." }),
        ],
      }),
    );
    expect(result.hits).toHaveLength(2);
  });

  /*
   * Deliberately over-matching. "no vomiting" fires, and that is the correct
   * direction: the rule sends a person to read the sentence, it does not decide
   * what the sentence meant. Pinned as a test so nobody "fixes" it into
   * negation detection, which would be the engine interpreting speech.
   */
  it("fires on a negated mention too, by design", () => {
    const result = evaluate(
      input({ rules: [rule], slots: [slot({ utterance: "No vomiting at all." })] }),
    );
    expect(result.hits).toHaveLength(1);
  });
});

describe("evaluate — answer-value rules", () => {
  it("fires enum_in on a listed value only", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "enum_in", questionId: "symptom_severity", values: ["severe"], urgent: true },
        source: "default",
        label: "Severe symptoms reported",
      },
    ];

    expect(evaluate(input({ rules, slots: [slot({ valueText: "severe" })] })).hits).toHaveLength(1);
    expect(evaluate(input({ rules, slots: [slot({ valueText: "mild" })] })).hits).toEqual([]);
  });

  it("fires scale_at_least at the threshold, not just above it", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "scale_at_least", questionId: "pain", threshold: 7, urgent: false },
        source: "default",
        label: "Score reached the threshold",
      },
    ];
    const at = evaluate(input({ rules, slots: [slot({ questionId: "pain", valueNumber: 7 })] }));
    expect(at.hits).toHaveLength(1);
    expect(at.hits[0].reason).toContain("at or above the threshold of 7");
    expect(at.shouldPause).toBe(false);

    expect(
      evaluate(input({ rules, slots: [slot({ questionId: "pain", valueNumber: 6 })] })).hits,
    ).toEqual([]);
  });

  it("ignores a value-rule on a slot that was not answered", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "boolean_equals", questionId: "taking", value: false, urgent: true },
        source: "default",
        label: "Answer needs a clinician",
      },
    ];
    // status `unmappable` means we do not know the value; it must not be read as false.
    const result = evaluate(
      input({ rules, slots: [slot({ questionId: "taking", status: "unmappable", valueBool: null })] }),
    );
    expect(result.hits.map((h) => h.ruleId)).not.toContain("boolean_equals");
  });
});

describe("evaluate — the agent not finishing its own job", () => {
  const rules: PlanRule[] = [
    {
      rule: { kind: "task_incomplete", urgent: true },
      source: "default",
      label: "The agent did not finish the call",
    },
  ];

  /*
   * Seen in production: CALL-E reported the agent skipped its last two
   * questions and recorded them as answered. Those two back locked rules, so
   * the slots looked clean while the guarantee had already been lost.
   */
  it("escalates when CALL-E says the task was not completed", () => {
    const result = evaluate(input({ rules, taskCompleted: false }));
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ruleId).toBe("task_incomplete");
    expect(result.shouldPause).toBe(true);
  });

  it("stays silent when the task completed, or when CALL-E did not say", () => {
    expect(evaluate(input({ rules, taskCompleted: true })).hits).toEqual([]);
    expect(evaluate(input({ rules, taskCompleted: null })).hits).toEqual([]);
  });
});

describe("evaluate — silence", () => {
  /*
   * The bug this guard exists for: an unanswered call makes every slot
   * `missing`, and an ungated unmappable rule would then fire once per question
   * and urgently pause the plan on the first no-answer — before the retry
   * ladder had made its second attempt.
   */
  it("does not call silence an unmappable answer", () => {
    const result = evaluate(
      input({
        reached: false,
        slots: [
          slot({ questionId: "a", status: "missing" }),
          slot({ questionId: "b", status: "missing" }),
        ],
      }),
    );
    expect(result.hits).toEqual([]);
    expect(result.shouldPause).toBe(false);
  });

  it("fires no_answer_exhausted only once the attempts are actually used up", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "no_answer_exhausted", attempts: 3, urgent: false },
        source: "default",
        label: "Three attempts, no answer",
      },
    ];

    expect(
      evaluate(input({ rules, reached: false, noAnswerExhausted: true, attemptsMade: 2 })).hits,
    ).toEqual([]);

    const done = evaluate(
      input({ rules, reached: false, noAnswerExhausted: true, attemptsMade: 3 }),
    );
    expect(done.hits).toHaveLength(1);
    expect(done.hits[0].urgent).toBe(false);
    expect(done.shouldPause).toBe(false);
  });

  it("fires drift_days on the threshold, and never when nothing is known", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "drift_days", days: 3, urgent: false },
        source: "default",
        label: "No contact for three days",
      },
    ];

    expect(evaluate(input({ rules, quietForDays: 3 })).hits).toHaveLength(1);
    expect(evaluate(input({ rules, quietForDays: 2 })).hits).toEqual([]);
    expect(evaluate(input({ rules, quietForDays: null })).hits).toEqual([]);
  });
});

describe("evaluate — ordering and deduplication", () => {
  it("reports every rule that fired, not just the first", () => {
    const rules = withLockedRules([
      {
        rule: { kind: "red_flag_term_heard", terms: ["vomiting"], urgent: true },
        source: "default",
        label: "Red flag term heard",
      },
    ]);

    const result = evaluate(
      input({
        rules,
        slots: [
          slot({ questionId: "requests_clinician", valueBool: true }),
          slot({ questionId: "symptom_severity", utterance: "constant vomiting" }),
        ],
      }),
    );

    const ids = result.hits.map((h) => h.ruleId);
    expect(ids).toContain("patient_requests_clinician");
    expect(ids).toContain("red_flag_term_heard");
  });

  it("puts urgent hits first", () => {
    const rules = withLockedRules([
      {
        rule: { kind: "drift_days", days: 1, urgent: false },
        source: "default",
        label: "No contact",
      },
    ]);

    const result = evaluate(
      input({
        rules,
        quietForDays: 5,
        slots: [slot({ questionId: "emergency_language_heard", valueBool: true })],
      }),
    );

    expect(result.hits[0].urgent).toBe(true);
    expect(result.hits.at(-1)?.urgent).toBe(false);
  });

  it("collapses two rules that fired on the same slot into one hit", () => {
    const rules: PlanRule[] = [
      {
        rule: { kind: "red_flag_term_heard", terms: ["vomiting"], urgent: true },
        source: "default",
        label: "Red flag term heard",
      },
      {
        rule: { kind: "red_flag_term_heard", terms: ["vomiting", "sick"], urgent: true },
        source: "clinician",
        label: "Red flag term heard",
      },
    ];

    const result = evaluate(
      input({ rules, slots: [slot({ utterance: "vomiting since last night" })] }),
    );
    expect(result.hits).toHaveLength(1);
  });
});
