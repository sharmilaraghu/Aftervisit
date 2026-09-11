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
import {
  applyDefaults,
  type CompiledDraft,
  type DraftQuestion,
  type ResolvedPlan,
} from "@/lib/plan/defaults";
import { screenQuestions } from "@/lib/plan/anchors";
import { EXAMPLES_BLOCK } from "@/lib/plan/examples";
import { assertGrounded, type GroundingViolation } from "@/lib/plan/grounding";
import { inspectQuestion } from "@/lib/script/guard";
import { redFlagsFor } from "@/data/red-flags";
import type { GuardFinding } from "@/lib/script/guard";
import type { PlanRule } from "@/lib/rules/types";
import type { CompileProvider, VisitKind } from "@/lib/db/enums";

/**
 * The compiler's output schema.
 *
 * Read the nulls. Every field a plan could default is `["x", "null"]`, and the
 * descriptions say when to use null. That nullability is not politeness — it is
 * what makes the provenance mark in the review UI trustworthy, because a value
 * present here provably came from the note.
 *
 * It is sent in strict mode, so it has to be the subset the API enforces:
 * every key listed in `required`, `additionalProperties: false` on every
 * object. `lib/plan/strict-schema.test.ts` holds it to that.
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
      enum: [
        "new_metformin",
        "heart_failure",
        "statin_tolerance",
        "post_op_wound",
        "asthma",
        "post_discharge",
        "blood_pressure",
        "thyroid",
        null,
      ],
      description: "The condition being followed up. Null if none of them fit.",
    },
    durationDays: {
      type: ["integer", "null"],
      description:
        "How many days the doctor asked to follow up for, only when the note says it in words (quote them in durationQuote). Null if the note does not say. Never infer a typical length.",
    },
    durationQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give how long to follow up, copied verbatim, e.g. 'for five days'. Null when durationDays is null.",
    },
    cadence: {
      type: ["string", "null"],
      enum: ["daily", "every_other_day", "weekly", null],
      description:
        "How often to call, only when the note says it in words (quote them in cadenceQuote). If the note states a frequency that is not one of these, return null here and still quote the words.",
    },
    cadenceQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give how often to call, copied verbatim, e.g. 'every morning' or 'twice a day'. Null if the note says nothing about frequency.",
    },
    localTime: {
      type: ["string", "null"],
      description:
        "Time of day to call, as HH:MM in 24-hour form, only from the note's words (quote them in localTimeQuote). A stated part of the day may be written as its representative time: morning 09:00, midday 12:00, afternoon 14:00, evening 18:00, night 20:00. Null if the note gives no time.",
    },
    localTimeQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give the time of day, copied verbatim, e.g. 'evenings after work'. Null when localTime is null.",
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
    watchPoints: {
      type: ["array", "null"],
      description:
        "Each thing the note asks to be watched or checked on, one per entry. Null if the note names none.",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The watch-point in a few plain words, e.g. 'wound discharge'.",
          },
          quote: {
            type: "string",
            description: "The note's exact words for it, copied verbatim.",
          },
        },
        required: ["text", "quote"],
        additionalProperties: false,
      },
    },
    questions: {
      type: ["array", "null"],
      description:
        "The fewest questions that cover the watch-points — at most 5. Null if the note indicates none.",
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
              "The exact question to ask, phrased as a question to the patient: one idea, plain words, never leading, never referring to an earlier call. Never a statement, never advice, never a diagnosis.",
          },
          /* Closed answers only. Free text cannot be mapped to anything a
             doctor can compare day to day, and it inflates unmappable calls. */
          answerType: { type: "string", enum: ["boolean", "scale_0_10", "enum"] },
          enumValues: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "The permitted answers when answerType is enum — at most 5. Null otherwise.",
          },
          why: {
            type: "string",
            description:
              "The note's exact words this question serves, copied verbatim. A question with no words from the note is refused.",
          },
          watchPoint: {
            type: ["integer", "null"],
            description: "The index in watchPoints of the watch-point this question covers.",
          },
        },
        required: ["questionId", "prompt", "answerType", "enumValues", "why", "watchPoint"],
        additionalProperties: false,
      },
    },
  },
  /*
   * Every key, not none. Strict structured outputs require it, and it costs
   * nothing: each of these is nullable, so "required" means "answer, even if
   * the answer is null" — which is exactly the instruction in rule 1.
   */
  required: [
    "reason",
    "condition",
    "durationDays",
    "durationQuote",
    "cadence",
    "cadenceQuote",
    "localTime",
    "localTimeQuote",
    "medications",
    "redFlagTerms",
    "watchPoints",
    "questions",
  ],
  additionalProperties: false,
} as const satisfies JsonObject;

