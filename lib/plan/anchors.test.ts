import { describe, expect, it } from "vitest";

import { MAX_NOTE_QUESTIONS, screenQuestions } from "@/lib/plan/anchors";
import { UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import type { DraftQuestion } from "@/lib/plan/defaults";

const note =
  "Day 2 after laparoscopic cholecystectomy. Call each morning for five days. " +
  "Watch for fever, any discharge from the wound, and pain getting worse.";

function q(id: string, why: string | null, extra: Partial<DraftQuestion> = {}): DraftQuestion {
  return { questionId: id, prompt: `Question ${id}?`, answerType: "boolean", why, ...extra };
}

describe("screenQuestions — a question has to answer to the note", () => {
  it("keeps a question whose quoted words are in the note", () => {
    const { kept, refused } = screenQuestions([q("discharge", "any discharge from the wound")], note);
    expect(kept).toHaveLength(1);
    expect(refused).toHaveLength(0);
  });

  /* The overfit this exists to catch: a sensible-sounding question the doctor
     never asked for. */
  it("refuses a question whose quote the note does not contain", () => {
    const { kept, refused } = screenQuestions([q("sleep", "trouble sleeping")], note);
    expect(kept).toHaveLength(0);
    expect(refused[0].findings[0].category).toBe("not_anchored");
    expect(refused[0].findings[0].match).toBe("trouble sleeping");
  });

  /* Seen in a real recording: the model framed the note's words. The anchor
     kept is the note's own phrase, not the framing. */
  it("anchors a framed quote to the note's own phrase inside it", () => {
    const { kept } = screenQuestions([q("discharge", "Watch for any discharge from the wound")], note);
    expect(kept).toHaveLength(1);
    expect(kept[0].why).toBe("any discharge from the wound");
  });

  it("refuses a quote that shares too few words with the note", () => {
    const { refused } = screenQuestions([q("sleep", "Watch for trouble sleeping at night")], note);
    expect(refused[0].findings[0].category).toBe("not_anchored");
  });

  it("refuses a question that quotes nothing at all", () => {
    const { refused } = screenQuestions([q("anything", null)], note);
    expect(refused[0].findings[0].category).toBe("not_anchored");
  });

  it("holds the cap, and refuses rather than drops what comes after it", () => {
    const many = Array.from({ length: MAX_NOTE_QUESTIONS + 2 }, (_, i) => q(`q${i}`, "fever"));
    const { kept, refused } = screenQuestions(many, note);
    expect(kept).toHaveLength(MAX_NOTE_QUESTIONS);
    expect(refused).toHaveLength(2);
    expect(refused.every((r) => r.findings[0].category === "over_limit")).toBe(true);
  });

  it("refuses a list answer with more options than a caller can hold", () => {
    const { refused } = screenQuestions(
      [q("pain", "pain getting worse", { answerType: "enum", enumValues: ["a", "b", "c", "d", "e", "f"] })],
      note,
    );
    expect(refused[0].findings[0].category).toBe("over_limit");
  });
});

describe("every question stands alone", () => {
  /* A call has to make sense if yesterday's never connected. */
  it("no universal question leans on an earlier call", () => {
    for (const u of UNIVERSAL_QUESTIONS) {
      expect(u.prompt).not.toMatch(/last (time|call|spoke)|we last|yesterday|as before/i);
    }
  });
});
