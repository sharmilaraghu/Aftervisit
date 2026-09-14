import { describe, expect, it } from "vitest";

import {
  extractFindings,
  extractSlots,
  foldOutcome,
  someoneSpoke,
  type ExtractQuestion,
} from "@/lib/plan/extract";
import type { StoredTurn } from "@/lib/db/schema";

const QUESTIONS: ExtractQuestion[] = [
  {
    questionId: "taking_as_prescribed",
    prompt: "Are you taking it as prescribed?",
    answerType: "boolean",
    required: true,
  },
  {
    questionId: "symptom_severity",
    prompt: "Any side effects?",
    answerType: "enum",
    enumValues: ["none", "mild", "moderate", "severe"],
    required: true,
  },
  { questionId: "pain_score", answerType: "scale_0_10", required: true },
  { questionId: "anything_else", answerType: "text", required: false },
];

const TRANSCRIPT: StoredTurn[] = [
  { attemptId: "a1", offsetSeconds: 2, speaker: "bot", text: "Hello, this is an AI assistant." },
  { attemptId: "a1", offsetSeconds: 9, speaker: "user", text: "Hello." },
  { attemptId: "a1", offsetSeconds: 14, speaker: "bot", text: "Any side effects?" },
  {
    attemptId: "a1",
    offsetSeconds: 20,
    speaker: "user",
    text: "I threw up twice yesterday and I couldn't keep water down.",
  },
];

function byId(slots: ReturnType<typeof extractSlots>, id: string) {
  return slots.find((s) => s.questionId === id)!;
}

describe("extractSlots — a clean call", () => {
  it("maps each answer to its typed column", () => {
    const slots = extractSlots({
      structuredResult: {
        taking_as_prescribed: "yes",
        symptom_severity: "mild",
        pain_score: "4",
        anything_else: "Nothing much.",
      },
      questions: QUESTIONS,
      transcript: null,
    });

    expect(byId(slots, "taking_as_prescribed")).toMatchObject({
      status: "answered",
      valueBool: true,
      valueNumber: null,
      valueText: null,
    });
    expect(byId(slots, "symptom_severity")).toMatchObject({ status: "answered", valueText: "mild" });
    expect(byId(slots, "pain_score")).toMatchObject({ status: "answered", valueNumber: 4 });
    expect(byId(slots, "anything_else")).toMatchObject({ status: "answered", valueText: "Nothing much." });
  });

  it("keeps the raw value alongside the mapped one, as evidence", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "mild" },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").rawValue).toBe("mild");
  });

  it("is deterministic", () => {
    const args = { structuredResult: { pain_score: 4 }, questions: QUESTIONS, transcript: TRANSCRIPT };
    expect(extractSlots(args)).toEqual(extractSlots(args));
  });
});

describe("extractSlots — null is the signal, not an absence", () => {
  /*
   * The distinction the whole schema is built around. CALL-E returning null
   * means it could not map what it heard; that is `unmappable`, and it
   * escalates. Treating it as "no answer yet" would lose the escalation.
   */
  it("maps an explicit unknown to unmappable, not to a value", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "unknown" },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").status).toBe("unmappable");
  });

  it("maps an absent key to missing, which is a different fact", () => {
    const slots = extractSlots({
      structuredResult: {},
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").status).toBe("missing");
  });

  it("marks every question missing when the whole result is null", () => {
    const slots = extractSlots({ structuredResult: null, questions: QUESTIONS, transcript: null });
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s.status === "missing")).toBe(true);
  });
});