const SYSTEM = `You convert a doctor's free-text consultation note into a structured follow-up plan for an automated phone call.

You are a translator, not a clinician. You do not decide anything about this patient's care.

Rules you must follow exactly:

1. If the note does not state something, return null for it. Never infer, never fill in a typical value, never pick something sensible. A null is the correct and expected answer — the system fills gaps itself and marks them as defaults, and it can only do that honestly if you leave them empty.
   The schedule — how often, for how long, what time — comes only from words the note actually uses, and you must copy those exact words into cadenceQuote, durationQuote and localTimeQuote, exactly as they appear in the note and without adding words. A phrase like "each morning" gives both how often and what time: quote it for both. Never choose a schedule because of the condition or because it is usual; a note that gives no schedule leaves it for the doctor to set.
2. Never name a medication that is not written in the note.
3. Never invent a red-flag term. Only include wording the note actually uses.
4. Every question must be phrased as a question to the patient. Never write a statement, advice, reassurance, a diagnosis, or anything attributed to the doctor. Questions that give advice are rejected and thrown away.
5. Ask only about what the note asks about. First list, in watchPoints, each thing the note asks to be watched, with the note's exact words. Then write the fewest questions that cover them — at most 5 — and give each one why (the note's own words it serves, copied exactly as they appear — never add framing such as "watch for" or "ask whether" that is not part of the phrase) and watchPoint (the index it covers). A question without words from the note is refused. Do not add questions because they seem clinically sensible, and do not pad the list.
6. The note may be followed by a block headed WHAT TO ESCALATE ON. That is the doctor's own list of what they want to hear about. Take its wording for redFlagTerms exactly as they wrote it. Never generalise it into a broader category, and never add a condition they did not name.
7. The patient's age may be given. Use it only to pitch the wording of a question; never to decide what to ask, and never repeat it back to the patient.
8. The note may be followed by a block headed VISIT KIND. Use it only to choose the condition and to phrase the reason. It never adds a question, a medication, or a red-flag term the note does not contain.
9. Every question stands alone: it must make sense even if no earlier call ever connected. Never write "since we last spoke", "yesterday" or "as before".
10. One idea per question, in plain words a patient would use. Never leading ("You're feeling better, aren't you?") and never two questions in one. Use a yes/no answer, a 0 to 10 scale, or a short list of at most 5 options — never free text.
11. The examples below show the style only. Never copy one unless the note asks about that thing.

STYLE EXAMPLES — style only, do not copy
${EXAMPLES_BLOCK}`;

export type CompileOutcome =
  | {
      ok: true;
      provider: CompileProvider;
      model: string;
      raw: unknown;
      plan: ResolvedPlan;
      /** Questions that failed guard phase 1. Kept, marked rejected, never silently dropped. */
      rejectedQuestions: {
        questionId: string;
        prompt: string;
        findings: GuardFinding[];
        anchorQuote?: string | null;
        watchPoint?: string | null;
      }[];
    }
  | { ok: false; reason: "no_provider" | "model_error" | "not_grounded"; detail: string; violations?: GroundingViolation[] };

/** Parse the model's answer into a draft, tolerating missing keys but never inventing values. */
function toDraft(raw: unknown): CompiledDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  return {
    reason: typeof r.reason === "string" ? r.reason : null,
    condition: typeof r.condition === "string" ? r.condition : null,
    durationDays: typeof r.durationDays === "number" ? r.durationDays : null,
    cadence: (typeof r.cadence === "string" ? r.cadence : null) as CompiledDraft["cadence"],
    localTime: typeof r.localTime === "string" ? r.localTime : null,
    durationQuote: str(r.durationQuote),
    cadenceQuote: str(r.cadenceQuote),
    localTimeQuote: str(r.localTimeQuote),
    medications: arr(r.medications),
    redFlagTerms: arr(r.redFlagTerms),
    questions: Array.isArray(r.questions)
      ? (r.questions as Record<string, unknown>[]).map(
          (q): DraftQuestion => ({
            questionId: String(q.questionId ?? ""),
            prompt: String(q.prompt ?? ""),
            answerType: q.answerType as DraftQuestion["answerType"],
            enumValues: arr(q.enumValues),
            why: str(q.why),
            watchPoint: typeof q.watchPoint === "number" ? q.watchPoint : null,
          }),
        )
      : null,
    watchPoints: Array.isArray(r.watchPoints)
      ? (r.watchPoints as Record<string, unknown>[])
          .filter((w) => typeof w?.text === "string" && typeof w?.quote === "string")
          .map((w) => ({ text: String(w.text), quote: String(w.quote) }))
      : null,
  };
}

