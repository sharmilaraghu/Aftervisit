import { describe, expect, it } from "vitest";

import { questionSlug, validateQuestionDraft } from "@/lib/plan/clinician-question";

describe("questionSlug", () => {
  it("reads like a compiled id — filler dropped, lower_snake_case", () => {
    expect(questionSlug("Are you taking the tablets with food?", [])).toBe("taking_tablets_food");
  });

  it("numbers a slug that collides with one already on the plan", () => {
    expect(questionSlug("Any swelling?", ["swelling"])).toBe("swelling_2");
    expect(questionSlug("Any swelling?", ["swelling", "swelling_2"])).toBe("swelling_3");
  });

  it("cannot be given a reserved id, even when nothing else is taken", () => {
    // Shadowing one of these would disarm a locked rule.
    expect(questionSlug("Call recap", [])).toBe("call_recap_2");
    expect(questionSlug("Reached patient", [])).toBe("reached_patient_2");
  });

  it("still produces a key for a prompt with nothing to slug", () => {
    expect(questionSlug("आप कैसा महसूस कर रहे हैं?", [])).toBe("question");
    expect(questionSlug("？！", ["question"])).toBe("question_2");
  });

  it("falls back to filler words rather than nothing when that is all there is", () => {
    expect(questionSlug("How are you?", [])).toBe("how_are_you");
  });
});

describe("validateQuestionDraft", () => {
  it("refuses an empty question", () => {
    const result = validateQuestionDraft({ prompt: "   ", answerType: "boolean" });
    expect(result.ok).toBe(false);
  });

  it("refuses an answer type outside the closed set", () => {
    const result = validateQuestionDraft({ prompt: "Any swelling?", answerType: "freeform" });
    expect(result.ok).toBe(false);
  });

  it("trims the prompt and ignores enum values on a non-enum question", () => {
    const result = validateQuestionDraft({
      prompt: "  Any swelling?  ",
      answerType: "boolean",
      enumValues: "a, b",
    });
    expect(result).toEqual({
      ok: true,
      draft: { prompt: "Any swelling?", answerType: "boolean", enumValues: null },
    });
  });

  it("normalises enum values and drops duplicates", () => {
    const result = validateQuestionDraft({
      prompt: "How is the wound?",
      answerType: "enum",
      enumValues: "Not concerned, mildly,  MILDLY \n very",
    });
    expect(result.ok && result.draft.enumValues).toEqual(["not_concerned", "mildly", "very"]);
  });

  it("refuses `unknown` as a value, and refuses a one-answer enum", () => {
    // `unknown` is appended to every enum by buildResultSchema; a second copy
    // would be a duplicate in the schema CALL-E is sent.
    const result = validateQuestionDraft({
      prompt: "How is the wound?",
      answerType: "enum",
      enumValues: "better, unknown",
    });
    expect(result.ok).toBe(false);
  });
});
