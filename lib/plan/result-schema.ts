/**
 * The JSON Schema CALL-E fills in, built from a plan's questions.
 *
 * Hand-written objects with `as const satisfies JsonObject`, plus a mirrored TS
 * interface. No zod: the schema crosses a network boundary into someone else's
 * model, so what matters is the exact JSON we send, and a library that
 * generates it is a layer between us and the thing being debugged.
 *
 * **Every answer is a string enum carrying an explicit `unknown`.**
 *
 * An earlier version made each property nullable with `type: ["boolean", "null"]`.
 * The live API rejected the whole request — `result_schema is not supported` —
 * because a type union is `anyOf` in disguise, and CALL-E's supported subset is
 * `type`, `properties`, `required`, `enum`, nested objects, simple `array.items`,
 * `description` and `additionalProperties: false`. Nothing else.
 *
 * Its own guidance points somewhere better than where we were: prefer string
 * enums over booleans for anything that might be unclear, and include an
 * `unknown` value for when the call does not provide enough evidence. So "we
 * could not map this" is now a value the model must actively choose, rather
 * than an absence we infer — which is a stronger version of the same idea. Every
 * field is `required`, because with `unknown` available there is no honest
 * reason to omit one.
 */

import type { JsonObject } from "@call-e/calle";
import type { AnswerType } from "@/lib/db/enums";
import { UNSPOKEN_RESULT_KEYS } from "@/lib/plan/universal-questions";

/**
 * The keys the locked rules read. They are in every plan's schema whatever the
 * doctor edits, because a locked rule with no key to read is a disarmed rule.
 */
const LOCKED_RESULT_KEYS = new Set([
  "reached_patient",
  "consent_given",
  "requests_clinician",
  "emergency_language_heard",
]);

export interface SchemaQuestion {
  questionId: string;
  prompt: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
}

/** The value every enum carries. Extraction turns it into an `unmappable` slot. */
export const UNKNOWN = "unknown";

const YES_NO = ["yes", "no", UNKNOWN] as const;

/**
 * The keys every follow-up call carries, whatever the plan asks.
 *
 * Three of them back rules that can never be removed, so they are never left to
 * a compiler or a clinician to include.
 */
export const UNIVERSAL_RESULT_KEYS = {
  reached_patient: {
    type: "string",
    enum: YES_NO,
    description:
      "yes only if the person who answered confirmed they are the patient. no if it was someone else. unknown if nobody answered or it was never established.",
  },
  consent_given: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient agreed to go through the questions on this call. no if they declined. unknown if it was never established.",
  },
  requests_clinician: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient asked to speak to a person, a nurse, or their doctor at any point in the call.",
  },
  emergency_language_heard: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient described something that sounded like an emergency. Report what you heard; do not decide whether it is one.",
  },
  /*
   * The four below are the product's answer to "can the model judge urgency?".
   *
   * It observes; code decides. Each is a description of what the patient
   * expressed, never an assessment of what it means — so the pure rule engine
   * can read them and a clinician can set the threshold. No second model pass,
   * no extra call: CALL-E's existing extraction fills them.
   */
  symptom_change: {
    type: "string",
    enum: ["better", "same", "worse", UNKNOWN],
    description:
      "How the patient compared today with the last time they were asked, in their own words. Report their comparison; do not form your own. unknown if they did not compare.",
  },
  patient_concern: {
    type: "string",
    enum: ["not_concerned", "mildly", "very", UNKNOWN],
    description:
      "How concerned the patient themselves sounded about how they are doing. Report what they expressed; do not assess whether the concern is warranted. unknown if they gave no sign.",
  },
  something_else_raised: {
    type: "string",
    enum: ["yes", "no", UNKNOWN],
    description:
      "yes if the patient raised anything the questions did not cover — a new symptom, a problem at home, a worry about their treatment.",
  },
  what_else: {
    type: "string",
    description:
      "If something_else_raised is yes, what they raised, in their own words. Write 'unknown' otherwise.",
  },
  call_recap: {
    type: "string",
    description:
      "One line on what the patient said, using their own words where you can. Not an interpretation. Write 'unknown' if nobody spoke.",
  },
} as const satisfies JsonObject;

