/**
 * The decision layer.
 *
 * **Pure.** No IO, no clock, no model, no randomness. `now` is an argument.
 * Given the same call it returns the same escalations, in the same order,
 * forever. That is the whole point: "escalation is never model judgment" is a
 * claim someone can check by reading this file, and it stops being checkable
 * the moment anything here reaches outside itself.
 *
 * The model's job ended before this ran. It translated speech into typed slots;
 * what those slots *mean* for the patient's care is decided here, by code a
 * clinician could read.
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
  /** Terms the plan was told to escalate on, already lowercased by the caller. */
  redFlagTerms: string[];
  /**
   * Whether a human actually spoke to us on this call.
   *
   * Load-bearing. When nobody answered, *every* slot comes back `missing`, and
   * an ungated `unmappable_response` would then fire once per question and
   * urgently pause the plan on the very first unanswered call — destroying the
   * retry ladder before it made its second attempt. Silence is not an answer
   * that could not be mapped; it is handled by `no_answer_exhausted`.
   */
  reached: boolean;
  /** Every attempt for this occurrence ended with a no-answer failure code. */
  noAnswerExhausted: boolean;
  /** Attempts actually made for this occurrence. */
  attemptsMade: number;
  /** Calendar days since this patient was last heard, in their own zone. */
  quietForDays: number | null;
  /**
   * CALL-E's own verdict on whether the call did what it was asked to.
   *
   * `false` has been seen in production meaning the agent skipped its last two
   * questions and reported them as answered. Those two back locked rules, so an
   * agent quietly answering them for itself defeats the guarantee entirely —
   * which is why it is a rule rather than a log line.
   */
  taskCompleted: boolean | null;
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

/** The patient's words for a slot, when we have them. */
function words(slot: EvaluatedSlot | undefined): string | null {
  return slot?.utterance ?? null;
}

/**
 * Which terms from the plan's list appear in what the patient said.
 *
 * Substring matching on lowercased text, deliberately. It over-matches — "fever"
 * inside "no fever" fires — and that is the correct direction for a routing
 * decision: the cost of a clinician glancing at a call that turned out fine is
 * far below the cost of missing one that did not. The rule sends a human to
 * read the sentence; it does not decide what the sentence meant.
 */
function matchedTerms(text: string, terms: string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((term) => term.length > 0 && haystack.includes(term));
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
              ? `${list} could not be mapped to an answer. Care Loop does not guess what a patient meant.`
              : `${unresolved.length} answers could not be mapped: ${list}. Care Loop does not guess what a patient meant.`,
        }),
      ];
    }

    /*
     * One hit per distinct sentence, not per slot.
     *
     * A red flag is heard in something the patient said, and the same sentence
     * is routinely attached to several slots — extraction falls back to the most
     * informative patient turn whenever it cannot pin an answer to its question.
     * Firing per slot therefore puts the identical quote in the clinician's queue
     * five times over, which buries the four other things waiting for them.
     */
    case "red_flag_term_heard": {
      const terms = rule.terms.length ? rule.terms.map((t) => t.toLowerCase()) : input.redFlagTerms;
      const bySentence = new Map<string, { questionId: string; matched: string[] }>();

      for (const slot of input.slots) {
        const text = slot.utterance ?? slot.valueText ?? "";
        if (!text || bySentence.has(text)) continue;
        const matched = matchedTerms(text, terms);
        if (matched.length === 0) continue;
        bySentence.set(text, { questionId: slot.questionId, matched });
      }

      return [...bySentence].map(([text, { questionId, matched }]) =>
        hit({
          questionId,
          utterance: text,
          reason: `The plan listed ${matched
            .map((m) => `"${m}"`)
            .join(", ")} as a term to escalate on, and it appeared in what the patient said.`,
        }),
      );
    }

    case "no_answer_exhausted": {
      if (!input.noAnswerExhausted || input.attemptsMade < rule.attempts) return [];
      return [
        hit({
          reason: `${input.attemptsMade} attempts all ended with a no-answer failure code. Nobody has heard from this patient.`,
        }),
      ];
    }

    case "boolean_equals": {
      const slot = findSlot(input.slots, rule.questionId);
      if (!slot || slot.status !== "answered" || slot.valueBool !== rule.value) return [];
      return [hit({ questionId: slot.questionId, utterance: words(slot) })];
    }

    case "scale_at_least": {
      const slot = findSlot(input.slots, rule.questionId);
      if (!slot || slot.status !== "answered") return [];
      if (typeof slot.valueNumber !== "number" || slot.valueNumber < rule.threshold) return [];
      return [
        hit({
          questionId: slot.questionId,
          utterance: words(slot),
          reason: `The answer was ${slot.valueNumber}, at or above the threshold of ${rule.threshold} the plan set.`,
        }),
      ];
    }

    case "enum_in": {
      const slot = findSlot(input.slots, rule.questionId);
      if (!slot || slot.status !== "answered" || typeof slot.valueText !== "string") return [];
      if (!rule.values.includes(slot.valueText)) return [];
      return [
        hit({
          questionId: slot.questionId,
          utterance: words(slot),
          reason: `The answer was "${slot.valueText}", which the plan listed as needing a clinician.`,
        }),
      ];
    }

    case "task_incomplete": {
      if (input.taskCompleted !== false) return [];
      return [hit()];
    }

    case "drift_days": {
      if (input.quietForDays === null || input.quietForDays < rule.days) return [];
      return [
        hit({
          reason: `Nobody has heard from this patient in ${input.quietForDays} days. The follow-up has stopped working.`,
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
