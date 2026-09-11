import { describe, expect, it } from "vitest";

import { coverage } from "@/lib/plan/coverage";
import { EXAMPLE_PROMPTS } from "@/lib/plan/examples";

const watchPoints = [
  { text: "fever", quote: "watch for fever" },
  { text: "wound discharge", quote: "any discharge from the wound" },
];

describe("coverage — underfit and overfit, read off the plan", () => {
  it("counts every watch-point as covered when a note question maps to each", () => {
    const report = coverage(
      watchPoints,
      [
        { prompt: "Have you had a fever?", watchPoint: "fever", source: "note" },
        { prompt: "Is anything coming from the wound?", watchPoint: "Wound discharge", source: "note" },
      ],
      [],
    );
    expect(report.uncovered).toBe(0);
    expect(report.orphans).toEqual([]);
  });

  it("shows a watch-point no question asks about — underfit", () => {
    const report = coverage(
      watchPoints,
      [{ prompt: "Have you had a fever?", watchPoint: "fever", source: "note" }],
      [],
    );
    expect(report.uncovered).toBe(1);
    expect(report.rows[1].questions).toEqual([]);
  });

  it("shows a note question tied to nothing the note names — overfit", () => {
    const report = coverage(
      watchPoints,
      [{ prompt: "How are you sleeping?", watchPoint: "sleep", source: "note" }],
      [],
    );
    expect(report.orphans).toEqual(["How are you sleeping?"]);
  });

  it("flags a question copied word for word from the style examples", () => {
    const copied = EXAMPLE_PROMPTS[0];
    const report = coverage(watchPoints, [{ prompt: copied, watchPoint: "fever", source: "note" }], EXAMPLE_PROMPTS);
    expect(report.templateCopies).toEqual([copied]);
  });

  it("leaves universal and clinician questions out of it", () => {
    const report = coverage(
      watchPoints,
      [
        { prompt: "Am I speaking with the patient?", watchPoint: null, source: "locked" },
        { prompt: "Any trouble with the dressing?", watchPoint: null, source: "clinician" },
      ],
      [],
    );
    expect(report.orphans).toEqual([]);
  });
});
