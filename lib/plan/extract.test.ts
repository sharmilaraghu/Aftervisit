import { describe, expect, it } from "vitest";

import {
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

  /*
   * The bug this exists for. CALL-E returned `reached_patient: "unknown"` on a
   * call with thirty-nine turns, consent given and a full set of answers — and
   * the outcome folded to `no_answer`, which then fed the retry ladder and the
   * "never reached" state.
   */
  it("counts a call as answered when consent was given, even if identity was never confirmed", () => {
    expect(
      someoneSpoke({
        slots: [
          slot("reached_patient"),
          slot("consent_given", { status: "answered", valueBool: true }),
        ],
        transcript: null,
      }),
    ).toBe(true);
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
