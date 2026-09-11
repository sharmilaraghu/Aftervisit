/**
 * The post-model pipeline, pinned against recorded model answers.
 *
 * `processCompiledAnswer` is everything that happens after the model replies:
 * coercion, grounding, defaults, schedule-quote checks, anchors, the cap and
 * guard phase 1. These tests run it on real answers recorded by
 * `scripts/record-compile-fixtures.ts` — plus one hand-written adversarial
 * answer — so a change to any of those steps is caught without calling a model.
 *
 * They pin the pipeline, not the live model. A model that answers differently
 * tomorrow is caught by re-recording, not by these.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { processCompiledAnswer } from "@/lib/plan/compile";
import { coverage } from "@/lib/plan/coverage";
import { EXAMPLE_PROMPTS } from "@/lib/plan/examples";
import { FIXTURE_NOTES } from "@/lib/plan/fixtures/notes";
import { mentionedIn } from "@/lib/plan/grounding";

interface Fixture {
  model: string;
  raw: unknown;
  /** Present on the hand-written fixture, which carries its own note. */
  noteBody?: string;
}

function run(name: string) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Fixture;
  const note = FIXTURE_NOTES.find((n) => n.name === name);
  const noteBody = fixture.noteBody ?? note?.noteBody ?? "";

  const outcome = processCompiledAnswer(
    fixture.raw,
    { noteBody, visitKind: note?.visitKind },
    "openai",
    fixture.model,
  );
  if (!outcome.ok) throw new Error(`${name} did not compile: ${outcome.reason} — ${outcome.detail}`);

  const { plan } = outcome;
  const report = coverage(
    plan.watchPoints,
    plan.questions.map((q) => ({
      prompt: q.prompt,
      watchPoint: typeof q.watchPoint === "number" ? (plan.watchPoints[q.watchPoint]?.text ?? null) : null,
      source: "note",
    })),
    EXAMPLE_PROMPTS,
  );
  return { noteBody, outcome, plan, report };
}

describe("recorded: a full post-op note", () => {
  const { noteBody, outcome, plan, report } = run("post-op");

  it("takes the schedule the note states, with the note's words", () => {
    expect(plan.provenance.durationDays).toBe("note");
    expect(plan.provenance.cadence).toBe("note");
    expect(mentionedIn(noteBody, plan.scheduleQuotes.cadence ?? "")).toBe(true);
  });

  it("covers every watch-point the note names", () => {
    expect(report.uncovered).toBe(0);
  });

  it("keeps only questions anchored in the note's own words", () => {
    expect(outcome.rejectedQuestions.filter((r) => r.findings[0]?.category === "not_anchored")).toEqual([]);
    for (const q of plan.questions) expect(mentionedIn(noteBody, q.why ?? "")).toBe(true);
  });
});

describe("recorded: a short but clear note", () => {
  const { plan, report } = run("short-clear");

  /* Underfit guard: short is not the same as empty. */
  it("still produces a question for what it asks", () => {
    expect(plan.questions.length).toBeGreaterThan(0);
    expect(report.uncovered).toBe(0);
  });
});

describe("recorded: a note that gives no schedule", () => {
  const { plan } = run("silent-schedule");

  /* The failure this pins: a model inventing a sensible-sounding schedule. */
  it("leaves every schedule field to the doctor", () => {
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.provenance.durationDays).toBe("default");
    expect(plan.provenance.localTime).toBe("default");
  });

  it("still asks what the note asks", () => {
    expect(plan.questions.length).toBeGreaterThan(0);
  });
});

describe("hand-written: a padded, over-reaching answer", () => {
  const { outcome, plan, report } = run("padded");
  const refused = (category: string) =>
    outcome.rejectedQuestions.filter((r) => r.findings[0]?.category === category).map((r) => r.questionId);

  it("does not trust a frequency the note never states", () => {
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.provenance.durationDays).toBe("note");
  });

  it("refuses the question with no words from the note", () => {
    expect(refused("not_anchored")).toEqual(["sleep"]);
  });

  it("holds the cap and refuses what came after it", () => {
    expect(refused("over_limit")).toEqual(["walking", "bowels"]);
    expect(plan.questions).toHaveLength(4);
  });

  it("flags template copies and a question tied to no watch-point", () => {
    expect(report.templateCopies).toEqual([
      "Is there any discharge coming from the wound?",
      "On a scale of 0 to 10, how bad is the pain today?",
    ]);
    expect(report.orphans).toEqual(["Are you eating normally?"]);
  });
});
