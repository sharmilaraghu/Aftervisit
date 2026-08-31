import { describe, expect, it } from "vitest";

import {
  addRedFlagTerm,
  isEditable,
  redFlagTerms,
  removeRedFlagTerm,
  removeRule,
  setBooleanValue,
  setDriftDays,
  setEnumValues,
  setThreshold,
  setUrgency,
} from "@/lib/rules/edit";
import { withLockedRules } from "@/lib/rules/catalog";
import { LOCKED_RULE_KINDS, type PlanRule } from "@/lib/rules/types";

const severity: PlanRule = {
  rule: { kind: "enum_in", questionId: "symptom_severity", values: ["severe"], urgent: false },
  source: "default",
  label: "Severe symptoms reported",
};

const pain: PlanRule = {
  rule: { kind: "scale_at_least", questionId: "pain", threshold: 7, urgent: false },
  source: "default",
  label: "Score reached the threshold",
};

const flags: PlanRule = {
  rule: { kind: "red_flag_term_heard", terms: ["vomiting"], urgent: true },
  source: "note",
  label: "Red flag term heard",
};

/** The locked three are always present, so a plan is never just its editable rules. */
function plan(...extra: PlanRule[]): PlanRule[] {
  return withLockedRules(extra);
}

function editable(rules: PlanRule[]): PlanRule[] {
  return rules.filter(isEditable);
}

describe("the locked three survive every edit", () => {
  it.each([
    ["setUrgency", (r: PlanRule[]) => setUrgency(r, 0, true)],
    ["removeRule", (r: PlanRule[]) => removeRule(r, 0)],
    ["setThreshold", (r: PlanRule[]) => setThreshold(r, 0, 3)],
    ["addRedFlagTerm", (r: PlanRule[]) => addRedFlagTerm(r, "fainting")],
  ])("%s cannot remove them", (_name, edit) => {
    const result = edit(plan(severity));
    const kinds = result.map((r) => r.rule.kind);
    for (const locked of LOCKED_RULE_KINDS) expect(kinds).toContain(locked);
  });

  it("refuses to delete a locked rule even when asked directly", () => {
    const rules = plan(severity);
    const lockedIndex = rules.findIndex((r) => !isEditable(r));
    expect(lockedIndex).toBeGreaterThanOrEqual(0);

    const after = removeRule(rules, lockedIndex);
    expect(after.filter((r) => !isEditable(r))).toHaveLength(3);
  });

  it("never marks a locked rule as the clinician's", () => {
    const after = setUrgency(plan(severity), 0, true);
    for (const r of after.filter((r) => !isEditable(r))) expect(r.source).toBe("locked");
  });
});

describe("every edit is attributed to the clinician", () => {
  /*
   * The point of the whole file. "The clinician stays the clinical author" is
   * only checkable if an edited rule is distinguishable from a proposed one.
   */
  it("stamps source: clinician on what was changed", () => {
    const rules = plan(severity);
    const index = rules.findIndex((r) => r.rule.kind === "enum_in");
    expect(rules[index].source).toBe("default");

    const after = setUrgency(rules, index, true);
    expect(after[after.findIndex((r) => r.rule.kind === "enum_in")].source).toBe("clinician");
  });

  it("leaves untouched rules with their original provenance", () => {
    const rules = plan(severity, pain);
    const after = setUrgency(rules, rules.findIndex((r) => r.rule.kind === "enum_in"), true);
    expect(after.find((r) => r.rule.kind === "scale_at_least")?.source).toBe("default");
  });
});