describe("extractSlots — it refuses rather than coerces", () => {
  it("will not pick the nearest enum value", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "quite bad" },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").status).toBe("unmappable");
    expect(byId(slots, "symptom_severity").valueText).toBeNull();
  });

  it("reads the schema's yes/no strings as booleans, and nothing else", () => {
    const yes = extractSlots({
      structuredResult: { taking_as_prescribed: "yes" },
      questions: [QUESTIONS[0]],
      transcript: null,
    });
    expect(byId(yes, "taking_as_prescribed")).toMatchObject({ status: "answered", valueBool: true });

    const maybe = extractSlots({
      structuredResult: { taking_as_prescribed: "sort of" },
      questions: [QUESTIONS[0]],
      transcript: null,
    });
    expect(byId(maybe, "taking_as_prescribed").status).toBe("unmappable");
  });

  it("still honours a whole-result null as unmappable", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: null },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").status).toBe("unmappable");
  });

  it("rejects a score outside 0–10 and a non-integer", () => {
    for (const value of ["11", "-1", "4.5", "four"]) {
      const slots = extractSlots({
        structuredResult: { pain_score: value },
        questions: [QUESTIONS[2]],
        transcript: null,
      });
      expect(byId(slots, "pain_score").status).toBe("unmappable");
    }
  });

  it("accepts the boundaries of a 0–10 scale", () => {
    for (const value of [0, 10]) {
      const slots = extractSlots({
        structuredResult: { pain_score: String(value) },
        questions: [QUESTIONS[2]],
        transcript: null,
      });
      expect(byId(slots, "pain_score")).toMatchObject({ status: "answered", valueNumber: value });
    }
  });

  it("treats an empty string as unmappable, not as an answer", () => {
    const slots = extractSlots({
      structuredResult: { anything_else: "   " },
      questions: [QUESTIONS[3]],
      transcript: null,
    });
    expect(byId(slots, "anything_else").status).toBe("unmappable");
  });
});

describe("extractSlots — the patient's own words", () => {
  it("attaches the patient's reply, with its offset back into the transcript", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "severe" },
      questions: [QUESTIONS[1]],
      transcript: TRANSCRIPT,
    });

    const slot = byId(slots, "symptom_severity");
    expect(slot.utterance).toContain("threw up twice");
    expect(slot.utteranceOffsetSeconds).toBe(20);
  });

  it("never quotes the agent back at the clinician", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "severe" },
      questions: [QUESTIONS[1]],
      transcript: TRANSCRIPT,
    });
    expect(byId(slots, "symptom_severity").utterance).not.toContain("AI assistant");
  });

  /*
   * The regression this describes was live: every answer on a real call carried
   * the same sentence, because the reply was chosen by length rather than by
   * which question was asked.
   */
  it("gives each question its own reply, not one line copied across all of them", () => {
    const slots = extractSlots({
      structuredResult: { taking_as_prescribed: "yes", symptom_severity: "severe" },
      questions: [QUESTIONS[0], QUESTIONS[1]],
      transcript: [
        { attemptId: "a1", offsetSeconds: 2, speaker: "bot", text: "Are you taking it as prescribed?" },
        { attemptId: "a1", offsetSeconds: 6, speaker: "user", text: "Yes, every morning." },
        { attemptId: "a1", offsetSeconds: 14, speaker: "bot", text: "Any side effects?" },
        {
          attemptId: "a1",
          offsetSeconds: 20,
          speaker: "user",
          text: "I threw up twice yesterday and I couldn't keep water down.",
        },
      ],
    });

    expect(byId(slots, "taking_as_prescribed").utterance).toBe("Yes, every morning.");
    expect(byId(slots, "symptom_severity").utterance).toContain("threw up twice");
  });

  /* A question the call never reached quotes nothing rather than borrowing an
     unrelated line from somewhere else in the transcript. */
  it("quotes nothing when the question was never answered", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "unknown" },
      questions: [QUESTIONS[1]],
      transcript: [
        { attemptId: "a1", offsetSeconds: 2, speaker: "bot", text: "Hello." },
        { attemptId: "a1", offsetSeconds: 5, speaker: "user", text: "Something unrelated." },
        { attemptId: "a1", offsetSeconds: 9, speaker: "bot", text: "Any side effects?" },
      ],
    });
    expect(byId(slots, "symptom_severity").utterance).toBeNull();
  });

  it("copes with no transcript at all", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "mild" },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").utterance).toBeNull();
  });
});

