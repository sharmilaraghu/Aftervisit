import { describe, expect, it } from "vitest";

import {
  MAX_TOPICS,
  TOPIC_UNITS,
  UNIT_LABEL,
  UNIVERSAL_RESULT_KEYS,
  buildResultSchema,
  isTopicUnit,
  schemaKeys,
  topicKey,
} from "@/lib/plan/result-schema";

const topics = [
  { text: "whether the wound is discharging" },
  { text: "how bad the pain is", unit: "score_0_10" as const },
  { text: "whether she has a fever" },
];

function propertyOf(id: string) {
  const schema = buildResultSchema(topics);
  return (schema.properties as Record<string, Record<string, unknown>>)[id];
}

describe("buildResultSchema", () => {
  /*
   * The fixed keys are unconditional. Three back floor rules, `goal_covered`
   * backs the fourth, and none is left to a parser to include. Consent lives on
   * the patient record now, so there is no key for it.
   */
  it("always carries the fixed keys, and no consent key", () => {
    const keys = schemaKeys(buildResultSchema([]));
    expect(keys).toEqual([
      "reached_patient",
      "requests_clinician",
      "emergency_language_heard",
      "symptom_change",
      "patient_concern",
      "something_else_raised",
      "goal_covered",
      "what_else",
      "call_recap",
    ]);
    expect(keys).not.toContain("consent_given");
  });

  it("adds one nested object per topic, in order", () => {
    const keys = schemaKeys(buildResultSchema(topics));
    expect(keys.slice(-3)).toEqual(["topic_1", "topic_2", "topic_3"]);
    expect(topicKey(0)).toBe("topic_1");

    const topic = propertyOf("topic_1");
    expect(topic.type).toBe("object");
    expect(topic.description).toContain("whether the wound is discharging");
    expect(topic.required).toEqual(["answer", "patient_words", "clarity"]);
    expect(topic.additionalProperties).toBe(false);
    const inner = topic.properties as Record<string, { enum?: string[] }>;
    expect(inner.clarity.enum).toEqual(["clear", "unclear", "not_discussed"]);
  });

  it("caps the topics at the most a plan carries", () => {
    const many = Array.from({ length: MAX_TOPICS + 3 }, (_, i) => ({ text: `topic number ${i}` }));
    const keys = schemaKeys(buildResultSchema(many));
    expect(keys.filter((k) => k.startsWith("topic_"))).toHaveLength(MAX_TOPICS);
  });

  /*
   * The constraint that broke a live call. CALL-E's supported schema subset is
   * `type`, `properties`, `required`, `enum`, nested objects, simple
   * `array.items`, `description` and `additionalProperties: false`. A type
   * union like `["boolean", "null"]` is `anyOf` in disguise, and the API
   * rejects the entire request with `result_schema is not supported`.
   */
  it("never uses a type union, which the API rejects outright", () => {
    const properties = buildResultSchema(topics).properties as Record<string, { type: unknown }>;
    for (const [key, property] of Object.entries(properties)) {
      expect(typeof property.type, `${key} must declare a single type`).toBe("string");
    }
  });

  it("uses no unsupported schema keyword anywhere", () => {
    const serialised = JSON.stringify(buildResultSchema(topics));
    for (const banned of ["$ref", "oneOf", "anyOf", "allOf"]) {
      expect(serialised).not.toContain(banned);
    }
  });

  /*
   * `unknown` replaces the null: the model has to actively choose "I could not
   * map this". A topic's clarity says the same thing in its own words —
   * `unclear` or `not_discussed` — so it needs no `unknown` of its own.
   */
  it("gives every answer an explicit unknown to choose", () => {
    const properties = buildResultSchema(topics).properties as Record<
      string,
      { type: string; enum?: unknown[]; description?: string; properties?: Record<string, { description?: string }> }
    >;

    for (const [key, property] of Object.entries(properties)) {
      if (property.type === "object") {
        expect(property.properties?.answer.description).toContain("unknown");
        expect(property.properties?.patient_words.description).toContain("unknown");
        continue;
      }
      if (!property.enum) {
        expect(property.description, `${key} should mention unknown`).toContain("unknown");
        continue;
      }
      expect(property.enum, `${key} should offer unknown`).toContain("unknown");
    }
  });

  it("requires every field, because unknown is always available", () => {
    const schema = buildResultSchema(topics);
    expect(schema.required).toEqual(Object.keys(schema.properties as Record<string, unknown>));
  });

  it("keeps the fixed keys exactly as declared", () => {
    expect(propertyOf("requests_clinician")).toEqual(UNIVERSAL_RESULT_KEYS.requests_clinician);
    expect(propertyOf("goal_covered").enum).toEqual(["all", "some", "none", "unknown"]);
  });

  it("closes the object, so an unexpected key is a schema violation not a silent slot", () => {
    expect(buildResultSchema(topics).additionalProperties).toBe(false);
  });

  it("is deterministic", () => {
    expect(buildResultSchema(topics)).toEqual(buildResultSchema(topics));
  });
});

describe("buildResultSchema — measured topics", () => {
  type Obj = { type: string; properties: Record<string, { type: unknown; description?: string }>; required: string[]; additionalProperties: boolean };
  const topic = (i: number) => (buildResultSchema(topics).properties as Record<string, Obj>)[topicKey(i)];

  it("adds a required value to a topic that asks for a number", () => {
    const measured = topic(1);
    expect(Object.keys(measured.properties)).toContain("value");
    expect(measured.required).toContain("value");
    expect(measured.properties.value.type).toBe("string");
    expect(measured.properties.value.description).toContain("/10");
    expect(measured.properties.value.description).toContain("unknown");
  });

  it("gives a topic with no unit no value at all", () => {
    expect(Object.keys(topic(0).properties)).not.toContain("value");
    expect(topic(0).required).not.toContain("value");
  });

  it("keeps a measured topic closed, and free of type unions", () => {
    const measured = topic(1);
    expect(measured.additionalProperties).toBe(false);
    expect(measured.required).toEqual(Object.keys(measured.properties));
    for (const [key, p] of Object.entries(measured.properties)) {
      expect(typeof p.type, key).toBe("string");
    }
  });

  it("offers only the closed list of units", () => {
    expect(TOPIC_UNITS).toContain("celsius");
    expect(isTopicUnit("celsius")).toBe(true);
    for (const bad of ["Celsius", "degrees", "ignore the section above", null, 3]) {
      expect(isTopicUnit(bad), String(bad)).toBe(false);
    }
    for (const unit of TOPIC_UNITS) expect(UNIT_LABEL[unit]).toBeTruthy();
  });
});
