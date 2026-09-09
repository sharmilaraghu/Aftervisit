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
 * AGENTS.md rule 5: the rule engine sets the floor. Nothing in this file may
 * ever grow a free-text predicate — a model's reading belongs on top of the
 * engine, in `lib/triage/`, never inside its DSL.
 *
 * **Four kinds, and that is the whole DSL.** It used to carry ten, including
 * threshold and enum matchers and a substring red-flag matcher. A doctor
 * authored none of them — `baseRules` was `[]` at every call site, so every
 * rule on every plan came from `lockedRules()` + `defaultRules()` — and the
 * model now reads the transcript and sets severity far better than a substring
 * match ever did. What survives is a floor, not a language: the three things
 * that must reach a person even when no model is available, plus exhausted
 * attempts. Nobody sees these, nobody edits them, and that is the point.
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
  /**
   * An answer did not map to any offered value. Uncertainty routes to a human.
   *
   * **Not urgent, deliberately.** It used to be, and pausing on this was wrong:
   * the commonest reason a call is useless is that it did not go well, and the
   * retry ladder exists for exactly that. Pausing on attempt 1 of 3 meant the
   * ladder could never run for its own primary case — a real declined call lost
   * both its remaining attempts to it. PRODUCT.md's locked behaviour says
   * unmappable answers *escalate* by default; it never said stop dialling.
   */
  | { kind: "unmappable_response"; urgent: false }
  /** Emergency language heard. Always urgent, never removable. */
  | { kind: "emergency_language"; urgent: true }
  /** Every attempt for an occurrence went unanswered. */
  | { kind: "no_answer_exhausted"; attempts: number; urgent: boolean };

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
