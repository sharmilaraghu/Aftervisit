/**
 * Compile a doctor's note into a reviewable plan.
 *
 * The model's only job here is translation: turn free text into a fixed shape.
 * It is given a schema where **every defaultable field is nullable**, and told
 * explicitly to return null rather than infer. What comes back is stored
 * verbatim as `compileRaw`, then `applyDefaults` fills the nulls and
 * `assertGrounded` refuses anything the note did not say.
 *
 * The order matters and is the whole safety argument:
 *
 *   model → nulls preserved → defaults in code → grounding → guard phase 1
 *
 * Nothing downstream trusts the model. Its output is evidence, not authority.
 */

import type { JsonObject } from "@call-e/calle";

import { complete, hasProvider, NoProviderError } from "@/lib/plan/provider";
import { applyDefaults, type CompiledDraft, type ResolvedPlan } from "@/lib/plan/defaults";
import { assertGrounded, type GroundingViolation } from "@/lib/plan/grounding";
import { inspectQuestion } from "@/lib/script/guard";
import { redFlagsFor } from "@/data/red-flags";
import type { GuardFinding } from "@/lib/script/guard";
import type { PlanRule } from "@/lib/rules/types";
import type { CompileProvider } from "@/lib/db/enums";

/**
 * The compiler's output schema.
 *
 * Read the nulls. Every field a plan could default is `["x", "null"]`, and the
 * descriptions say when to use null. That nullability is not politeness — it is
 * what makes the provenance mark in the review UI trustworthy, because a value
 * present here provably came from the note.
 */
export const COMPILE_SCHEMA = {
  type: "object",
  properties: {
    reason: {
      type: ["string", "null"],
      description:
        "A short phrase naming what is being followed up, e.g. 'New metformin · tolerance and adherence'. Null if the note does not make it clear.",
    },
    condition: {
      type: ["string", "null"],
      description:
        "One of: new_metformin, heart_failure, statin_tolerance, post_op_wound, asthma, post_discharge, blood_pressure, thyroid. Null if none of them fit.",
    },
    durationDays: {
      type: ["integer", "null"],
      description:
        "How many days the doctor asked to follow up for. Null if the note does not say. Never infer a typical length.",
    },
    cadence: {
      type: ["string", "null"],
      enum: ["daily", "every_other_day", "weekly", null],
      description: "How often to call. Null if the note does not say.",
    },
    localTime: {
      type: ["string", "null"],
      description:
        "Time of day to call, as HH:MM in 24-hour form. Null if the note does not say. Never pick a sensible-sounding time.",
    },
    medications: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "Medication names written in the note, exactly as written. Null or empty if none. Never add one that is not there.",
    },
    redFlagTerms: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "Words or phrases the note says to escalate on, in the doctor's own wording. Null if the note names none.",
    },
    questions: {
      type: ["array", "null"],
      description:
        "The questions the call should ask, drawn from what the note asks about. Null if the note does not indicate any.",
      items: {
        type: "object",
        properties: {
          questionId: {
            type: "string",
            description: "A short lower_snake_case identifier, e.g. taking_as_prescribed.",
          },
          prompt: {
            type: "string",
            description:
              "The exact question to ask, phrased as a question to the patient. Never a statement, never advice, never a diagnosis.",
          },
          answerType: { type: "string", enum: ["boolean", "scale_0_10", "enum", "text"] },
          enumValues: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "The permitted answers when answerType is enum. Null otherwise.",
          },
        },
        required: ["questionId", "prompt", "answerType"],
        additionalProperties: false,
      },
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonObject;

const SYSTEM = `You convert a doctor's free-text consultation note into a structured follow-up plan for an automated phone call.

You are a translator, not a clinician. You do not decide anything about this patient's care.

Rules you must follow exactly:

1. If the note does not state something, return null for it. Never infer, never fill in a typical value, never pick something sensible. A null is the correct and expected answer — the system fills gaps itself and marks them as defaults, and it can only do that honestly if you leave them empty.
2. Never name a medication that is not written in the note.
3. Never invent a red-flag term. Only include wording the note actually uses.
4. Every question must be phrased as a question to the patient. Never write a statement, advice, reassurance, a diagnosis, or anything attributed to the doctor. Questions that give advice are rejected and thrown away.
5. Ask only about what the note asks about. Do not add questions because they seem clinically sensible.`;

