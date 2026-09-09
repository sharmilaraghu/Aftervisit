/**
 * How derived plan health is spoken and coloured.
 *
 * Separate from `deriveHealth()` because the derivation is a fact about the
 * data and this is a decision about the interface — and because red here is
 * governed by a design rule, not by severity: escalation and drift earn it,
 * nothing else does. A paused plan is amber; a completed one is inert.
 */

import type { PlanHealth } from "@/lib/db/enums";
import type { Tone } from "@/components/ui";

/**
 * Consent, as a state a clinician reads rather than a column value.
 *
 * Here rather than on a page because two surfaces now print it — the patient
 * record and the approval screen — and it is the one field on either that
 * decides whether a phone rings. Two hand-maintained copies of a safety label
 * is how the two surfaces come to disagree about it.
 */
export const CONSENT_LABEL: Record<string, string> = {
  granted: "Agreed to automated calls",
  declined: "Declined automated calls",
  unknown: "Consent not recorded",
};

/**
 * The same three states, written as choices rather than as facts.
 *
 * One list, because there were four wordings across four screens — "Consent to
 * automated calls", "Agreed to automated follow-up calls", "Already agreed" and
 * "Agreed to AI calls" — for one field. The docstring above already warned that
 * two hand-maintained copies of a safety label is how surfaces come to
 * disagree; there were four. Each option names its consequence, because that is
 * what the doctor is actually choosing between.
 */
export const CONSENT_OPTIONS = [
  { value: "unknown", label: "Not recorded — nothing will be dialled" },
  { value: "granted", label: "Agreed to automated calls" },
  { value: "declined", label: "Declined — will not be called" },
];

export const CONSENT_TONE: Record<string, Tone> = {
  granted: "clear",
  declined: "danger",
  unknown: "amber",
};

export const HEALTH_LABEL: Record<PlanHealth, string> = {
  needs_plan: "Needs a plan",
  never_reached: "Never reached",
  on_track: "On track",
  drifting: "Drifting",
  escalated: "Escalated",
  awaiting_approval: "Awaiting approval",
  paused: "Paused",
  completed: "Completed",
};

export const HEALTH_TONE: Record<PlanHealth, Tone> = {
  // Amber, not red: nobody is at risk yet, but this row is waiting on the doctor.
  needs_plan: "amber",
  // Red: a window that closed without contact is the failure, not a footnote.
  never_reached: "danger",
  on_track: "clear",
  drifting: "danger",
  escalated: "danger",
  awaiting_approval: "amber",
  paused: "amber",
  completed: "plain",
};

/** Escalated and drifting first: the roster is sorted by who needs attention. */
export const HEALTH_ORDER: Record<PlanHealth, number> = {
  escalated: 0,
  never_reached: 1,
  drifting: 2,
  // A patient with no plan sits high on purpose: they are receiving nothing at
  // all, which is a worse silence than a plan that is merely paused.
  needs_plan: 3,
  paused: 4,
  awaiting_approval: 5,
  on_track: 6,
  completed: 7,
};
