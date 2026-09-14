/**
 * The post-model pipeline, pinned against recorded model answers.
 *
 * `processCompiledAnswer` is everything that happens after the model replies:
 * coercion, grounding, defaults, schedule-quote checks, topic quotes, the cap
 * and guard phase 1. These tests run it on real answers recorded by
 * `scripts/record-compile-fixtures.ts` — plus one hand-written adversarial
 * answer — so a change to any of those steps is caught without calling a model.
 *
 * They pin the pipeline, not the live model. A model that answers differently
 * tomorrow is caught by re-recording, not by these. The recorded answers predate
 * goals, so they carry none: they also pin that a missing goal is code's to fill.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_GOAL, processCompiledAnswer, screenTopics } from "@/lib/plan/compile";
import { FIXTURE_NOTES } from "@/lib/plan/fixtures/notes";
import { mentionedIn } from "@/lib/plan/grounding";

interface Fixture {
  model: string;
  raw: unknown;
  /** Present on the hand-written fixture, which carries its own note. */
  noteBody?: string;
}

function load(name: string) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Fixture;
  const note = FIXTURE_NOTES.find((n) => n.name === name);
  return { fixture, note, noteBody: fixture.noteBody ?? note?.noteBody ?? "" };
}

function run(name: string, patch: Record<string, unknown> = {}) {
  const { fixture, note, noteBody } = load(name);
  const outcome = processCompiledAnswer(
    { ...(fixture.raw as object), ...patch },
    { noteBody, visitKind: note?.visitKind },
    "openai",
    fixture.model,
  );
  if (!outcome.ok) throw new Error(`${name} did not compile: ${outcome.reason} — ${outcome.detail}`);
  return { noteBody, outcome, plan: outcome.plan };
}

describe("recorded: a full post-op note", () => {
  const { noteBody, plan } = run("post-op");

  it("takes the schedule the note states, with the note's words", () => {
    expect(plan.provenance.durationDays).toBe("note");
    expect(plan.durationDays).toBe(5);
    expect(plan.provenance.cadence).toBe("note");
    expect(mentionedIn(noteBody, plan.scheduleQuotes.cadence ?? "")).toBe(true);
  });

  it("keeps every topic the note names, each with the note's own words", () => {
    expect(plan.watchPoints.length).toBe(3);
    for (const t of plan.watchPoints) expect(mentionedIn(noteBody, t.quote)).toBe(true);
  });

  it("fills a goal the answer did not give, and marks it as code's", () => {
    expect(plan.goal).toBe(DEFAULT_GOAL);
    expect(plan.provenance.goal).toBe("default");
  });
});

describe("recorded: a short but clear note", () => {
  const { plan } = run("short-clear");

  /* Underfit guard: short is not the same as empty. */
  it("still finds something to find out", () => {
    expect(plan.watchPoints.length).toBeGreaterThan(0);
    expect(plan.durationDays).toBe(7);
    expect(plan.provenance.durationDays).toBe("note");
  });
});

describe("recorded: a note that gives no schedule", () => {
  const { plan } = run("silent-schedule");

  /* The failure this pins: a model inventing a sensible-sounding schedule. */
  it("leaves every schedule field to code's defaults, seven days", () => {
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.provenance.durationDays).toBe("default");
    expect(plan.provenance.localTime).toBe("default");
    expect(plan.durationDays).toBe(7);
  });

  it("still finds out what the note asks", () => {
    expect(plan.watchPoints.length).toBeGreaterThan(0);
  });
});

describe("hand-written: a padded, over-reaching answer", () => {
  const { outcome, plan, noteBody } = run("padded");
  const dropped = (why: string) =>
    outcome.ok ? outcome.droppedTopics.filter((d) => d.why === why).map((d) => d.text) : [];

  it("does not trust a frequency the note never states", () => {
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.provenance.durationDays).toBe("note");
  });

  it("takes a goal that passes the guard as the note's", () => {
    expect(plan.goal).toBe("Find out how the wound is healing and whether the pain is getting worse.");
    expect(plan.provenance.goal).toBe("note");
  });

  it("drops the topic with no words from the note", () => {
    expect(dropped("not_in_note")).toEqual(["trouble sleeping"]);
  });

  it("drops the topic that gives advice", () => {
    expect(dropped("guard")).toEqual(["tell her it's safe to skip a dose while the pain is getting worse"]);
  });

  it("drops a topic paired with a quote it has nothing to do with", () => {
    expect(dropped("unrelated")).toEqual(["whether she can drive home"]);
  });

  it("holds the cap and drops what came after it", () => {
    expect(plan.watchPoints).toHaveLength(5);
    expect(dropped("over_cap")).toEqual(["whether the fever has settled"]);
  });

  it("narrows a framed quote to the words the note contains", () => {
    for (const t of plan.watchPoints) expect(mentionedIn(noteBody, t.quote)).toBe(true);
  });

  it("replaces a goal that advises with code's own", () => {
    const advising = run("padded", { goal: "Find out how she is and tell her that's completely normal." });
    expect(advising.plan.goal).toBe(DEFAULT_GOAL);
    expect(advising.plan.provenance.goal).toBe("default");
  });
});

