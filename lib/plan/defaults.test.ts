import { describe, expect, it } from "vitest";

import {
  applyDefaults,
  DEFAULTS,
  DEFAULT_GOAL,
  fieldsToMarkAsClinician,
  isDefaulted,
  quoteSaysDelay,
  type CompiledDraft,
} from "@/lib/plan/defaults";
import { assertGrounded, mentionedIn } from "@/lib/plan/grounding";
import { LOCKED_RULE_KINDS } from "@/lib/rules/types";

function draft(overrides: Partial<CompiledDraft> = {}): CompiledDraft {
  return {
    reason: null,
    condition: null,
    durationDays: null,
    cadence: null,
    localTime: null,
    goal: null,
    redFlagTerms: null,
    medications: null,
    ...overrides,
  };
}

const options = {
  fallbackReason: "Follow-up",
  baseRedFlags: ["chest pain", "vomiting"],
  baseRules: [],
};

describe("applyDefaults — provenance is derived, not declared", () => {
  it("marks a value the note supplied as coming from the note", () => {
    const plan = applyDefaults(draft({ durationDays: 5, localTime: "17:30" }), options);

    expect(plan.durationDays).toBe(5);
    expect(plan.localTime).toBe("17:30");
    expect(plan.provenance.durationDays).toBe("note");
    expect(plan.provenance.localTime).toBe("note");
    expect(isDefaulted(plan.provenance, "durationDays")).toBe(false);
  });

  it("marks a value it filled in itself as defaulted", () => {
    const plan = applyDefaults(draft(), options);

    expect(plan.durationDays).toBe(DEFAULTS.durationDays);
    expect(plan.localTime).toBe(DEFAULTS.localTime);
    expect(plan.provenance.durationDays).toBe("default");
    expect(isDefaulted(plan.provenance, "localTime")).toBe(true);
  });

  /*
   * The mark has to follow the branch actually taken, not the field's name.
   * If a defaulted field could ever be marked "note", the review UI would be
   * telling the doctor they wrote something they did not.
   */
  it("never marks a defaulted field as coming from the note", () => {
    const plan = applyDefaults(draft({ durationDays: null, cadence: "weekly" }), options);
    expect(plan.provenance.cadence).toBe("note");
    expect(plan.provenance.durationDays).toBe("default");
  });

  it("treats a malformed model value as absent rather than trusting it", () => {
    const plan = applyDefaults(
      draft({
        localTime: "5:30pm",
        durationDays: 0,
        cadence: "hourly" as never,
      }),
      options,
    );

    expect(plan.localTime).toBe(DEFAULTS.localTime);
    expect(plan.durationDays).toBe(DEFAULTS.durationDays);
    expect(plan.cadence).toBe(DEFAULTS.cadence);
    expect(plan.provenance.localTime).toBe("default");
    expect(plan.provenance.cadence).toBe("default");
  });

  it("refuses an absurd duration", () => {
    expect(applyDefaults(draft({ durationDays: 400 }), options).durationDays).toBe(
      DEFAULTS.durationDays,
    );
  });

  it("takes the goal from the note, or fills its own and marks it", () => {
    const stated = applyDefaults(draft({ goal: "  Find out how the wound is healing.  " }), options);
    expect(stated.goal).toBe("Find out how the wound is healing.");
    expect(stated.provenance.goal).toBe("note");

    const silent = applyDefaults(draft({ goal: "   " }), options);
    expect(silent.goal).toBe(DEFAULT_GOAL);
    expect(silent.provenance.goal).toBe("default");
  });

  /* "Follow up for 3 days" is three days; a note that says nothing is seven. */
  it("takes the length from the note, else seven days", () => {
    const noteText = "Follow up for 3 days.";
    const stated = applyDefaults(draft({ durationDays: 3, durationQuote: "for 3 days" }), {
      ...options,
      noteText,
    });
    expect(stated.durationDays).toBe(3);
    expect(stated.provenance.durationDays).toBe("note");

    const silent = applyDefaults(draft(), { ...options, noteText: "Check on her." });
    expect(silent.durationDays).toBe(7);
    expect(silent.provenance.durationDays).toBe("default");
  });

  it("reads 'check in after 3 days' as one call on day three", () => {
    const noteText = "Started antibiotics. Check in after 3 days about the fever.";
    const plan = applyDefaults(
      draft({ startAfterDays: 3, startAfterQuote: "Check in after 3 days" }),
      { ...options, noteText },
    );
    expect(plan.startAfterDays).toBe(3);
    expect(plan.provenance.startAfterDays).toBe("note");
    expect(plan.scheduleQuotes.startAfterDays).toBe("Check in after 3 days");
    expect(plan.durationDays).toBe(1);
    expect(plan.provenance.durationDays).toBe("default");
  });

  it("keeps a stated length alongside a wait", () => {
    const noteText = "Recheck in 3 days, then daily for 5 days.";
    const plan = applyDefaults(
      draft({ startAfterDays: 3, startAfterQuote: "Recheck in 3 days", durationDays: 5, durationQuote: "for 5 days" }),
      { ...options, noteText },
    );
    expect(plan.startAfterDays).toBe(3);
    expect(plan.durationDays).toBe(5);
    expect(plan.provenance.durationDays).toBe("note");
  });

  it("reads 'for 3 days' as a length, never as a wait", () => {
    const noteText = "Follow up for 3 days.";
    const plan = applyDefaults(
      draft({ durationDays: 3, durationQuote: "for 3 days", startAfterDays: 3, startAfterQuote: "for 3 days" }),
      { ...options, noteText },
    );
    expect(plan.durationDays).toBe(3);
    expect(plan.startAfterDays).toBe(0);
    expect(plan.provenance.startAfterDays).toBe("default");
  });

  it("starts at once and runs seven days when the note says neither", () => {
    const plan = applyDefaults(draft(), { ...options, noteText: "Started metformin." });
    expect(plan.startAfterDays).toBe(0);
    expect(plan.durationDays).toBe(7);
    expect(plan.provenance.startAfterDays).toBe("default");
  });

  it("refuses a wait whose quote does not say that number, or is not in the note", () => {
    const noteText = "Check in after 3 days.";
    const wrongNumber = applyDefaults(
      draft({ startAfterDays: 5, startAfterQuote: "Check in after 3 days" }),
      { ...options, noteText },
    );
    expect(wrongNumber.startAfterDays).toBe(0);
    expect(wrongNumber.durationDays).toBe(7);

    const notInNote = applyDefaults(
      draft({ startAfterDays: 3, startAfterQuote: "call after 3 days" }),
      { ...options, noteText },
    );
    expect(notInNote.startAfterDays).toBe(0);
  });

  it("never offers the retry ladder to the model at all", () => {
    const plan = applyDefaults(draft(), options);
    expect(plan.provenance.maxAttempts).toBe("default");
    expect(plan.provenance.retryDelayMinutes).toBe("default");
    expect(plan.maxAttempts).toBe(DEFAULTS.maxAttempts);
  });
});