export interface CompileInput {
  noteBody: string;
  /**
   * The doctor's own list of what to escalate on, verbatim.
   *
   * Compiled into `redFlagTerms` in their wording, and kept whole on the note
   * so the triage model can be handed it later as the reference standard.
   */
  escalationNote?: string;
  /**
   * Age only — never the name.
   *
   * It lets the model pitch a question ("are you managing the stairs?" reads
   * differently at 34 and 84), and it is the one identifying detail worth the
   * trade. A name buys nothing for compilation, so it is not sent.
   */
  patientAge?: number;
  /** Fallback `reason` when the note does not make one clear. */
  fallbackReason?: string;
  /**
   * What sort of visit the note came from. A post-operative note reads
   * differently from a consultation, and the model is told which rather than
   * left to guess from the prose. Rule 8 confines it to `condition` and
   * `reason`; grounding still refuses anything the note itself does not say.
   */
  visitKind?: VisitKind;
  baseRules?: PlanRule[];
  env?: NodeJS.ProcessEnv;
}

const VISIT_KIND_TEXT: Record<VisitKind, string> = {
  consultation: "consultation",
  post_op: "post-operative follow-up",
};

/**
 * What the model reads.
 *
 * The escalation block is labelled rather than concatenated silently, so rule 6
 * has something to point at and the doctor's wording stays attributable in the
 * raw request we persist.
 */
export function compilePrompt(input: CompileInput): string {
  const parts = [input.noteBody.trim()];
  if (input.patientAge !== undefined) parts.push(`PATIENT AGE\n\n${input.patientAge}`);
  const escalation = input.escalationNote?.trim();
  if (escalation) parts.push(`WHAT TO ESCALATE ON\n\n${escalation}`);
  if (input.visitKind) parts.push(`VISIT KIND\n\n${VISIT_KIND_TEXT[input.visitKind]}`);
  return parts.join("\n\n");
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
      { system: SYSTEM, user: compilePrompt(input), schema: COMPILE_SCHEMA, name: "follow_up_plan" },
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

  return processCompiledAnswer(result.raw, input, result.provider, result.model);
}

/**
 * Everything after the model answers: coerce, ground, default, anchor, guard.
 *
 * Pure, and separate from `compileNote` so the whole post-model pipeline can be
 * pinned by tests against a recorded answer without calling a model — see
 * `lib/plan/compile-fixtures.test.ts`. Same answer in, same outcome out.
 */
export function processCompiledAnswer(
  raw: unknown,
  input: CompileInput,
  provider: CompileProvider,
  model: string,
): CompileOutcome {
  const draft = toDraft(raw);

  /*
   * Grounding, before anything else is done with the draft. Medications come
   * first because that is the one that reaches a patient's ear.
   */
  /*
     A term the doctor wrote in the escalation box is grounded — it is their
     wording, and refusing it would reject exactly the input we just asked for.
  */
  const grounding = assertGrounded({
    noteBody: `${input.noteBody}\n${input.escalationNote ?? ""}`,
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

  // The same text grounding checked: schedule quotes and question anchors have to be in it too.
  const noteText = `${input.noteBody}\n${input.escalationNote ?? ""}`;
  const plan = applyDefaults(draft, {
    fallbackReason: input.fallbackReason ?? "Follow-up",
    baseRedFlags: redFlagsFor(draft.condition),
    baseRules: input.baseRules ?? [],
    noteText,
  });
  const watchText = (i: number | null | undefined): string | null =>
    typeof i === "number" ? (plan.watchPoints[i]?.text ?? null) : null;

  /*
   * Anchors and the cap, before the guard: a question the note does not ground,
   * or one past the fifth, is refused and shown — never quietly dropped.
   */
  const screened = screenQuestions(plan.questions, noteText);

  /*
   * Guard phase 1, on each question individually and unmasked. A rejected
   * question is kept and shown to the clinician with its findings — silently
   * dropping it would hide the fact that the model tried to give advice.
   */
  const rejectedQuestions: Extract<CompileOutcome, { ok: true }>["rejectedQuestions"] =
    screened.refused.map(({ question, findings }) => ({
      questionId: question.questionId,
      prompt: question.prompt,
      findings,
      anchorQuote: question.why ?? null,
      watchPoint: watchText(question.watchPoint),
    }));
  const approved: typeof plan.questions = [];

  for (const question of screened.kept) {
    const verdict = inspectQuestion(question.prompt);
    if (verdict.ok) {
      approved.push(question);
    } else {
      rejectedQuestions.push({
        questionId: question.questionId,
        prompt: question.prompt,
        findings: verdict.findings,
        anchorQuote: question.why ?? null,
        watchPoint: watchText(question.watchPoint),
      });
    }
  }

  return {
    ok: true,
    provider,
    model,
    raw,
    plan: { ...plan, questions: approved },
    rejectedQuestions,
  };
}