describe("what a clinician can change", () => {
  it("flips a rule between urgent and routine", () => {
    const rules = plan(severity);
    const i = rules.findIndex((r) => r.rule.kind === "enum_in");

    expect(setUrgency(rules, i, true)[i].rule.urgent).toBe(true);
    expect(setUrgency(rules, i, false)[i].rule.urgent).toBe(false);
  });

  it("sets a 0–10 threshold, bounded to the scale", () => {
    const rules = plan(pain);
    const i = rules.findIndex((r) => r.rule.kind === "scale_at_least");

    const at5 = setThreshold(rules, i, 5)[i].rule;
    expect(at5.kind === "scale_at_least" && at5.threshold).toBe(5);

    // A threshold outside 0–10 can never fire, so it is clamped rather than stored.
    const tooHigh = setThreshold(rules, i, 99)[i].rule;
    expect(tooHigh.kind === "scale_at_least" && tooHigh.threshold).toBe(10);
    const tooLow = setThreshold(rules, i, -4)[i].rule;
    expect(tooLow.kind === "scale_at_least" && tooLow.threshold).toBe(0);
  });

  it("chooses which answers to a question escalate", () => {
    const rules = plan(severity);
    const i = rules.findIndex((r) => r.rule.kind === "enum_in");
    const after = setEnumValues(rules, i, ["moderate", "severe"])[i].rule;
    expect(after.kind === "enum_in" && after.values).toEqual(["moderate", "severe"]);
  });

  it("chooses which yes/no answer escalates", () => {
    const rules = plan({
      rule: { kind: "boolean_equals", questionId: "taking", value: false, urgent: false },
      source: "default",
      label: "Answer needs a clinician",
    });
    const i = rules.findIndex((r) => r.rule.kind === "boolean_equals");
    const after = setBooleanValue(rules, i, true)[i].rule;
    expect(after.kind === "boolean_equals" && after.value).toBe(true);
  });

  it("sets the days of silence that count as drift, bounded", () => {
    const rules = plan({
      rule: { kind: "drift_days", days: 3, urgent: false },
      source: "default",
      label: "No contact",
    });
    const i = rules.findIndex((r) => r.rule.kind === "drift_days");

    const two = setDriftDays(rules, i, 2)[i].rule;
    expect(two.kind === "drift_days" && two.days).toBe(2);
    // Zero days would fire on every call; a year would never fire.
    const zero = setDriftDays(rules, i, 0)[i].rule;
    expect(zero.kind === "drift_days" && zero.days).toBe(1);
    const huge = setDriftDays(rules, i, 365)[i].rule;
    expect(huge.kind === "drift_days" && huge.days).toBe(30);
  });

  it("removes an editable rule", () => {
    const rules = plan(severity, pain);
    const after = removeRule(rules, rules.findIndex((r) => r.rule.kind === "enum_in"));
    expect(after.map((r) => r.rule.kind)).not.toContain("enum_in");
    expect(after.map((r) => r.rule.kind)).toContain("scale_at_least");
  });
});

describe("red-flag words", () => {
  it("adds a word, lowercased", () => {
    const after = addRedFlagTerm(plan(flags), "  Fainting  ");
    expect(redFlagTerms(after)).toEqual(["vomiting", "fainting"]);
  });

  it("does not add the same word twice", () => {
    const once = addRedFlagTerm(plan(flags), "VOMITING");
    expect(redFlagTerms(once)).toEqual(["vomiting"]);
  });

  it("ignores an empty word", () => {
    expect(redFlagTerms(addRedFlagTerm(plan(flags), "   "))).toEqual(["vomiting"]);
  });

  it("removes a word the compiler proposed", () => {
    const after = removeRedFlagTerm(plan(flags), "vomiting");
    expect(redFlagTerms(after)).toEqual([]);
  });

  it("creates the rule when the plan has none, and attributes it", () => {
    const after = addRedFlagTerm(plan(), "dark urine");
    expect(redFlagTerms(after)).toEqual(["dark urine"]);
    expect(after.find((r) => r.rule.kind === "red_flag_term_heard")?.source).toBe("clinician");
  });
});

describe("purity", () => {
  it("does not mutate the rules it was given", () => {
    const rules = plan(severity, pain, flags);
    const snapshot = structuredClone(rules);

    setUrgency(rules, 3, true);
    setThreshold(rules, 4, 2);
    addRedFlagTerm(rules, "chest pain");
    removeRule(rules, 3);

    expect(rules).toEqual(snapshot);
  });

  it("is deterministic", () => {
    const rules = plan(severity);
    expect(setUrgency(rules, 3, true)).toEqual(setUrgency(rules, 3, true));
  });

  it("keeps every editable rule editable", () => {
    const rules = plan(severity, pain, flags);
    expect(editable(rules)).toHaveLength(3);
  });
});
