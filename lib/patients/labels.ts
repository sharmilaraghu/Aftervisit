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
