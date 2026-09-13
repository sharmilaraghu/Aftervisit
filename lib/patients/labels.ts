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
  { value: "unknown", label: "Not recorded (nothing will be dialled)" },
  { value: "granted", label: "Agreed to automated calls" },
  { value: "declined", label: "Declined (will not be called)" },
];

/*
 * Unknown is blue, not amber. Amber is the action colour — a row of amber
 * "not recorded" strips competed with the one button the page was for — and
 * nobody is at risk when consent is missing: every call is simply refused.
 */
export const CONSENT_TONE: Record<string, Tone> = {
  granted: "clear",
  declined: "danger",
  unknown: "info",
};

export const HEALTH_LABEL: Record<PlanHealth, string> = {
  needs_plan: "Needs a plan",
  never_reached: "Never reached",
  on_track: "On track",
  /* One word for "a doctor must look", shared with Follow-ups. "Escalated" and
     "Drifting" were two more names for the same band there. */
  drifting: "Gone quiet",
  escalated: "Needs attention",
  /* The plan page's own stamp for the same state — and short enough that the
     roster's State column no longer clips it at phone width. */
  awaiting_approval: "Plan to review",
  paused: "Paused",
  /* "Finished", as on Follow-ups and the visit page. */
  completed: "Finished",
};

/*
 * Amber is not a status. It is the one action on a page, and three amber
 * states on the roster sat beside the amber "Register a patient" button and
 * out-shouted it. Waiting-on-you states are blue: they inform, nobody is at
 * risk, and red still interrupts for the ones where somebody might be.
 */
export const HEALTH_TONE: Record<PlanHealth, Tone> = {
  // Blue, not red: nobody is at risk yet, but this row is waiting on the doctor.
  needs_plan: "info",
  // Red: a window that closed without contact is the failure, not a footnote.
  never_reached: "danger",
  on_track: "clear",
  drifting: "danger",
  escalated: "danger",
  awaiting_approval: "info",
  paused: "info",
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

/**
 * The model's verdict, as a clinician reads it.
 *
 * The stored values are `severe | escalate | low` and they stay that way —
 * they carry consequences the words here do not: `severe` pauses the plan,
 * `escalate` queues the call while the follow-up keeps dialling. This is the
 * one place that decides how they are spoken, so renaming a badge never
 * quietly renames a behaviour.
 *
 * A patient with no triage at all is not a fourth severity. They are a row
 * with nothing said about them yet, and the page says exactly that.
 */
export const SEVERITY_LABEL: Record<string, string> = {
  severe: "Escalating",
  escalate: "Medium",
  low: "Low",
};

/** Red is spent here and nowhere else on the page. */
export const SEVERITY_TONE: Record<string, Tone> = {
  severe: "danger",
  escalate: "amber",
  low: "clear",
};

export const SEVERITY_ORDER: Record<string, number> = {
  severe: 0,
  escalate: 1,
  low: 2,
};

/**
 * What a call ended as, in words a doctor reads.
 *
 * It lived privately inside `CallLog` until Today's expanded row needed to say
 * the same thing about the same call. Two copies of a status vocabulary is how
 * two surfaces come to disagree about what happened on one phone call, which
 * is the failure this file exists to prevent.
 *
 * `failureCode` separates "nobody picked up" from "the call never went out".
 * Without it both read as `Failed`, which blames the patient for our outage.
 */
export function outcomeLabel(
  status: string,
  outcome: string | null,
  failureCode: string | null,
): string {
  if (outcome === "flagged") return "Red flag";
  if (outcome === "answered") return "Answered";
  if (outcome === "unmappable") return "Could not be mapped";
  if (outcome === "no_answer") return failureCode === "no_answer" ? "No answer" : "Failed";
  if (outcome === "refused") return "Refused";
  if (status === "skipped") return "Held";
  if (status === "scheduled") return "Scheduled";
  return status;
}

export function outcomeTone(outcome: string | null): { tone: Tone; quiet: boolean } {
  if (outcome === "flagged") return { tone: "danger", quiet: false };
  if (outcome === "answered") return { tone: "clear", quiet: true };
  if (outcome === "unmappable" || outcome === "no_answer") return { tone: "amber", quiet: true };
  return { tone: "plain", quiet: true };
}
