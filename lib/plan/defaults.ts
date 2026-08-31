/**
 * Fill in what the note did not say — in code, never by the model.
 *
 * This is the file that makes the "Defaulted" mark in the review UI worth
 * anything. Every defaultable field is nullable in the compiler's output schema,
 * and the model is told to return null rather than infer. So a value is either
 * something the doctor wrote, or something this function put there — and the
 * provenance map records which, derived from where the null was, never declared
 * by the model.
 *
 * Pure. Same draft in, same plan out.
 */

import type { Cadence, Provenance } from "@/lib/db/enums";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import { defaultRules, withLockedRules } from "@/lib/rules/catalog";

/** The compiler's raw output. Every defaultable field is nullable, on purpose. */
export interface CompiledDraft {
  reason: string | null;
  condition: string | null;
  durationDays: number | null;
  cadence: Cadence | null;
  localTime: string | null;
  questions: DraftQuestion[] | null;
  redFlagTerms: string[] | null;
  medications: string[] | null;
}

export interface DraftQuestion {
  questionId: string;
  prompt: string;
  answerType: "boolean" | "scale_0_10" | "enum" | "text";
  enumValues?: string[] | null;
}

export interface PlanDefaults {
  durationDays: number;
  cadence: Cadence;
  localTime: string;
  maxAttempts: number;
  retryDelayMinutes: number;
}

export const DEFAULTS: PlanDefaults = {
  durationDays: 7,
  cadence: "daily",
  localTime: "10:00",
  maxAttempts: 3,
  retryDelayMinutes: 120,
};

export interface ResolvedPlan {
  reason: string;
  condition: string | null;
  durationDays: number;
  cadence: Cadence;
  localTime: string;
  maxAttempts: number;
  retryDelayMinutes: number;
  questions: DraftQuestion[];
  redFlagTerms: RedFlagTerm[];
  rules: PlanRule[];
  /** Field name → where its value came from. Derived here, never declared. */
  provenance: Record<string, Provenance>;
}

/** `HH:MM`, or null. A model that returns "5:30pm" has not returned a time. */
function validTime(value: string | null): string | null {
  if (!value) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function validDuration(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  // A follow-up window longer than a season is a data-entry error, not a plan.
  return value > 0 && value <= 90 ? value : null;
}

const CADENCES: Cadence[] = ["daily", "every_other_day", "weekly"];

/**
 * Apply defaults and stamp provenance.
 *
 * `baseRules` and `baseRedFlags` come from the condition catalog, so a plan is
 * never left with only whatever the model happened to mention.
 */
export function applyDefaults(
  draft: CompiledDraft,
  options: {
    fallbackReason: string;
    baseRedFlags: string[];
    baseRules: PlanRule[];
    defaults?: Partial<PlanDefaults>;
  },
): ResolvedPlan {
  const d = { ...DEFAULTS, ...options.defaults };
  const provenance: Record<string, Provenance> = {};

  // The shape of every line below is the same: the note's value if there is
  // one, otherwise ours — and the mark follows the branch that was taken.
  const take = <T>(field: string, fromNote: T | null, fallback: T): T => {
    if (fromNote !== null && fromNote !== undefined) {
      provenance[field] = "note";
      return fromNote;
    }
    provenance[field] = "default";
    return fallback;
  };

  const cadence = take<Cadence>(
    "cadence",
    draft.cadence && CADENCES.includes(draft.cadence) ? draft.cadence : null,
    d.cadence,
  );
  const durationDays = take("durationDays", validDuration(draft.durationDays), d.durationDays);
  const localTime = take("localTime", validTime(draft.localTime), d.localTime);
  const reason = take("reason", draft.reason?.trim() || null, options.fallbackReason);

  // Never offered to the model at all: a retry ladder is an operational
  // decision, not something a consultation note has an opinion about.
  provenance.maxAttempts = "default";
  provenance.retryDelayMinutes = "default";

  const noteTerms = (draft.redFlagTerms ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const baseSet = new Set(options.baseRedFlags.map((t) => t.toLowerCase()));
  const redFlagTerms: RedFlagTerm[] = [
    ...options.baseRedFlags.map((term) => ({ term, source: "default" as const })),
    // Compiler additions are marked, so the review UI can show them as
    // additions and let the clinician delete them.
    ...noteTerms
      .filter((t) => !baseSet.has(t))
      .map((term) => ({ term, source: "note" as const })),
  ];
  provenance.redFlagTerms = noteTerms.length > 0 ? "note" : "default";

  const questions = draft.questions?.length ? draft.questions : [];
  provenance.questions = questions.length > 0 ? "note" : "default";

  return {
    reason,
    condition: draft.condition,
    durationDays,
    cadence,
    localTime,
    maxAttempts: d.maxAttempts,
    retryDelayMinutes: d.retryDelayMinutes,
    questions,
    redFlagTerms,
    // The locked three are re-asserted here, so no compile path can drop them.
    rules: withLockedRules([...defaultRules(), ...options.baseRules]),
    provenance,
  };
}

/** Whether a field's value came from the doctor's note. Drives the review UI's marks. */
export function isDefaulted(
  provenance: Record<string, Provenance>,
  field: string,
): boolean {
  return provenance[field] === "default";
}
