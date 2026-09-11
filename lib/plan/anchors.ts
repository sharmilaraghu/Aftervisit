/**
 * Refuse a compiled question the note does not ground, or one past the cap.
 *
 * The compiler is asked for the fewest questions that cover what the note asks
 * to watch, each carrying `why` — the note's own words it serves. Asking is
 * advice a model can ignore; this is the check that fails. A question whose
 * words are not in the note is not the doctor's to ask, and a list padded past
 * five is a list nobody reviews properly.
 *
 * Refused questions are kept and shown, never dropped — the same rule the guard
 * follows — because a model padding a plan is something the doctor should see.
 *
 * Pure.
 */

import { groundedPhrase } from "@/lib/plan/grounding";
import type { DraftQuestion } from "@/lib/plan/defaults";
import type { GuardFinding } from "@/lib/script/guard";

/** The note's questions, on top of the universal ones. */
export const MAX_NOTE_QUESTIONS = 5;

/** More options than this is not a question a patient can answer on the phone. */
export const MAX_ENUM_VALUES = 5;

export interface ScreenedQuestions {
  kept: DraftQuestion[];
  refused: { question: DraftQuestion; findings: GuardFinding[] }[];
}

function finding(category: GuardFinding["category"], match: string, reason: string): GuardFinding {
  return { category, match, index: -1, reason };
}

export function screenQuestions(questions: DraftQuestion[], noteText: string): ScreenedQuestions {
  const kept: DraftQuestion[] = [];
  const refused: ScreenedQuestions["refused"] = [];

  questions.forEach((question, i) => {
    if (i >= MAX_NOTE_QUESTIONS) {
      refused.push({
        question,
        findings: [
          finding(
            "over_limit",
            "",
            `The note's questions are capped at ${MAX_NOTE_QUESTIONS} — the fewest that cover what it asks. This one came after the cap.`,
          ),
        ],
      });
      return;
    }

    if (question.answerType === "enum" && (question.enumValues?.length ?? 0) > MAX_ENUM_VALUES) {
      refused.push({
        question,
        findings: [
          finding(
            "over_limit",
            "",
            `More than ${MAX_ENUM_VALUES} answers to choose from is not a question a patient can answer by phone.`,
          ),
        ],
      });
      return;
    }

    const why = question.why?.trim() ?? "";
    /* The note's own phrase inside the quote — the anchor the doctor is shown
       is their words, not the model's framing of them. */
    const anchor = why ? groundedPhrase(noteText, why) : null;
    if (!anchor) {
      refused.push({
        question,
        findings: [
          finding(
            "not_anchored",
            why,
            why
              ? "Those words are not in the note. A question the note does not ask for is not the doctor's to ask."
              : "It does not quote anything in the note. A question the note does not ask for is not the doctor's to ask.",
          ),
        ],
      });
      return;
    }

    kept.push({ ...question, why: anchor });
  });

  return { kept, refused };
}
