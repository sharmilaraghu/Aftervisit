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
    prompt: "Would you like someone from the care team to call you back?",
    answerType: "boolean",
    source: "locked",
  },
  {
    questionId: "emergency_language_heard",
    prompt: "Is there anything urgent you need help with right now?",
    answerType: "boolean",
    source: "locked",
  },
  /*
   * The three below are what let a clinician set "what counts as an emergency
   * for this patient" against something richer than a yes/no. The model reports
   * what the patient expressed; the rule engine decides what that means.
   */
  {
    questionId: "symptom_change",
    prompt: "Compared with the last time we spoke, would you say things are better, about the same, or worse?",
    answerType: "enum",
    enumValues: ["better", "same", "worse"],
    source: "default",
  },
  {
    questionId: "patient_concern",
    prompt: "How concerned are you about how you are doing — not concerned, mildly, or very?",
    answerType: "enum",
    enumValues: ["not_concerned", "mildly", "very"],
    source: "default",
  },
  {
    questionId: "something_else_raised",
    prompt: "Is there anything else you want me to pass on to the care team?",
    answerType: "boolean",
    source: "default",
  },
];

/** Ids the compiler may not claim — a plan question shadowing one would disarm a locked rule. */
export const RESERVED_QUESTION_IDS = new Set([
  ...UNIVERSAL_QUESTIONS.map((q) => q.questionId),
  // Extracted but never spoken: they are written from the call as a whole.
  "call_recap",
  "what_else",
]);
