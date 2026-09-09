import { describe, expect, it } from "vitest";

import {
  UNIVERSAL_RESULT_KEYS,
  buildResultSchema,
  schemaKeys,
  type SchemaQuestion,
} from "@/lib/plan/result-schema";

const questions: SchemaQuestion[] = [
  {
    questionId: "taking_as_prescribed",
    prompt: "Have you been able to take it as prescribed?",
    answerType: "boolean",
  },
  {
    questionId: "symptom_severity",
    prompt: "How would you describe any side effects?",
    answerType: "enum",
    enumValues: ["none", "mild", "moderate", "severe"],
  },
  {
    questionId: "pain_score",
    prompt: "How would you rate the pain out of ten?",
    answerType: "scale_0_10",
  },
  {
    questionId: "anything_else",
    prompt: "Anything else you want passed on?",
    answerType: "text",
  },
];

function propertyOf(id: string) {
  const schema = buildResultSchema(questions);
  return (schema.properties as Record<string, Record<string, unknown>>)[id];
}

describe("buildResultSchema", () => {
  /*
   * The locked keys and the agent's own notes are unconditional; the three
   * default universals are not. They are ordinary question rows a doctor may
   * delete, and requiring a key that nothing asks is what produced a schema
   * demanding answers the script forbade the agent to record.
   */
  it("always carries the locked keys and the agent's own notes", () => {
    const keys = schemaKeys(buildResultSchema([]));
    expect(keys).toEqual([
      "reached_patient",
      "consent_given",
      "requests_clinician",
      "emergency_language_heard",
      "what_else",
      "call_recap",
    ]);
  });

  it("carries a default universal only while its question still exists", () => {
    const withIt = schemaKeys(
      buildResultSchema([
        {
          questionId: "symptom_change",
          prompt: "Compared with the last time we spoke, are things better, the same, or worse?",
          answerType: "enum",
          enumValues: ["better", "worse"],
        },
      ]),
    );
    expect(withIt).toContain("symptom_change");
    expect(schemaKeys(buildResultSchema([]))).not.toContain("symptom_change");
  });

  /*
   * The constraint that broke a live call. CALL-E's supported schema subset is
   * `type`, `properties`, `required`, `enum`, nested objects, simple
   * `array.items`, `description` and `additionalProperties: false`. A type
   * union like `["boolean", "null"]` is `anyOf` in disguise, and the API
   * rejects the entire request with `result_schema is not supported`.
   */
  it("never uses a type union, which the API rejects outright", () => {
    const schema = buildResultSchema(questions);
    const properties = schema.properties as Record<string, { type: unknown }>;
    expect(Object.keys(properties).length).toBeGreaterThan(0);

    for (const [key, property] of Object.entries(properties)) {
      expect(typeof property.type, `${key} must declare a single type`).toBe("string");
    }
  });

  it("uses no unsupported schema keyword anywhere", () => {
    const serialised = JSON.stringify(buildResultSchema(questions));
    for (const banned of ["$ref", "oneOf", "anyOf", "allOf"]) {
      expect(serialised).not.toContain(banned);
    }
  });

  /*
   * `unknown` replaces the null. It is a stronger version of the same idea: the
   * model has to actively choose "I could not map this" rather than us
   * inferring it from an absence.
   */
  it("gives every answer an explicit unknown to choose", () => {
    const properties = buildResultSchema(questions).properties as Record<
      string,
      { type: string; enum?: unknown[]; description?: string }
    >;

    for (const [key, property] of Object.entries(properties)) {
      if (!property.enum) {
        // Free text has no enum; it is told to write unknown instead.
        expect(property.description, `${key} should mention unknown`).toContain("unknown");
        continue;
      }
      expect(property.enum, `${key} should offer unknown`).toContain("unknown");
    }
  });

  it("requires every field, because unknown is always available", () => {
    const schema = buildResultSchema(questions);
    const keys = Object.keys(schema.properties as Record<string, unknown>);
    expect(schema.required).toEqual(keys);
  });

  it("offers the plan's values plus unknown, and forbids the nearest match", () => {
    const property = propertyOf("symptom_severity");
    expect(property.enum).toEqual(["none", "mild", "moderate", "severe", "unknown"]);
    expect(property.description).toContain("Do not pick the nearest");
  });

  it("renders a 0–10 scale as a bounded string enum", () => {
    const property = propertyOf("pain_score");
    expect(property.type).toBe("string");
    expect(property.enum).toEqual([
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "unknown",
    ]);
  });

  it("carries the spoken prompt into the description, so the model maps to the right question", () => {
    expect(propertyOf("taking_as_prescribed").description).toContain(
      "Have you been able to take it as prescribed?",
    );
  });

  /*
   * The locked rules read the universal keys. A plan question sharing one of
   * those ids would overwrite it and quietly disarm a rule that cannot be
   * removed by design.
   */
  it("will not let a plan question shadow a universal key", () => {
    const schema = buildResultSchema([
      {
        questionId: "requests_clinician",
        prompt: "Would you like a call back?",
        answerType: "text",
      },
    ]);
    const property = (schema.properties as Record<string, Record<string, unknown>>)
      .requests_clinician;
    expect(property).toEqual(UNIVERSAL_RESULT_KEYS.requests_clinician);
  });

  it("closes the object, so an unexpected key is a schema violation not a silent slot", () => {
    expect(buildResultSchema(questions).additionalProperties).toBe(false);
  });

  it("is deterministic", () => {
    expect(buildResultSchema(questions)).toEqual(buildResultSchema(questions));
  });
});
