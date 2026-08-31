/**
 * The rule DSL: a closed tagged union, with no parser.
 *
 * Closed because the evaluator must be exhaustive — a `switch` over `kind` that
 * TypeScript can prove covers every case. No parser because a rule that arrives
 * as a string is a rule nobody reviewed; every rule in a plan is either one of
 * the locked three or one the compiler proposed and a clinician kept.
 *
 * The types live here, separate from the catalog and the evaluator, because
 * `lib/db/schema.ts` stores rules as jsonb and must not import anything that
 * touches IO.
 *
 * AGENTS.md rule 5: the model translates, the rule engine decides. Nothing in
 * this file may ever grow a free-text predicate.
 */

/** Rules that cannot be removed from any plan, by compiler or clinician. */
export const LOCKED_RULE_KINDS = [
  "patient_requests_clinician",
  "unmappable_response",
  "emergency_language",
] as const;

export type LockedRuleKind = (typeof LOCKED_RULE_KINDS)[number];

export type Rule =
  /** The patient asked for a human. Always urgent, never removable. */
  | { kind: "patient_requests_clinician"; urgent: true }
  /** An answer did not map to any offered value. Uncertainty routes to a human. */
  | { kind: "unmappable_response"; urgent: true }
  /** Emergency language heard. Always urgent, never removable. */
  | { kind: "emergency_language"; urgent: true }
  /** A term from the plan's red-flag list appeared in the patient's own words. */
  | { kind: "red_flag_term_heard"; terms: string[]; urgent: boolean }
  /** Every attempt for an occurrence ended with a no-answer failure code. */
  | { kind: "no_answer_exhausted"; attempts: number; urgent: boolean }
  /** A yes/no answer came back with the escalating value. */
  | { kind: "boolean_equals"; questionId: string; value: boolean; urgent: boolean }
  /** A 0–10 answer reached or passed a threshold. */
  | { kind: "scale_at_least"; questionId: string; threshold: number; urgent: boolean }
  /** An enum answer landed in a set that needs a clinician. */
  | { kind: "enum_in"; questionId: string; values: string[]; urgent: boolean }
  /** Silence: nobody has heard from this patient in N days. */
  | { kind: "drift_days"; days: number; urgent: boolean }
  /**
   * CALL-E reported the call did not complete the task it was given.
   *
   * Not a duplicate of `unmappable_response`. That one fires when an answer
   * could not be mapped; this fires when the agent never asked at all and
   * reported an answer anyway — which is worse, because the slot looks answered.
   */
  | { kind: "task_incomplete"; urgent: boolean };

export type RuleKind = Rule["kind"];

/** A rule as stored on a plan, with the provenance that decides whether it can be deleted. */
export interface PlanRule {
  rule: Rule;
  /** `locked` rules are re-asserted by code at approval and the UI refuses to delete them. */
  source: "locked" | "note" | "default" | "clinician";
  /** Snapshotted at approval so relabelling the catalog cannot rewrite history. */
  label: string;
}

/** A red-flag term with where it came from — compiler additions render marked and deletable. */
export interface RedFlagTerm {
  term: string;
  source: "note" | "default" | "clinician";
}
