/**
 * The JSON Schema CALL-E fills in for every follow-up call.
 *
 * Hand-written objects with `as const satisfies JsonObject`. No zod: the schema
 * crosses a network boundary into someone else's model, so what matters is the
 * exact JSON we send.
 *
 * **Every answer is a string enum carrying an explicit `unknown`.** CALL-E's
 * supported subset is `type`, `properties`, `required`, `enum`, nested objects,
 * simple `array.items`, `description` and `additionalProperties: false` — a type
 * union was rejected outright by the live API. So "we could not map this" is a
 * value the model must actively choose, not an absence we infer.
 *
 * The shape is fixed, with one variable part. The universal keys are the same on
 * every call; the note's topics each add one small nested object — `topic_1` to
 * `topic_5` — holding what the patient said about it. Nested objects rather than
 * an array of objects, because nested objects are squarely inside the documented
 * subset and an array of objects is not something to discover live.
 */

import type { JsonObject } from "@call-e/calle";

/** The value every enum carries. Extraction turns it into an `unmappable` slot. */
export const UNKNOWN = "unknown";

const YES_NO = ["yes", "no", UNKNOWN] as const;

/** The most topics a plan carries. Matches the compiler's cap. */
export const MAX_TOPICS = 5;

/**
 * The keys every follow-up call carries.
 *
 * Three back floor rules that can never be removed; `goal_covered` backs the
 * fourth. None is left to a compiler to include.
 */
export const UNIVERSAL_RESULT_KEYS = {
  reached_patient: {
    type: "string",
    enum: YES_NO,
    description:
      "yes only if the person who answered confirmed they are the patient. no if it was someone else. unknown if nobody answered or it was never established.",
  },
  requests_clinician: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient asked to speak to a person, a nurse, or their doctor at any point in the call. no if they did not.",
  },
  emergency_language_heard: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient described something that sounded like an emergency. Report what you heard; do not decide whether it is one. no if they did not.",
  },
  symptom_change: {
    type: "string",
    enum: ["better", "same", "worse", UNKNOWN],
    description:
      "How the patient says they are compared with when they left the clinic, in their own words. Report their comparison; do not form your own. unknown if they did not compare.",
  },
  patient_concern: {
    type: "string",
    enum: ["not_concerned", "mildly", "very", UNKNOWN],
    description:
      "How concerned the patient themselves sounded about how they are doing. Report what they expressed; do not assess whether the concern is warranted. unknown if they gave no sign.",
  },
  something_else_raised: {
    type: "string",
    enum: YES_NO,
    description:
      "yes if the patient raised anything this call was not asking about — a new symptom, a problem at home, a worry about their treatment.",
  },
  goal_covered: {
    type: "string",
    enum: ["all", "some", "none", UNKNOWN],
    description:
      "How much of what this call set out to find out was actually found out: all, some, or none. unknown if you cannot tell.",
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

/**
 * The measurements a topic may ask for. A closed list, never free text: the
 * unit is written into the task beside the safety instructions, so a unit the
 * model could name freely would be one more place to smuggle an instruction.
 */
export const TOPIC_UNITS = [
  "celsius",
  "fahrenheit",
  "score_0_10",
  /* No blood pressure yet: it is two numbers, and one field would keep half of it. */
  "bpm",
  "kg",
  "mmol_L",
  "mg_dL",
  "times_per_day",
] as const;

export type TopicUnit = (typeof TOPIC_UNITS)[number];

/** How a unit reads beside a number, on screen and in the task. */
export const UNIT_LABEL: Record<TopicUnit, string> = {
  celsius: "°C",
  fahrenheit: "°F",
  score_0_10: "/10",
  bpm: "bpm",
  kg: "kg",
  mmol_L: "mmol/L",
  mg_dL: "mg/dL",
  times_per_day: "times a day",
};

/**
 * The widest a reading could plausibly be. Not a clinical range — a pulse of
 * 999 or a temperature of 101 °C is a mishearing or a unit mix-up, and storing
 * it as the patient's reading would put a wrong number in front of the doctor.
 */
export const UNIT_RANGE: Record<TopicUnit, [number, number]> = {
  celsius: [30, 45],
  fahrenheit: [86, 113],
  score_0_10: [0, 10],
  bpm: [20, 250],
  kg: [1, 400],
  mmol_L: [0.5, 50],
  mg_dL: [10, 900],
  times_per_day: [0, 50],
};

export function isTopicUnit(value: unknown): value is TopicUnit {
  return typeof value === "string" && (TOPIC_UNITS as readonly string[]).includes(value);
}

/** One thing to find out, as the task and the schema need it. */
export interface TopicSpec {
  text: string;
  /** Set when the note asks for a number, e.g. a temperature or a pain score. */
  unit?: TopicUnit | null;
}

/** The key holding what the patient said about the note's topic at `index`. */
export function topicKey(index: number): string {
  return `topic_${index + 1}`;
}

/** One topic's nested object. A measured topic also carries the number itself. */
function topicProperty(topic: TopicSpec): JsonObject {
  /* Re-checked here: this is fed straight from stored watch points. */
  const unit = isTopicUnit(topic.unit) ? topic.unit : null;
  const value = unit
    ? {
        value: {
          type: "string",
          description: `The single number they gave, in ${UNIT_LABEL[unit]}, digits only (e.g. 38.5). Write 'unknown' if they gave no number, gave it in a different unit, or gave more than one number. Never convert or estimate one.`,
        },
      }
    : {};
  return {
    type: "object",
    description: `What the patient said about: ${topic.text}`,
    properties: {
      ...value,
      answer: {
        type: "string",
        description: "Their answer in a few plain words. Write 'unknown' if it was not discussed.",
      },
      patient_words: {
        type: "string",
        description: "What they said about it, in their own words. Write 'unknown' if it was not discussed.",
      },
      clarity: {
        type: "string",
        enum: ["clear", "unclear", "not_discussed"],
        description:
          "clear if they gave a clear answer, unclear if what they said could not be placed, not_discussed if it never came up.",
      },
    },
    required: unit ? ["value", "answer", "patient_words", "clarity"] : ["answer", "patient_words", "clarity"],
    additionalProperties: false,
  };
}

/**
 * Build the schema frozen onto a plan when it starts.
 *
 * `additionalProperties: false` makes it strict: a key CALL-E was not asked for
 * is a schema violation rather than a silent extra slot.
 */
export function buildResultSchema(topics: TopicSpec[] = []): JsonObject {
  const properties: Record<string, unknown> = { ...UNIVERSAL_RESULT_KEYS };
  topics.slice(0, MAX_TOPICS).forEach((topic, i) => {
    properties[topicKey(i)] = topicProperty(topic);
  });

  return {
    type: "object",
    properties: properties as JsonObject,
    // Everything is required, because `unknown` is always an available answer.
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** The keys a plan's schema declares, in a stable order. */
export function schemaKeys(schema: JsonObject): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.keys(properties as Record<string, unknown>);
}

/**
 * Who or what actually picked up.
 *
 * CALL-E returns no built-in answered-by disposition; its documentation is
 * explicit that you define the classification yourself with a per-recipient
 * structured result. One key, deliberately: a routing fact, not a second survey.
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
