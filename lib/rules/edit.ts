/**
 * Editing a plan's rules — the doctor defining what counts as an emergency.
 *
 * What counts is patient-specific. A dizziness of 5 is unremarkable in one
 * person and a same-day callback in another, and only the doctor knows which.
 * Until now the compiler had the last word: it proposed rules and the review
 * screen rendered them as read-only badges, which contradicts the product's own
 * claim that the clinician stays the clinical author.
 *
 * Every function here is **pure** and returns a new list. Two invariants hold on
 * every write:
 *
 *   1. `withLockedRules` is re-asserted, so the three that can never be removed
 *      survive any edit — including a malformed one.
 *   2. An edited rule is stamped `source: "clinician"`, so the review screen can
 *      distinguish what the doctor chose from what the model proposed. That is
 *      the same provenance discipline the plan's fields already use, and it is
 *      what makes "the clinician stays the clinical author" checkable.
 */

import { withLockedRules } from "@/lib/rules/catalog";
import { LOCKED_RULE_KINDS, type PlanRule, type Rule } from "@/lib/rules/types";

/** A rule a clinician may change. The locked three are never in this set. */
export function isEditable(rule: PlanRule): boolean {
  return !LOCKED_RULE_KINDS.includes(
    rule.rule.kind as (typeof LOCKED_RULE_KINDS)[number],
  );
}

/** Rules are addressed by position: two `enum_in` rules can share a question id. */
function mapAt(
  rules: PlanRule[],
  index: number,
  change: (rule: PlanRule) => PlanRule,
): PlanRule[] {
  return withLockedRules(
    rules.map((r, i) => {
      if (i !== index || !isEditable(r)) return r;
      return { ...change(r), source: "clinician" as const };
    }),
  );
}

/** Pause the plan and tell me now, versus add it to my queue. */
export function setUrgency(rules: PlanRule[], index: number, urgent: boolean): PlanRule[] {
  return mapAt(rules, index, (r) => ({ ...r, rule: { ...r.rule, urgent } as Rule }));
}

/** The threshold on a 0–10 answer: escalate at or above this. */
export function setThreshold(rules: PlanRule[], index: number, threshold: number): PlanRule[] {
  const bounded = Math.max(0, Math.min(10, Math.round(threshold)));
  return mapAt(rules, index, (r) =>
    r.rule.kind === "scale_at_least"
      ? { ...r, rule: { ...r.rule, threshold: bounded } }
      : r,
  );
}

/** Which answers to a choice question escalate. */
export function setEnumValues(
  rules: PlanRule[],
  index: number,
  values: string[],
): PlanRule[] {
  return mapAt(rules, index, (r) =>
    r.rule.kind === "enum_in" ? { ...r, rule: { ...r.rule, values } } : r,
  );
}

/** Which answer to a yes/no question escalates. */
export function setBooleanValue(
  rules: PlanRule[],
  index: number,
  value: boolean,
): PlanRule[] {
  return mapAt(rules, index, (r) =>
    r.rule.kind === "boolean_equals" ? { ...r, rule: { ...r.rule, value } } : r,
  );
}

/** Days of silence before the patient is treated as drifting. */
export function setDriftDays(rules: PlanRule[], index: number, days: number): PlanRule[] {
  const bounded = Math.max(1, Math.min(30, Math.round(days)));
  return mapAt(rules, index, (r) =>
    r.rule.kind === "drift_days" ? { ...r, rule: { ...r.rule, days: bounded } } : r,
  );
}

/**
 * Remove a rule.
 *
 * A locked rule is silently kept rather than refused. The caller is a form, and
 * the honest response to "delete something that cannot be deleted" is that it is
 * still there — which `withLockedRules` guarantees anyway.
 */
export function removeRule(rules: PlanRule[], index: number): PlanRule[] {
  return withLockedRules(rules.filter((r, i) => i !== index || !isEditable(r)));
}

/** Add a red-flag word. Lowercased and de-duplicated; matching is case-insensitive. */
export function addRedFlagTerm(rules: PlanRule[], term: string): PlanRule[] {
  const clean = term.trim().toLowerCase();
  if (!clean) return withLockedRules(rules);

  const index = rules.findIndex((r) => r.rule.kind === "red_flag_term_heard");
  if (index === -1) {
    return withLockedRules([
      ...rules,
      {
        rule: { kind: "red_flag_term_heard", terms: [clean], urgent: true },
        source: "clinician",
        label: "Red flag term heard",
      },
    ]);
  }

  return mapAt(rules, index, (r) =>
    r.rule.kind === "red_flag_term_heard" && !r.rule.terms.includes(clean)
      ? { ...r, rule: { ...r.rule, terms: [...r.rule.terms, clean] } }
      : r,
  );
}

export function removeRedFlagTerm(rules: PlanRule[], term: string): PlanRule[] {
  const index = rules.findIndex((r) => r.rule.kind === "red_flag_term_heard");
  if (index === -1) return withLockedRules(rules);

  return mapAt(rules, index, (r) =>
    r.rule.kind === "red_flag_term_heard"
      ? { ...r, rule: { ...r.rule, terms: r.rule.terms.filter((t) => t !== term) } }
      : r,
  );
}

/** Every red-flag word currently on the plan, across all such rules. */
export function redFlagTerms(rules: PlanRule[]): string[] {
  const terms = new Set<string>();
  for (const r of rules) {
    if (r.rule.kind === "red_flag_term_heard") for (const t of r.rule.terms) terms.add(t);
  }
  return [...terms];
}
