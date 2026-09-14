/**
 * The floor.
 *
 * **Pure.** No IO, no clock, no model, no randomness. `now` is an argument.
 * Given the same call it returns the same escalations, in the same order,
 * forever. That is the whole point: "no escalation depends on a model being
 * available, or being right" is a claim someone can check by reading this file,
 * and it stops being checkable the moment anything here reaches outside itself.
 *
 * A model runs on either side of this and neither one is load-bearing. One
 * translated speech into typed slots before it; `lib/triage/triage.ts` reads the
 * transcript after it and adds a severity, a summary, and the doctor's own
 * words. Whether the call gets in front of a clinician at all is settled here,
 * by code a clinician could read.
 *
 * Escalation is routing, never a verdict. Nothing in this file concludes
 * anything about a patient — it decides who should look.
 */

import { RULE_CATALOG } from "@/lib/rules/catalog";
import type { PlanRule, Rule } from "@/lib/rules/types";
import type { SlotStatus } from "@/lib/db/enums";

/** One typed answer, as extraction produced it. */
export interface EvaluatedSlot {
  questionId: string;
  status: SlotStatus;
  valueBool?: boolean | null;
  valueNumber?: number | null;
  valueText?: string | null;
  /** The patient's own words. Carried onto the escalation as evidence. */
  utterance?: string | null;
}

/** Everything the engine is allowed to know about a call. */
export interface EvaluationInput {
  slots: EvaluatedSlot[];
  rules: PlanRule[];
  /**
   * Whether a human actually spoke to us on this call.
   *
   * Load-bearing. When nobody answered, *every* slot comes back `missing`, and
   * an ungated `unmappable_response` would fire on the very first unanswered
   * call. Silence is not an answer that could not be mapped; it is handled by
   * `no_answer_exhausted`.
   *
   * The gate is only as good as the signal behind it: `someoneSpoke` once
   * counted an *observation* as speech, so a declined call arrived here with
   * `reached: true` and this rule fired on a conversation that never happened.
   * The floor cannot be stronger than what it is told.
   */
  reached: boolean;
  /** Nobody spoke on any attempt for this occurrence. */
  noAnswerExhausted: boolean;
  /**
   * Whether every one of those attempts was ended by the destination network
   * rather than going unanswered.
   *
   * It changes what the escalation says, not whether it fires. A ladder that
   * exhausted because the number could not be dialled and one that exhausted
   * because a patient did not pick up are the same row in the queue and two
   * completely different jobs for the clinician who opens it.
   *
   * Optional because the floor must still work when nobody tells it: absent,
   * the wording stays the one it has always used.
   */
  networkRefusedAll?: boolean;
  /** Attempts actually made for this occurrence. */
  attemptsMade: number;
  /**
   * How clearly each of the note's topics was answered, in order. The agent's
   * own `goal_covered` is its opinion of itself; these are what it recorded per
   * topic, and a call that reached the patient with not one clear answer did
   * not find out what it set out to, whatever it says. Absent for older plans.
   */
  findings?: { clarity: string | null }[];
  /** Injected. The engine never reads a clock. */
  now: Date;
}

export interface RuleHit {
  ruleId: string;
  ruleLabel: string;
  urgent: boolean;
  reason: string;
  /** Which slot fired it, when one did. Null for silence-based rules. */
  questionId: string | null;
  utterance: string | null;
}

export interface Evaluation {
  hits: RuleHit[];
  /** True if any hit is urgent. An urgent hit pauses the plan. */
  shouldPause: boolean;
}

function findSlot(slots: EvaluatedSlot[], questionId: string): EvaluatedSlot | undefined {
  return slots.find((s) => s.questionId === questionId);
}

/**
 * Whether the call did not find out what it was for.
 *
 * The agent's `goal_covered` alone is not trusted to say it did: with topics
 * on the plan, at least one of them must have come back clear.
 */
function goalUnresolved(goal: EvaluatedSlot, findings: EvaluationInput["findings"] = []): boolean {
  if (goal.status !== "answered" || goal.valueText === "none") return true;
  return findings.length > 0 && !findings.some((f) => f.clarity === "clear");
}

/**
 * Whether a call's answers leave something a person must pick up.
 *
 * A goal-driven call answers that on `goal_covered` and its topics. A plan from
 * before goals — with no such slot — keeps the old reading: any unmappable or
 * missing answer. Used for the call's folded outcome, so it matches the floor.
 */
export function unresolvedCall(slots: EvaluatedSlot[], findings?: EvaluationInput["findings"]): boolean {
  const goal = findSlot(slots, "goal_covered");
  if (goal) return goalUnresolved(goal, findings);
  return slots.some((s) => s.status === "unmappable" || s.status === "missing");
}

/** The patient's words for a slot, when we have them. */
function words(slot: EvaluatedSlot | undefined): string | null {
  return slot?.utterance ?? null;
}