describe("applyDefaults — a schedule value is the note's only with the note's words", () => {
  const noteText = "Day 2 after cholecystectomy. Call her each morning for five days.";

  it("keeps each value whose quote the note contains, and records the words", () => {
    const plan = applyDefaults(
      draft({
        cadence: "daily",
        cadenceQuote: "each morning",
        durationDays: 5,
        durationQuote: "for five days",
        localTime: "09:00",
        localTimeQuote: "each morning",
      }),
      { ...options, noteText },
    );
    expect(plan.provenance.cadence).toBe("note");
    expect(plan.provenance.durationDays).toBe("note");
    expect(plan.provenance.localTime).toBe("note");
    expect(plan.scheduleQuotes).toEqual({
      cadence: "each morning",
      durationDays: "for five days",
      localTime: "each morning",
    });
  });

  /* The failure this exists for: a model that chose a schedule because it is
     usual, and the review screen telling the doctor they wrote it. */
  it("downgrades a value whose quote is not in the note to a default", () => {
    const plan = applyDefaults(
      draft({ cadence: "weekly", cadenceQuote: "once a week" }),
      { ...options, noteText },
    );
    expect(plan.cadence).toBe(DEFAULTS.cadence);
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.scheduleQuotes.cadence).toBeUndefined();
  });

  /* Found in the note is not the same as said by it: the words have to carry
     the value, or a model could quote five days and schedule thirty. */
  it("downgrades a value its quote does not actually say", () => {
    const plan = applyDefaults(
      draft({
        durationDays: 30,
        durationQuote: "for five days",
        cadence: "weekly",
        cadenceQuote: "each morning",
      }),
      { ...options, noteText },
    );
    expect(plan.provenance.durationDays).toBe("default");
    expect(plan.provenance.cadence).toBe("default");
  });

  it("reads 'a week' as seven days", () => {
    const plan = applyDefaults(draft({ durationDays: 7, durationQuote: "for a week" }), {
      ...options,
      noteText: "Check daily for a week.",
    });
    expect(plan.provenance.durationDays).toBe("note");
  });

  it("downgrades a value that arrives with no quote at all", () => {
    const plan = applyDefaults(draft({ localTime: "17:30" }), { ...options, noteText });
    expect(plan.localTime).toBe(DEFAULTS.localTime);
    expect(plan.provenance.localTime).toBe("default");
  });

  it("keeps a stated frequency the scheduler cannot follow, without scheduling it", () => {
    const plan = applyDefaults(draft({ cadence: null, cadenceQuote: "twice a day" }), {
      ...options,
      noteText: "Check in twice a day for three days.",
    });
    expect(plan.provenance.cadence).toBe("default");
    expect(plan.scheduleQuotes.unsupportedCadence).toBe("twice a day");
  });
});

