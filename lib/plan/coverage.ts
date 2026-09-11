/**
 * Does every watch-point the note names have a question, and does every
 * question answer to a watch-point?
 *
 * The compiler proposes both lists; this compares them, in code. The two ways
 * a compiled plan goes wrong are read straight off the result:
 *
 *   underfit — a watch-point the doctor wrote with no question asking about it
 *   overfit  — a question tied to nothing the note asks, or one copied from the
 *              style examples rather than drawn from this note
 *
 * Only the note's own questions count. Universal questions are the product's,
 * and a question the doctor added is theirs and answers to nobody.
 *
 * Pure.
 */

import type { WatchPoint } from "@/lib/plan/defaults";

export interface CoverageQuestion {
  prompt: string;
  /** The watch-point text the question was compiled against, or null. */
  watchPoint: string | null;
  source: string;
}

export interface CoverageRow {
  watchPoint: WatchPoint;
  /** Prompts of the note questions that cover it. Empty is underfit. */
  questions: string[];
}

export interface CoverageReport {
  rows: CoverageRow[];
  /** How many watch-points have no question. */
  uncovered: number;
  /** Note questions tied to no watch-point the note names. */
  orphans: string[];
  /** Note questions identical to a style example. */
  templateCopies: string[];
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function coverage(
  watchPoints: WatchPoint[],
  questions: CoverageQuestion[],
  templates: string[],
): CoverageReport {
  const noteQuestions = questions.filter((q) => q.source === "note");

  const rows = watchPoints.map((watchPoint) => ({
    watchPoint,
    questions: noteQuestions
      .filter((q) => q.watchPoint !== null && norm(q.watchPoint) === norm(watchPoint.text))
      .map((q) => q.prompt),
  }));

  const named = new Set(watchPoints.map((w) => norm(w.text)));
  const orphans = noteQuestions
    .filter((q) => q.watchPoint === null || !named.has(norm(q.watchPoint)))
    .map((q) => q.prompt);

  const examples = new Set(templates.map(norm));
  const templateCopies = noteQuestions
    .filter((q) => examples.has(norm(q.prompt)))
    .map((q) => q.prompt);

  return {
    rows,
    uncovered: rows.filter((r) => r.questions.length === 0).length,
    orphans,
    templateCopies,
  };
}