describe("someoneSpoke", () => {
  const slot = (questionId: string, over: Record<string, unknown> = {}) => ({
    questionId,
    status: "unmappable" as const,
    valueBool: null,
    valueNumber: null,
    valueText: null,
    rawValue: null,
    utterance: null,
    utteranceOffsetSeconds: null,
    ...over,
  });

  it("counts a call as answered when the patient confirmed who they are", () => {
    expect(
      someoneSpoke({
        slots: [slot("reached_patient", { status: "answered", valueBool: true })],
        transcript: null,
      }),
    ).toBe(true);
  });

  /*
   * Consent lives on the patient record now, not on the call. A `consent_given`
   * slot left over from an older plan is not evidence anybody spoke.
   */
  it("no longer reads a consent slot as speech", () => {
    expect(
      someoneSpoke({
        slots: [
          slot("reached_patient"),
          slot("consent_given", { status: "answered", valueBool: true }),
        ],
        transcript: null,
      }),
    ).toBe(false);
  });

  /*
   * The narrowing that two real declined calls forced.
   *
   * CALL-E returns a result object even when nobody picks up, and a careful
   * model fills the safety questions in defensively — `emergency_language_heard:
   * "no"` on a call with an empty transcript is an honest answer and not a
   * conversation. Accepting it as speech suppressed the retry and fired
   * `unmappable_response` on a call that never happened.
   */
  it("does not count a defensive answer on a silent call as speech", () => {
    expect(
      someoneSpoke({
        slots: [
          slot("emergency_language_heard", { status: "answered", valueBool: false }),
          slot("requests_clinician", { status: "answered", valueBool: false }),
          slot("pain", { status: "unmappable" }),
        ],
        transcript: [],
      }),
    ).toBe(false);
  });

  it("still counts a real answer when the patient is in the transcript", () => {
    expect(
      someoneSpoke({
        slots: [slot("pain", { status: "answered", valueNumber: 3 })],
        transcript: [
          { attemptId: "a", offsetSeconds: 4, speaker: "user", text: "About a three." },
        ],
      }),
    ).toBe(true);
  });

  it("counts a patient turn in the transcript", () => {
    expect(
      someoneSpoke({
        slots: [slot("reached_patient")],
        transcript: [
          { attemptId: "a", offsetSeconds: 1, speaker: "bot", text: "Hello?" },
          { attemptId: "a", offsetSeconds: 4, speaker: "user", text: "Yes, hello." },
        ],
      }),
    ).toBe(true);
  });

  it("is false when nobody answered at all", () => {
    expect(someoneSpoke({ slots: [slot("reached_patient")], transcript: null })).toBe(false);
    expect(
      someoneSpoke({
        slots: [slot("reached_patient")],
        transcript: [{ attemptId: "a", offsetSeconds: 1, speaker: "bot", text: "Hello?" }],
      }),
    ).toBe(false);
  });
});

describe("extractFindings", () => {
  const topics = [{ text: "fever" }, { text: "wound discharge" }, { text: "pain" }];

  it("reads each topic by position, mapping clarity exactly", () => {
    const findings = extractFindings(
      {
        topic_1: { answer: "no fever", patient_words: "No temperature.", clarity: "clear" },
        topic_2: { answer: "a little", patient_words: "Some ooze, I think.", clarity: "unclear" },
        topic_3: { answer: "unknown", patient_words: "unknown", clarity: "not_discussed" },
      },
      topics,
    );
    const none = { value: null, unit: null };
    expect(findings).toEqual([
      { topic: "fever", ...none, answer: "no fever", patientWords: "No temperature.", clarity: "clear" },
      { topic: "wound discharge", ...none, answer: "a little", patientWords: "Some ooze, I think.", clarity: "unclear" },
      { topic: "pain", ...none, answer: null, patientWords: null, clarity: "not_discussed" },
    ]);
  });

  /* A measured topic's number is digits or nothing — never the nearest guess. */
  it("reads a measured topic's value only when it is a plain number", () => {
    const temp = [{ text: "temperature", unit: "celsius" as const }];
    const valueOf = (value: unknown) =>
      extractFindings({ topic_1: { value, answer: "x", patient_words: "x", clarity: "clear" } }, temp)[0];

    expect(valueOf("39.2")).toMatchObject({ value: 39.2, unit: "celsius" });
    expect(valueOf(" 38 ").value).toBe(38);
    for (const bad of ["unknown", "about 38", "38-39", "high", "", null, 38.5, undefined]) {
      expect(valueOf(bad).value, String(bad)).toBeNull();
    }
    expect(extractFindings({ topic_1: { answer: "x", patient_words: "x", clarity: "clear" } }, temp)[0].value).toBeNull();
  });

  it("keeps a number only from a clear answer, inside a plausible range for its unit", () => {
    const read = (value: string, clarity: string, unit: "celsius" | "score_0_10" | "bpm") =>
      extractFindings({ topic_1: { value, answer: "x", patient_words: "x", clarity } }, [{ text: "t", unit }])[0]
        .value;

    /* "About 38, I think", written down as 38, is the agent's guess. */
    expect(read("38", "unclear", "celsius")).toBeNull();
    /* 101 is Fahrenheit misfiled as Celsius, not a reading. */
    expect(read("101", "clear", "celsius")).toBeNull();
    expect(read("11", "clear", "score_0_10")).toBeNull();
    expect(read("999", "clear", "bpm")).toBeNull();
    expect(read("0", "clear", "score_0_10")).toBe(0);
    expect(read("72", "clear", "bpm")).toBe(72);
  });

  it("ignores a value on a topic that asked for no number", () => {
    const [f] = extractFindings(
      { topic_1: { value: "39.2", answer: "hot", patient_words: "hot", clarity: "clear" } },
      [{ text: "fever" }],
    );
    expect(f.value).toBeNull();
    expect(f.unit).toBeNull();
  });

  /* `unknown` is the model saying it has nothing — never an answer to show. */
  it("reads unknown and blank text as absent", () => {
    const [f] = extractFindings(
      { topic_1: { answer: "  UNKNOWN ", patient_words: "   ", clarity: "clear" } },
      [{ text: "fever" }],
    );
    expect(f.answer).toBeNull();
    expect(f.patientWords).toBeNull();
  });

  it("gives nulls for a missing, malformed or wrongly typed topic, never a guess", () => {
    const findings = extractFindings(
      { topic_1: "yes", topic_2: { answer: 3, patient_words: null, clarity: "sort of" } },
      topics,
    );
    for (const f of findings) {
      expect(f.answer).toBeNull();
      expect(f.patientWords).toBeNull();
      expect(f.clarity).toBeNull();
    }
    expect(extractFindings(null, topics).every((f) => f.clarity === null)).toBe(true);
  });
});

