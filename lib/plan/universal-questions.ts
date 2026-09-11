/**
 * The questions every plan asks, whatever the note said.
 *
 * Four of these back rules that can never be removed, plus the consent gate.
 * They are inserted by code at plan creation rather than left to the compiler,
 * for the same reason the locked rules are re-asserted at approval: a guarantee
 * that depends on a model remembering to include something is not a guarantee.
 *
 * They also have to exist as real `plan_questions` rows, not just as keys in the
 * result schema. Extraction walks the plan's questions — so a key that is in the
 * schema but not in that list is asked on the call, answered by the patient, and
 * then silently dropped. `reached_patient` going missing that way makes every
 * call fold to `no_answer` no matter who picked up.
 *
 * Every prompt here passes guard phase 1. They are phrased as questions and
 * tell the patient nothing.
 */

import type { AnswerType, Provenance } from "@/lib/db/enums";

export interface UniversalQuestion {
  questionId: string;
  prompt: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
  source: Provenance;
  /**
   * False when the agent records this from the call rather than asking it.
   *
   * The distinction matters because a *question* and an *observation* are
   * different instruments. "Would you like someone from the care team to call
   * you back?" asked at the end of a survey is a leading question with a
   * social answer, and it made the locked rule depend on a patient saying yes
   * to a prompt rather than on a patient actually asking for help. As an
   * observation it fires whenever they ask, at any point in the call —
   * strictly more of the thing the rule exists to catch.
   *
   * An observed item still gets a `plan_questions` row, and that is the point:
   * `extractSlots` walks the question rows, so a key with no row produces no
   * slot and a pure rule reading that slot could never fire again. Dropping
   * the row would have disabled `patient_requests_clinician` silently.
   */
  spoken?: boolean;
  /**
   * Which answers mean "a clinician should look at this".
   *
   * A property of the question, not of a plan. It used to live in the rule DSL
   * as `enum_in` / `boolean_equals` rules that `defaultRules()` stamped onto
   * every plan and no doctor ever edited — which made it look configurable when
   * it never was. It only ever tones a cell in the answer grid; nothing
   * escalates from it. The model decides what a call meant.
   */
  escalating?: { values?: string[]; bool?: boolean; atLeast?: number };
}

export const UNIVERSAL_QUESTIONS: UniversalQuestion[] = [
  {
    questionId: "reached_patient",
    prompt: "Am I speaking with the patient?",
    answerType: "boolean",
    source: "locked",
  },
  {
    questionId: "consent_given",
    prompt: "Is now a good time to go through a few follow-up questions?",
    answerType: "boolean",
    source: "locked",
  },
  {
    questionId: "requests_clinician",
    /*
     * Never spoken. The prompt survives because the review UI, the parameter
     * grid and the queue all name a question by its prompt, and because the
     * guard still inspects this string — an observation the agent records is
     * still text in the task and still has to pass phase 1.
     */
    prompt: "Did they ask to speak to a person?",
    answerType: "boolean",
    source: "locked",
    spoken: false,
  },
  {
    questionId: "emergency_language_heard",
    prompt: "Is there anything urgent you need help with right now?",
    answerType: "boolean",
    source: "locked",
  },
  /*
   * The three below are the richest signal a call produces — what the patient
   * said about themselves. Their `escalating` values tone the answer grid so a
   * clinician can scan a fortnight and see where it turned; the judgement about
   * what any of it *meant* belongs to the model reading the transcript.
   */
  {
    questionId: "symptom_change",
    /* Anchored to the visit, not to the previous call: a call has to make
       sense even when yesterday's never connected. */
    prompt: "Since you left the clinic, would you say things are better, about the same, or worse?",
    answerType: "enum",
    enumValues: ["better", "same", "worse"],
    source: "default",
    escalating: { values: ["worse"] },
  },
  {
    questionId: "patient_concern",
    prompt: "How concerned are you about how you are doing — not concerned, mildly, or very?",
    answerType: "enum",
    enumValues: ["not_concerned", "mildly", "very"],
    source: "default",
    escalating: { values: ["very"] },
  },
  {
    questionId: "something_else_raised",
    prompt: "Is there anything else you want me to pass on to the care team?",
    answerType: "boolean",
    source: "default",
    escalating: { bool: true },
  },
];

/**
 * Result keys the agent fills in from the call as a whole. Nothing asks them.
 *
 * They are exported rather than written twice because `build.ts` has to name
 * them and `result-schema.ts` has to require them, and the two drifting apart
 * is what produced the defect this constant exists to prevent: the script told
 * the agent "never record an answer to a question you did not actually ask"
 * while the schema demanded two keys nothing had asked. A contract test in
 * `dispatch-contract.test.ts` now holds the two files together.
 */
export const UNSPOKEN_RESULT_KEYS = ["call_recap", "what_else"] as const;

/**
 * Universal ids the agent records from the call instead of asking.
 *
 * Exported so `build.ts` can keep them out of the spoken block and name them
 * in the notes section instead, and so the dispatch contract test can tell an
 * observation apart from a key nothing asks and nothing records.
 */
export const OBSERVED_QUESTION_IDS = new Set<string>(
  UNIVERSAL_QUESTIONS.filter((q) => q.spoken === false).map((q) => q.questionId),
);

/** Ids the compiler may not claim — a plan question shadowing one would disarm a locked rule. */
export const RESERVED_QUESTION_IDS = new Set<string>([
  ...UNIVERSAL_QUESTIONS.map((q) => q.questionId),
  ...UNSPOKEN_RESULT_KEYS,
]);

/** How a question's answers should be toned in the grid. Empty when it has no opinion. */
export function escalatingFor(questionId: string): {
  escalatingValues: string[];
  escalatingBool: boolean | null;
  threshold: number | null;
} {
  const q = UNIVERSAL_QUESTIONS.find((u) => u.questionId === questionId);
  return {
    escalatingValues: q?.escalating?.values ?? [],
    escalatingBool: q?.escalating?.bool ?? null,
    threshold: q?.escalating?.atLeast ?? null,
  };
}