describe("fieldsToMarkAsClinician — a save marks what the doctor chose, not everything", () => {
  const before = { durationDays: 5, localTime: "09:00", cadence: "daily", maxAttempts: 3 };

  it("leaves an unchanged note value as the note's", () => {
    const marked = fieldsToMarkAsClinician(before, { ...before, durationDays: 7 }, {
      durationDays: "note",
      localTime: "note",
      cadence: "note",
      maxAttempts: "default",
    });
    expect(marked).toContain("durationDays");
    expect(marked).not.toContain("localTime");
    expect(marked).not.toContain("cadence");
  });

  it("treats saving a placeholder as confirming it", () => {
    const marked = fieldsToMarkAsClinician(before, before, {
      durationDays: "default",
      localTime: "note",
      cadence: "note",
      maxAttempts: "default",
    });
    expect(marked.sort()).toEqual(["durationDays", "maxAttempts"]);
  });
});

describe("applyDefaults — red flags and locked rules", () => {
  it("keeps the condition list and marks compiler additions separately", () => {
    const plan = applyDefaults(draft({ redFlagTerms: ["couldn't keep water down"] }), options);

    const base = plan.redFlagTerms.filter((t) => t.source === "default").map((t) => t.term);
    const added = plan.redFlagTerms.filter((t) => t.source === "note").map((t) => t.term);

    expect(base).toEqual(["chest pain", "vomiting"]);
    expect(added).toEqual(["couldn't keep water down"]);
  });

  it("does not duplicate a term the catalog already covers", () => {
    const plan = applyDefaults(draft({ redFlagTerms: ["VOMITING"] }), options);
    expect(plan.redFlagTerms.filter((t) => t.term.toLowerCase() === "vomiting")).toHaveLength(1);
  });

  /*
   * The guarantee that cannot be argued with: whatever the model returned, and
   * whatever a clinician edited, the three locked rules are on the plan.
   */
  it("re-asserts the three locked rules onto every plan", () => {
    const plan = applyDefaults(draft(), options);
    const kinds = plan.rules.map((r) => r.rule.kind);
    for (const locked of LOCKED_RULE_KINDS) expect(kinds).toContain(locked);
    expect(plan.rules.filter((r) => r.source === "locked")).toHaveLength(3);
  });

  it("is deterministic", () => {
    const d = draft({ durationDays: 5, redFlagTerms: ["dizzy"] });
    expect(applyDefaults(d, options)).toEqual(applyDefaults(d, options));
  });
});