describe("foldOutcome", () => {
  it("calls an unreached call a no-answer whatever else is true", () => {
    expect(
      foldOutcome({
        reached: false,
        
        hasUrgentHit: false,
        hasAnyHit: false,
        anyUnmappable: true,
      }),
    ).toBe("no_answer");
  });

  it("flags a call that fired any rule", () => {
    expect(
      foldOutcome({ reached: true, hasUrgentHit: false, hasAnyHit: true, anyUnmappable: false }),
    ).toBe("flagged");
  });

  it("marks an unmappable call that fired nothing", () => {
    expect(
      foldOutcome({ reached: true, hasUrgentHit: false, hasAnyHit: false, anyUnmappable: true }),
    ).toBe("unmappable");
  });

  it("calls a clean, reached call answered", () => {
    expect(
      foldOutcome({ reached: true, hasUrgentHit: false, hasAnyHit: false, anyUnmappable: false }),
    ).toBe("answered");
  });
});

describe("extractSlots — an answer to a question nobody asked", () => {
  /*
   * A real call came back with consent_given "yes" for a question the agent
   * never put. The patient had volunteered "Yes, we can discuss now" in their
   * opening breath and the platform read it as the answer. The task text tells
   * the agent never to record an answer to a question it did not ask; that
   * instruction is not enforceable at the far end, so it is checked here.
   */
  it("refuses an answer when the transcript never asked the question", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "severe" },
      questions: [QUESTIONS[1]],
      transcript: [
        { attemptId: "a1", offsetSeconds: 2, speaker: "bot", text: "Am I speaking with the patient?" },
        { attemptId: "a1", offsetSeconds: 6, speaker: "user", text: "Yes, and it has been severe." },
      ],
    });
    expect(byId(slots, "symptom_severity").status).toBe("unmappable");
    expect(byId(slots, "symptom_severity").valueText).toBeNull();
  });

  it("keeps the answer when the question was actually asked", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "severe" },
      questions: [QUESTIONS[1]],
      transcript: TRANSCRIPT,
    });
    expect(byId(slots, "symptom_severity").status).toBe("answered");
  });

  /* Some ids are recorded rather than asked, so their absence proves nothing. */
  it("leaves a question the agent never speaks alone", () => {
    const slots = extractSlots({
      structuredResult: { requests_clinician: "no" },
      questions: [
        {
          questionId: "requests_clinician",
          prompt: "Did they ask to speak to a person?",
          answerType: "boolean",
          required: true,
        },
      ],
      transcript: TRANSCRIPT,
    });
    expect(byId(slots, "requests_clinician").status).toBe("answered");
  });

  /* A call nobody answered has no transcript to check anything against. */
  it("does not downgrade when there is no transcript", () => {
    const slots = extractSlots({
      structuredResult: { symptom_severity: "severe" },
      questions: [QUESTIONS[1]],
      transcript: null,
    });
    expect(byId(slots, "symptom_severity").status).toBe("answered");
  });
});