/** The typed view of the universal keys, as they arrive from CALL-E. */
export interface UniversalResult {
  reached_patient: string;
  consent_given: string;
  requests_clinician: string;
  emergency_language_heard: string;
  symptom_change: string;
  patient_concern: string;
  something_else_raised: string;
  what_else: string;
  call_recap: string;
}

/** One question's property. Always an enum with `unknown`, except free text. */
function propertyFor(q: SchemaQuestion): JsonObject {
  switch (q.answerType) {
    case "boolean":
      return {
        type: "string",
        enum: [...YES_NO],
        description: `${q.prompt} Answer unknown if they did not give a clear yes or no.`,
      };

    case "scale_0_10":
      return {
        // A string enum rather than an integer, because an integer type has no
        // way to say "they never gave me a number" — and inventing one is the
        // failure this whole design exists to prevent.
        type: "string",
        enum: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", UNKNOWN],
        description: `${q.prompt} Answer unknown if they did not give a number.`,
      };

    case "enum":
      return {
        type: "string",
        enum: [...(q.enumValues ?? []), UNKNOWN],
        description: `${q.prompt} Answer unknown if what they said does not match one of the other values exactly. Do not pick the nearest.`,
      };

    case "text":
      return {
        type: "string",
        description: `${q.prompt} Their own words. Write unknown if they did not answer.`,
      };
  }
}

/**
 * Build the schema frozen onto a plan at approval.
 *
 * `additionalProperties: false` makes the object strict: a key CALL-E was not
 * asked for is a schema violation rather than a silent extra slot.
 */
export function buildResultSchema(questions: SchemaQuestion[]): JsonObject {
  const asked = new Set(questions.map((q) => q.questionId));

  /*
   * Only demand what something actually asks for.
   *
   * The four locked keys and the two unspoken ones are always present — the
   * locked rules read the first set, and the second set is the agent's own
   * notes on the call. The three default universals are not: they are ordinary
   * question rows a doctor is allowed to delete, and this used to spread them
   * unconditionally, so deleting one left the schema requiring a key nothing
   * would ever ask. That is the shape of bug the contract test now catches.
   */
  const properties: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(UNIVERSAL_RESULT_KEYS)) {
    const alwaysPresent =
      LOCKED_RESULT_KEYS.has(key) || (UNSPOKEN_RESULT_KEYS as readonly string[]).includes(key);
    if (alwaysPresent || asked.has(key)) properties[key] = property;
  }

  for (const q of questions) {
    // A question may not shadow a universal key: the locked rules read those,
    // and a plan-level override would quietly disarm one.
    if (q.questionId in UNIVERSAL_RESULT_KEYS) continue;
    properties[q.questionId] = propertyFor(q);
  }

  return {
    type: "object",
    properties: properties as JsonObject,
    // Everything is required, because `unknown` is always an available answer.
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** The keys a plan's schema declares, in a stable order. Used by extraction. */
export function schemaKeys(schema: JsonObject): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.keys(properties as Record<string, unknown>);
}

/**
 * Who or what actually picked up.
 *
 * CALL-E returns no built-in answered-by or AMD disposition; its documentation
 * is explicit that you define the classification yourself with a per-recipient
 * structured result. Without it a voicemail greeting and a patient are the same
 * row, and the retry ladder cannot tell "nobody was there" from "an answerphone
 * was there" — which are different clinical facts and want different handling.
 *
 * One key, deliberately. This is a routing fact, not a second survey.
 */
export const RECIPIENT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answered_by"],
  properties: {
    answered_by: {
      type: "string",
      enum: ["human", "ivr", "voicemail", "unknown"],
      description:
        "Classify what answered the call. Use human if a person spoke at any point, " +
        "including when an IVR transferred the call to one. Use voicemail if the call " +
        "reached an answerphone greeting. Use unknown if the evidence does not say.",
    },
  },
} as const satisfies JsonObject;
