/**
 * What each rule is called and why it exists.
 *
 * The catalog lives in code, not in a table. A rules table would invite runtime
 * rule authoring, and the whole claim of this system is that the decision layer
 * is inspectable, closed and reviewable — which stops being true the moment a
 * rule can be written from a form.
 *
 * Labels and reasons are snapshotted onto an escalation when it is raised.
 * Relabelling a rule here must never rewrite what a clinician was told last week.
 */

import type { Rule, RuleKind, PlanRule } from "@/lib/rules/types";
import { LOCKED_RULE_KINDS } from "@/lib/rules/types";

export interface RuleMeta {
  label: string;
  /** Why this rule exists, in a sentence a clinician would accept. */
  rationale: string;
  /** Locked rules cannot be removed by the compiler or by a clinician. */
  locked: boolean;
}

export const RULE_CATALOG: Record<RuleKind, RuleMeta> = {
  patient_requests_clinician: {
    label: "Patient asked for a clinician",
    rationale:
      "The patient asked to speak to a person. That request is not something an agent may talk them out of.",
    locked: true,
  },
  unmappable_response: {
    label: "Answer could not be mapped",
    rationale:
      "The answer did not map to any of the offered values. Care Loop does not guess what a patient meant.",
    locked: true,
  },
  emergency_language: {
    label: "Emergency language heard",
    rationale:
      "The patient described something that sounded urgent. Care Loop routes it to a person rather than judging it.",
    locked: true,
  },
  no_answer_exhausted: {
    label: "Every attempt went unanswered",
    rationale:
      "Nobody spoke on any attempt for this day. Silence is the signal this product exists to catch.",
    locked: false,
  },
};

/**
 * The three rules every plan carries, whatever the note said.
 *
 * Only two of them pause. `unmappable_response` routes to a clinician and lets
 * the plan keep dialling — see the note on its variant in `types.ts`. The
 * urgency is per kind rather than blanket, because "this must reach a person"
 * and "this must stop the follow-up" are different claims.
 */
export function lockedRules(): PlanRule[] {
  return LOCKED_RULE_KINDS.map((kind) => ({
    rule: (kind === "unmappable_response"
      ? { kind, urgent: false }
      : { kind, urgent: true }) as Rule,
    source: "locked" as const,
    label: RULE_CATALOG[kind].label,
  }));
}

/**
 * Put the locked rules back, whatever else the list contains.
 *
 * Called at approval, on the clinician's own edited set. A malformed edit, a
 * compiler that dropped one, or a hand-written plan can therefore never ship
 * without them — the guarantee is enforced here rather than trusted upstream.
 */
export function withLockedRules(rules: PlanRule[]): PlanRule[] {
  const kept = rules.filter(
    (r) => !LOCKED_RULE_KINDS.includes(r.rule.kind as (typeof LOCKED_RULE_KINDS)[number]),
  );
  return [...lockedRules(), ...kept];
}

/**
 * The rules every plan gets on top of the locked set.
 *
 * One, now. This used to add a `task_incomplete` rule and three threshold
 * matchers over `symptom_change`, `patient_concern` and `something_else_raised`
 * — all of them judgements about what the patient expressed, and all of them
 * now made by the model reading the actual transcript, which is better at it
 * and can say why. What is left is the one thing no transcript can tell you,
 * because there is no transcript: nobody answered, on any attempt.
 */
export function defaultRules(): PlanRule[] {
  return [
    {
      rule: { kind: "no_answer_exhausted", attempts: 3, urgent: false },
      source: "default",
      label: RULE_CATALOG.no_answer_exhausted.label,
    },
  ];
}

export function isLocked(kind: RuleKind): boolean {
  return RULE_CATALOG[kind].locked;
}
