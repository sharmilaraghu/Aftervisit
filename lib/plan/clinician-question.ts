/**
 * The clinician's own question: its slug, and what makes one askable.
 *
 * Pure, and tested, because a slug is the CALL-E resultSchema key and the slot's
 * `question_id`. A collision does not fail loudly — it collapses two questions
 * into one answer, and `on conflict do nothing` would drop the second silently.
 *
 * Nothing here decides whether a question is *safe*. That is guard phase 1, run
 * inside `lib/db/plans.ts` on the way to the row, so no call site can skip it.
 */

import { ANSWER_TYPES, type AnswerType } from "@/lib/db/enums";
import { UNKNOWN } from "@/lib/plan/result-schema";
import { RESERVED_QUESTION_IDS } from "@/lib/plan/universal-questions";
import type { GuardFinding } from "@/lib/script/guard";

/** Each answer type in the doctor's words, not the DSL's. */
export const ANSWER_TYPE_OPTIONS: { value: AnswerType; label: string }[] = [
  { value: "boolean", label: "yes / no" },
  { value: "scale_0_10", label: "0–10" },
  { value: "enum", label: "one of" },
  { value: "text", label: "their own words" },
];

export const ANSWER_LABEL: Record<string, string> = Object.fromEntries(
  ANSWER_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * What an edit returns to the review screen.
 *
 * A refusal carries the guard's own findings rather than a summary of them: the
 * doctor is told which words were refused and why, in the guard's wording.
 */
export type QuestionEditResult =
  | { ok: true }
  | { ok: false; error: string; findings?: GuardFinding[] };

/**
 * Words dropped from a slug so a hand-written question reads like a compiled
 * one — `taking_tablets_food`, not `are_you_taking_the_tablets_with`.
 */
const FILLER = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can", "did",
  "do", "does", "for", "from", "had", "has", "have", "how", "i", "in", "is", "it", "me",
  "much", "my", "of", "on", "or", "please", "so", "that", "the", "their", "them",
  "there", "they", "this", "to", "up", "was", "were", "will", "with", "would", "you",
  "your",
]);

/** Longest a slug's stem may run, so a rambling prompt cannot produce a column-wide key. */
const MAX_SLUG = 48;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** `lower_snake_case`, the spelling the compiler's schema asks the model for. */
export function toSnakeCase(text: string): string {
  return words(text).join("_").slice(0, MAX_SLUG).replace(/_+$/, "");
}

/**
 * Derive a stable slug for a hand-written question.
 *
 * `taken` is the plan's existing slugs; the reserved ids are added here rather
 * than left to the caller, because a question shadowing `reached_patient` would
 * disarm a locked rule.
 */
export function questionSlug(prompt: string, taken: Iterable<string>): string {
  const all = words(prompt);
  const content = all.filter((w) => !FILLER.has(w));
  const stem = toSnakeCase((content.length > 0 ? content : all).slice(0, 5).join(" "));
  // A prompt written in a non-Latin script leaves nothing to slug. It still
  // needs a key, and a numbered one is honest about carrying no meaning.
  const base = stem || "question";

  const used = new Set([...taken, ...RESERVED_QUESTION_IDS]);
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}_${n}`;
    n += 1;
  }
  return slug;
}

export interface QuestionDraft {
  prompt: string;
  answerType: AnswerType;
  enumValues: string[] | null;
}

export type QuestionDraftResult =
  | { ok: true; draft: QuestionDraft }
  | { ok: false; error: string };

/** Longest question the agent will read out. Past this it is a paragraph, not a question. */
const MAX_PROMPT = 300;

/**
 * Check a hand-written question's shape. Hand-written, matching the repo's
 * schemas — a validation library here would only hide how little is being asked.
 */
export function validateQuestionDraft(input: {
  prompt: string;
  answerType: string;
  /** Comma- or newline-separated, as typed. */
  enumValues?: string;
}): QuestionDraftResult {
  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    return { ok: false, error: "Write the question first. Care Loop will not ask an empty one." };
  }
  if (prompt.length > MAX_PROMPT) {
    return {
      ok: false,
      error: `That is ${prompt.length} characters. Keep it under ${MAX_PROMPT} — it has to be asked out loud.`,
    };
  }

  if (!(ANSWER_TYPES as readonly string[]).includes(input.answerType)) {
    return { ok: false, error: "Choose what kind of answer this question has." };
  }
  const answerType = input.answerType as AnswerType;

  if (answerType !== "enum") return { ok: true, draft: { prompt, answerType, enumValues: null } };

  const values: string[] = [];
  for (const raw of (input.enumValues ?? "").split(/[,\n]/)) {
    const value = toSnakeCase(raw);
    // `unknown` is appended to every enum by `buildResultSchema`, and it is what
    // makes "we could not map this" an answer rather than an absence. A second
    // copy would be a duplicate in the schema CALL-E is sent.
    if (!value || value === UNKNOWN || values.includes(value)) continue;
    values.push(value);
  }
  if (values.length < 2) {
    return {
      ok: false,
      error:
        "A one-of question needs at least two answers to choose between. " +
        "Write them separated by commas, e.g. better, same, worse.",
    };
  }

  return { ok: true, draft: { prompt, answerType, enumValues: values } };
}