export type CompileOutcome =
  | {
      ok: true;
      provider: CompileProvider;
      model: string;
      raw: unknown;
      plan: ResolvedPlan;
      /** Questions that failed guard phase 1. Kept, marked rejected, never silently dropped. */
      rejectedQuestions: { questionId: string; prompt: string; findings: GuardFinding[] }[];
    }
  | { ok: false; reason: "no_provider" | "model_error" | "not_grounded"; detail: string; violations?: GroundingViolation[] };

/** Parse the model's answer into a draft, tolerating missing keys but never inventing values. */
function toDraft(raw: unknown): CompiledDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

  return {
    reason: typeof r.reason === "string" ? r.reason : null,
    condition: typeof r.condition === "string" ? r.condition : null,
    durationDays: typeof r.durationDays === "number" ? r.durationDays : null,
    cadence: (typeof r.cadence === "string" ? r.cadence : null) as CompiledDraft["cadence"],
    localTime: typeof r.localTime === "string" ? r.localTime : null,
    medications: arr(r.medications),
    redFlagTerms: arr(r.redFlagTerms),
    questions: Array.isArray(r.questions)
      ? (r.questions as CompiledDraft["questions"])
      : null,
  };
}

export interface CompileInput {
  noteBody: string;
  /** Fallback `reason` when the note does not make one clear. */
  fallbackReason?: string;
  baseRules?: PlanRule[];
  env?: NodeJS.ProcessEnv;
}

export async function compileNote(input: CompileInput): Promise<CompileOutcome> {
  const env = input.env ?? process.env;

  if (!hasProvider(env)) {
    return {
      ok: false,
      reason: "no_provider",
      detail: new NoProviderError().message,
    };
  }

  let result;
  try {
    result = await complete(
      { system: SYSTEM, user: input.noteBody, schema: COMPILE_SCHEMA },
      env,
    );
  } catch (error) {
    return {
      ok: false,
      reason: "model_error",
      detail:
        error instanceof Error
          ? `The note could not be compiled: ${error.message}`
          : "The note could not be compiled.",
    };
  }

  const draft = toDraft(result.raw);

  /*
   * Grounding, before anything else is done with the draft. Medications come
   * first because that is the one that reaches a patient's ear.
   */
  const grounding = assertGrounded({
    noteBody: input.noteBody,
    medications: draft.medications ?? [],
    compilerAddedTerms: draft.redFlagTerms ?? [],
  });

  if (!grounding.ok) {
    return {
      ok: false,
      reason: "not_grounded",
      detail:
        "The compiled plan referred to something the note does not contain. " +
        "Care Loop will not ground a call in text the doctor did not write.",
      violations: grounding.violations,
    };
  }

  const plan = applyDefaults(draft, {
    fallbackReason: input.fallbackReason ?? "Follow-up",
    baseRedFlags: redFlagsFor(draft.condition),
    baseRules: input.baseRules ?? [],
  });

  /*
   * Guard phase 1, on each question individually and unmasked. A rejected
   * question is kept and shown to the clinician with its findings — silently
   * dropping it would hide the fact that the model tried to give advice.
   */
  const rejectedQuestions: {
    questionId: string;
    prompt: string;
    findings: GuardFinding[];
  }[] = [];
  const approved: typeof plan.questions = [];

  for (const question of plan.questions) {
    const verdict = inspectQuestion(question.prompt);
    if (verdict.ok) {
      approved.push(question);
    } else {
      rejectedQuestions.push({
        questionId: question.questionId,
        prompt: question.prompt,
        findings: verdict.findings,
      });
    }
  }

  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    raw: result.raw,
    plan: { ...plan, questions: approved },
    rejectedQuestions,
  };
}
