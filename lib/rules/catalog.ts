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
  red_flag_term_heard: {
    label: "Red flag term heard",
    rationale:
      "A term the plan was told to escalate on appeared in what the patient said.",
    locked: false,
  },
  no_answer_exhausted: {
    label: "Three attempts, no answer",
    rationale:
      "Every attempt for this day ended with a no-answer failure code. Silence is the signal this product exists to catch.",
    locked: false,
  },
  boolean_equals: {
    label: "Answer needs a clinician",
    rationale: "A yes/no answer came back with the value the plan was told to escalate on.",
    locked: false,
  },
  scale_at_least: {
    label: "Score reached the threshold",
    rationale: "A rated answer reached or passed the threshold the plan set.",
    locked: false,
  },
  enum_in: {
    label: "Answer needs a clinician",
    rationale: "The answer landed in the set of values the plan was told to escalate on.",
    locked: false,
  },
  task_incomplete: {
    label: "The agent did not finish the call",
    rationale:
      "CALL-E reported the call did not complete the task. Some answers may have been recorded without the question being asked, so none of them can be relied on without a person checking.",
    locked: false,
  },
  drift_days: {
    label: "No contact for several days",
    rationale:
      "Nobody has heard from this patient for long enough that the follow-up has stopped working.",
    locked: false,
  },
};

/** The three rules every plan carries, whatever the note said. */
export function lockedRules(): PlanRule[] {
  return LOCKED_RULE_KINDS.map((kind) => ({
    rule: { kind, urgent: true } as Rule,
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
 * The rules every plan gets by default, on top of the locked three.
 *
 * `task_incomplete` is here rather than in the locked set because it is about
 * the agent's own performance rather than the patient's care — but it defaults
 * on, because a call where the agent answered its own questions is worthless
 * and nobody would think to add the rule themselves.
 */
export function defaultRules(): PlanRule[] {
  return [
    {
      rule: { kind: "task_incomplete", urgent: false },
      source: "default",
      label: RULE_CATALOG.task_incomplete.label,
    },
    /*
     * The three below read what the patient expressed about themselves, which
     * is the richest signal a call produces and the one a clinician most wants
     * to set a threshold on. They default to routine — a queue entry, not a
     * paused plan — because "worse" and "very concerned" are common and a
     * doctor should decide for each patient whether they are urgent.
     */
    {
      rule: {
        kind: "enum_in",
        questionId: "symptom_change",
        values: ["worse"],
        urgent: false,
      },
      source: "default",
      label: "Said things are worse",
    },
    {
      rule: {
        kind: "enum_in",
        questionId: "patient_concern",
        values: ["very"],
        urgent: false,
      },
      source: "default",
      label: "Very concerned about themselves",
    },
    {
      rule: {
        kind: "boolean_equals",
        questionId: "something_else_raised",
        value: true,
        urgent: false,
      },
      source: "default",
      label: "Raised something the questions did not cover",
    },
  ];
}

export function isLocked(kind: RuleKind): boolean {
  return RULE_CATALOG[kind].locked;
}