describe("quoteSaysDelay — the delay word must govern the number", () => {
  it("accepts a real wait before the first call", () => {
    expect(quoteSaysDelay(3, "Recheck in 3 days")).toBe(true);
    expect(quoteSaysDelay(3, "check in after three days")).toBe(true);
    expect(quoteSaysDelay(7, "see how she is in a week")).toBe(true);
    expect(quoteSaysDelay(2, "call her 2 days from now")).toBe(true);
  });

  /* A real note: a day since surgery, not a wait before calling. */
  it("refuses a number the delay word does not govern", () => {
    expect(quoteSaysDelay(3, "Day 3 after laparoscopic cholecystectomy")).toBe(false);
    expect(quoteSaysDelay(3, "Follow up for 3 days")).toBe(false);
    expect(quoteSaysDelay(5, "Recheck in 3 days")).toBe(false);
    /* The safety review's probes: a length with a stray "in" or "after" nearby. */
    expect(quoteSaysDelay(3, "follow up daily for 3 days after surgery")).toBe(false);
    expect(quoteSaysDelay(3, "for 3 days in the evening")).toBe(false);
    expect(quoteSaysDelay(3, "call in the next 3 days")).toBe(false);
  });

  it("refuses a wait quoted with the same words as the length", () => {
    const note = "Call in 3 days.";
    const plan = applyDefaults(
      draft({ startAfterDays: 3, startAfterQuote: "in 3 days", durationDays: 3, durationQuote: "in 3 days" }),
      { fallbackReason: "Follow-up", baseRedFlags: [], baseRules: [], noteText: note },
    );
    expect(plan.startAfterDays).toBe(0);
  });

  it("does not let a misread wait shift the calls", () => {
    const plan = applyDefaults(
      draft({
        startAfterDays: 3,
        startAfterQuote: "Day 3 after laparoscopic cholecystectomy",
        durationDays: 3,
        durationQuote: "Follow up for 3 days",
      }),
      {
        fallbackReason: "Follow-up",
        baseRedFlags: [],
        baseRules: [],
        noteText: "Day 3 after laparoscopic cholecystectomy. Follow up for 3 days.",
      },
    );
    expect(plan.startAfterDays).toBe(0);
    expect(plan.provenance.startAfterDays).toBe("default");
    expect(plan.durationDays).toBe(3);
  });
});

describe("assertGrounded", () => {
  const note =
    "Asha K, 54. Started metformin 500mg BD today. Escalate same day if she reports " +
    "vomiting or cannot keep fluids down.";

  it("accepts a medication written in the note", () => {
    expect(assertGrounded({ noteBody: note, medications: ["metformin"], compilerAddedTerms: [] }).ok).toBe(
      true,
    );
  });

  /*
   * The failure this gate exists for: an agent naming a drug the doctor never
   * prescribed, down a phone line, where nobody would catch it.
   */
  it("refuses a medication the note never mentions", () => {
    const result = assertGrounded({
      noteBody: note,
      medications: ["metformin", "insulin"],
      compilerAddedTerms: [],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].value).toBe("insulin");
    expect(result.violations[0].reason).toContain("did not write down");
  });

  it("refuses a red-flag term the compiler invented", () => {
    const result = assertGrounded({
      noteBody: note,
      medications: [],
      compilerAddedTerms: ["chest pain"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("red_flag_term");
  });

  it("accepts a term the note does use", () => {
    expect(
      assertGrounded({ noteBody: note, medications: [], compilerAddedTerms: ["vomiting"] }).ok,
    ).toBe(true);
  });

  it("matches a drug name written with its dose", () => {
    expect(mentionedIn(note, "metformin")).toBe(true);
    expect(mentionedIn("Started Metformin 500mg BD.", "metformin")).toBe(true);
  });

  it("is not fooled by a substring of a longer word", () => {
    expect(mentionedIn("The patient is on prednisolone.", "sone")).toBe(false);
  });

  it("matches a multi-word phrase", () => {
    expect(mentionedIn(note, "keep fluids down")).toBe(true);
    expect(mentionedIn(note, "keep solids down")).toBe(false);
  });
});