function evaluateRule(rule: Rule, input: EvaluationInput): RuleHit[] {
  const meta = RULE_CATALOG[rule.kind];
  const hit = (over: Partial<RuleHit> = {}): RuleHit => ({
    ruleId: rule.kind,
    ruleLabel: meta.label,
    urgent: rule.urgent,
    reason: meta.rationale,
    questionId: null,
    utterance: null,
    ...over,
  });

  switch (rule.kind) {
    case "patient_requests_clinician": {
      const slot = findSlot(input.slots, "requests_clinician");
      return slot?.valueBool === true
        ? [hit({ questionId: slot.questionId, utterance: words(slot) })]
        : [];
    }

    case "emergency_language": {
      const slot = findSlot(input.slots, "emergency_language_heard");
      return slot?.valueBool === true
        ? [hit({ questionId: slot.questionId, utterance: words(slot) })]
        : [];
    }

    /*
     * Unmappable and missing both land here. They are different facts — one is
     * "they said something we could not place", the other "they never answered
     * it" — but they have the same destination, because neither can be resolved
     * without a person. One hit per unresolved slot, so the clinician sees which.
     */
    /*
     * One hit for the whole call, naming every question it covers.
     *
     * It used to raise one per unresolved slot. A single real call produced
     * five identical rows in the clinician's queue, which buries the three
     * other things waiting there — and a clinician reading them takes one
     * action, not five. The questions are listed in the reason instead.
     */
    case "unmappable_response": {
      // Nobody spoke, so nothing could have been unmappable. An unanswered call
      // is silence, and silence has its own rule.
      if (!input.reached) return [];

      /*
       * A goal-driven call has no fixed question list, so "an answer that could
       * not be mapped" is read once, at the level of the goal. Its observations
       * are often honestly `unknown` — a patient who never compared today with
       * last week — and firing on each of those would put every routine call in
       * front of a person. What must reach a person is a call that got through
       * and still did not find out what it was for.
       */
      const goal = findSlot(input.slots, "goal_covered");
      if (goal) {
        if (!goalUnresolved(goal, input.findings)) return [];
        return [
          hit({
            questionId: goal.questionId,
            utterance: words(goal),
            reason:
              goal.status === "answered"
                ? "The patient was reached, but the call did not find out what it set out to. AfterVisit does not guess; a person should follow up."
                : "The patient was reached, but the call could not say whether it found out what it set out to. AfterVisit does not guess; a person should follow up.",
          }),
        ];
      }

      const unresolved = input.slots.filter(
        (s) => s.status === "unmappable" || s.status === "missing",
      );
      if (unresolved.length === 0) return [];

      const names = unresolved.map((s) => s.questionId.replace(/_/g, " "));
      const list =
        names.length === 1
          ? `"${names[0]}"`
          : `${names.slice(0, -1).map((n) => `"${n}"`).join(", ")} and "${names.at(-1)}"`;

      return [
        hit({
          questionId: unresolved[0].questionId,
          utterance: words(unresolved.find((s) => s.utterance)),
          reason:
            unresolved.length === 1
              ? `${list} could not be mapped to an answer. AfterVisit does not guess what a patient meant.`
              : `${unresolved.length} answers could not be mapped: ${list}. AfterVisit does not guess what a patient meant.`,
        }),
      ];
    }

    case "no_answer_exhausted": {
      if (!input.noAnswerExhausted || input.attemptsMade < rule.attempts) return [];

      /* Never say "nobody answered" about a call that never rang. */
      if (input.networkRefusedAll) {
        return [
          hit({
            ruleLabel: "This number could not be reached",
            reason: `${input.attemptsMade} attempts and the network refused every one — none of them rang. This is a problem with the number, not a patient who did not pick up. Check it before the next course.`,
          }),
        ];
      }

      return [
        hit({
          reason: `${input.attemptsMade} attempts and nobody spoke on any of them. Nobody has heard from this patient.`,
        }),
      ];
    }
  }
}

/**
 * Evaluate one call against a plan's rules.
 *
 * Every rule is evaluated — the engine never short-circuits on the first hit.
 * A clinician opening the queue should see everything that fired, not whichever
 * one happened to be listed first.
 */
export function evaluate(input: EvaluationInput): Evaluation {
  const hits: RuleHit[] = [];
  for (const planRule of input.rules) {
    hits.push(...evaluateRule(planRule.rule, input));
  }

  /*
   * Deduplicated by rule and slot. Two red-flag rules matching the same
   * sentence are one thing for a clinician to look at, not two — and the
   * database's dedupe key would collapse them anyway, silently.
   */
  const seen = new Set<string>();
  const deduped = hits.filter((h) => {
    const key = `${h.ruleId}:${h.questionId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Urgent first: the queue renders in this order and so does the reader's eye.
  deduped.sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return { hits: deduped, shouldPause: deduped.some((h) => h.urgent) };
}
