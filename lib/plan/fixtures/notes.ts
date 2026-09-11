/**
 * The fixture notes the compiler's answers are recorded against.
 *
 * Fictional, and each one is chosen for a failure it can expose:
 *
 *   post-op          — a full note: every watch-point should get a question
 *   short-clear      — short but clear: the compiler must not give up on it
 *   silent-schedule  — no frequency, length or time: all three stay defaults
 *
 * The answers live beside this file as JSON and are recorded by
 * `scripts/record-compile-fixtures.ts`. `padded.json` is the exception: it is
 * written by hand as an adversarial answer — a model padding the list and
 * copying style examples — because a well-behaved model will not produce one.
 */

import type { VisitKind } from "@/lib/db/enums";

export interface FixtureNote {
  name: string;
  noteBody: string;
  visitKind?: VisitKind;
}

export const FIXTURE_NOTES: FixtureNote[] = [
  {
    name: "post-op",
    visitKind: "post_op",
    noteBody:
      "Day 2 after laparoscopic cholecystectomy. Call each morning for five days. " +
      "Watch for fever, any discharge from the wound, and pain getting worse. " +
      "Escalate to me if the wound is hot or she has a fever.",
  },
  {
    name: "short-clear",
    noteBody:
      "Started amlodipine 5mg for blood pressure. Check daily for a week whether she is dizzy on standing.",
  },
  {
    name: "silent-schedule",
    noteBody:
      "Started atorvastatin 20mg at night for raised cholesterol. Ask whether she is taking it " +
      "and whether she has any muscle aches.",
  },
];
