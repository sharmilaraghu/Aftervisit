import { describe, expect, it } from "vitest";

import { applyDefaults, DEFAULTS, isDefaulted, type CompiledDraft } from "@/lib/plan/defaults";
import { assertGrounded, mentionedIn } from "@/lib/plan/grounding";
import { LOCKED_RULE_KINDS } from "@/lib/rules/types";

function draft(overrides: Partial<CompiledDraft> = {}): CompiledDraft {
  return {
    reason: null,
    condition: null,
    durationDays: null,
    cadence: null,
    localTime: null,
    questions: null,
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

  it("never offers the retry ladder to the model at all", () => {
    const plan = applyDefaults(draft(), options);
    expect(plan.provenance.maxAttempts).toBe("default");
    expect(plan.provenance.retryDelayMinutes).toBe("default");
    expect(plan.maxAttempts).toBe(DEFAULTS.maxAttempts);
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
