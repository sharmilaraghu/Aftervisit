/**
 * What the triage model must return.
 *
 * Hand-written JSON Schema with a mirrored TypeScript interface, the way every
 * schema in this codebase is written — no zod. The descriptions are load-bearing
 * rather than documentation: they are the only instruction the model gets about
 * each field, and `temperature: 0` means the wording matters.
 *
 * Every field is required. An optional field is one a model can quietly decline
 * to fill, and a missing verdict is exactly the ambiguity the fail-closed path
 * exists to remove.
 */

import type { JsonObject } from "@call-e/calle";
import { TRIAGE_VERDICTS } from "@/lib/db/enums";
import type { TriageVerdict } from "@/lib/db/enums";

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: [...TRIAGE_VERDICTS],
      description:
        "severe: the patient described something a clinician should see today. " +
        "escalate: a clinician should read this before the next call, but it is not urgent. " +
        "low: nothing in this call needs a person.",
    },
    reason: {
      type: "string",
      description:
        "One or two sentences saying why this verdict, in plain language a doctor would " +
        "accept. Name what the patient said. Never diagnose, never advise, never reassure.",
    },
    summary: {
      type: "string",
      description:
        "What happened on this call, for a clinician who was not on it. Three sentences at " +
        "most. Use the patient's own words where you can.",
    },
    keyTerms: {
      type: "array",
      items: { type: "string" },
      description:
        "The words or short phrases from the transcript that drove the verdict. Copy them " +
        "exactly as the patient said them. Never paraphrase, never add a clinical term the " +
        "patient did not use. Empty if nothing stood out.",
    },
    matchedConcerns: {
      type: "array",
      items: { type: "string" },
      description:
        "Which of the doctor's own escalation conditions this call touched, quoted in the " +
        "doctor's wording. Empty if none of them were touched, or if they gave none.",
    },
    quote: {
      type: "string",
      description:
        "One line the patient actually said, verbatim from the transcript. Write 'unknown' " +
        "if nobody spoke.",
    },
  },
  required: ["verdict", "reason", "summary", "keyTerms", "matchedConcerns", "quote"],
  additionalProperties: false,
} as const satisfies JsonObject;

/** The mirrored shape. Kept beside the schema so the two cannot drift unnoticed. */
export interface TriageAnswer {
  verdict: TriageVerdict;
  reason: string;
  summary: string;
  keyTerms: string[];
  matchedConcerns: string[];
  quote: string;
}

/**
 * Read the model's answer, or refuse it.
 *
 * Deliberately strict about `verdict` and forgiving about everything else: a
 * verdict outside the enum is unusable and must fail closed, whereas a missing
 * `keyTerms` array is a thinner report, not a wrong one. Returning null here is
 * what routes the call into the `unparseable` branch.
 */
export function readTriageAnswer(raw: unknown): TriageAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const verdict = String(r.verdict ?? "");
  if (!(TRIAGE_VERDICTS as readonly string[]).includes(verdict)) return null;

  const reason = typeof r.reason === "string" ? r.reason.trim() : "";
  if (!reason) return null;

  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];

  return {
    verdict: verdict as TriageVerdict,
    reason,
    summary: typeof r.summary === "string" ? r.summary.trim() : "",
    keyTerms: strings(r.keyTerms),
    matchedConcerns: strings(r.matchedConcerns),
    quote: typeof r.quote === "string" && r.quote.trim() !== "unknown" ? r.quote.trim() : "",
  };
}
