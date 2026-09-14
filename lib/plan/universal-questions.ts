/**
 * What every call records, whatever the note said.
 *
 * The doctor's note no longer becomes a list of questions. It becomes a goal and
 * a few things to find out, and the calling agent asks about them in its own
 * words. What stays fixed is this: the facts every call must record so the
 * floor rules, the triage reading and the Follow-ups board have something typed
 * to read. None of them is read out — the agent records them from the
 * conversation as a whole.
 *
 * They are still inserted as real `plan_questions` rows, by code, at plan
 * creation. Extraction walks the rows, so a key that is in the result schema but
 * not in that list is recorded by the agent and then silently dropped — and
 * losing `reached_patient` that way makes every call fold to `no_answer`.
 *
 * Every prompt here passes guard phase 1 and tells the patient nothing; each is
 * a description of what to record, phrased as a question to the agent.
 */

import type { AnswerType, Provenance } from "@/lib/db/enums";

export interface UniversalQuestion {
  questionId: string;
  /** What the agent records, as a question to itself. Never read out. */
  prompt: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
  source: Provenance;
  /**
   * False when the agent records this from the call rather than asking it.
   * Every universal item is recorded, not asked: the agent asks about the
   * note's topics in its own words, and these are what it notices while doing so.
   */
  spoken?: boolean;
  /**
   * Which answers tone a patient's history as "worth a look". Presentation
   * only — nothing escalates from it. The model decides what a call meant.
   */
  escalating?: { values?: string[]; bool?: boolean; atLeast?: number };
}

export const UNIVERSAL_QUESTIONS: UniversalQuestion[] = [
  {
    questionId: "reached_patient",
    prompt: "Did the person who answered confirm they are the patient?",
    answerType: "boolean",
    source: "locked",
    spoken: false,
  },
  {
    questionId: "requests_clinician",
    prompt: "Did they ask to speak to a person?",
    answerType: "boolean",
    source: "locked",
    spoken: false,
  },
  {
    questionId: "emergency_language_heard",
    prompt: "Did they describe anything urgent or an emergency?",
    answerType: "boolean",
    source: "locked",
    spoken: false,
  },
  {
    questionId: "symptom_change",
    /* Anchored to the visit, not to the previous call: a call has to make
       sense even when yesterday's never connected. */
    prompt: "Compared with when they left the clinic, did they say they are better, the same, or worse?",
    answerType: "enum",
    enumValues: ["better", "same", "worse"],
    source: "locked",
    spoken: false,
    escalating: { values: ["worse"] },
  },
  {
    questionId: "patient_concern",
    prompt: "How concerned did they sound about how they are doing — not concerned, mildly, or very?",
    answerType: "enum",
    enumValues: ["not_concerned", "mildly", "very"],
    source: "locked",
    spoken: false,
    escalating: { values: ["very"] },
  },
  {
    questionId: "something_else_raised",
    prompt: "Did they raise anything this call was not asking about?",
    answerType: "boolean",
    source: "locked",
    spoken: false,
    escalating: { bool: true },
  },
  {
    /*
     * The goal-level answer the floor reads. With no fixed question list there
     * is no "answer that could not be mapped" per question — so whether the
     * call found out what it was for is recorded once, and an unresolved goal
     * on a reached patient is what routes the call to a person.
     */
    questionId: "goal_covered",
    prompt: "How much of what this call set out to find out did you find out — all, some, or none?",
    answerType: "enum",
    enumValues: ["all", "some", "none"],
    source: "locked",
    spoken: false,
    escalating: { values: ["none"] },
  },
];

/**
 * Result keys the agent fills in from the call as a whole, with no row.
 *
 * Exported rather than written twice because `build.ts` has to name them and
 * `result-schema.ts` has to require them.
 */
export const UNSPOKEN_RESULT_KEYS = ["call_recap", "what_else"] as const;

/** Universal ids the agent records instead of asking. All of them, now. */
export const OBSERVED_QUESTION_IDS = new Set<string>(
  UNIVERSAL_QUESTIONS.filter((q) => q.spoken === false).map((q) => q.questionId),
);

/** Ids nothing else may claim — a shadowing key would disarm a floor rule. */
export const RESERVED_QUESTION_IDS = new Set<string>([
  ...UNIVERSAL_QUESTIONS.map((q) => q.questionId),
  ...UNSPOKEN_RESULT_KEYS,
]);

/** How a key's answers should be toned in a patient's history. Empty when it has no opinion. */
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