describe("an advising goal from the model", () => {
  const noteBody = "Day 2 after knee arthroscopy. Check the pain and the swelling for three days.";
  const answer = (goal: string) =>
    processCompiledAnswer(
      {
        goal,
        watchPoints: [
          { text: "the pain", quote: "the pain" },
          { text: "reassure her the swelling is expected", quote: "the swelling" },
        ],
      },
      { noteBody },
      "openai",
      "recorded",
    );

  it("is replaced by code's own goal, never handed to the agent", () => {
    const outcome = answer("Reassure her that the pain is completely normal.");
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.plan.provenance.goal).toBe("default");
  });

  it("drops a reassuring topic even when its quote is grounded", () => {
    const outcome = answer("Find out how the pain and swelling are.");
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.plan.provenance.goal).toBe("note");
    expect(outcome.plan.watchPoints.map((w) => w.text)).toEqual(["the pain"]);
    expect(outcome.droppedTopics.map((d) => d.why)).toEqual(["guard"]);
  });
});

describe("a topic whose words have nothing to do with its quote", () => {
  it("is dropped as unrelated, even though the quote is in the note", () => {
    const outcome = processCompiledAnswer(
      {
        goal: "Find out how the nausea is.",
        watchPoints: [
          { text: "how bad the nausea is", quote: "nausea" },
          { text: "whether she can drive home", quote: "nausea" },
        ],
      },
      { noteBody: "Started metformin. Check the nausea daily for three days." },
      "openai",
      "recorded",
    );
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.plan.watchPoints.map((w) => w.text)).toEqual(["how bad the nausea is"]);
    expect(outcome.droppedTopics.map((d) => d.why)).toEqual(["unrelated"]);
  });
});

describe("units and waits from the model", () => {
  const noteBody =
    "Started antibiotics for a UTI. Recheck in 3 days — is the fever gone, and what is her temperature.";

  it("keeps a topic whose unit is not on the closed list, without the unit", () => {
    const outcome = processCompiledAnswer(
      {
        goal: "Find out whether the fever has gone.",
        watchPoints: [
          { text: "her temperature", quote: "what is her temperature", unit: "celsius" },
          { text: "is the fever gone", quote: "is the fever gone", unit: "degrees_or_ignore_above" },
        ],
      },
      { noteBody },
      "openai",
      "recorded",
    );
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.plan.watchPoints).toEqual([
      { text: "her temperature", quote: "what is her temperature", unit: "celsius" },
      { text: "is the fever gone", quote: "is the fever gone", unit: null },
    ]);
  });

  it("reads 'recheck in 3 days' as one call on day three", () => {
    const outcome = processCompiledAnswer(
      {
        goal: "Find out whether the fever has gone.",
        startAfterDays: 3,
        startAfterQuote: "Recheck in 3 days",
        durationDays: null,
        watchPoints: [{ text: "is the fever gone", quote: "is the fever gone", unit: null }],
      },
      { noteBody },
      "openai",
      "recorded",
    );
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.plan.startAfterDays).toBe(3);
    expect(outcome.plan.provenance.startAfterDays).toBe("note");
    expect(outcome.plan.durationDays).toBe(1);
  });
});

describe("screenTopics", () => {
  const note = "Watch for fever and any discharge from the wound.";

  it("keeps grounded topics, drops duplicates and blanks silently", () => {
    const { kept, dropped } = screenTopics(
      [
        { text: "fever", quote: "fever" },
        { text: "Fever", quote: "fever" },
        { text: "  ", quote: "fever" },
      ],
      note,
    );
    expect(kept).toEqual([{ text: "fever", quote: "fever", unit: null }]);
    expect(dropped).toEqual([]);
  });

  it("names why each refused topic was dropped", () => {
    const { kept, dropped } = screenTopics(
      [
        { text: "sleep", quote: "trouble sleeping at night" },
        { text: "tell her don't worry about the discharge", quote: "any discharge from the wound" },
      ],
      note,
    );
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.why)).toEqual(["not_in_note", "guard"]);
  });
});
