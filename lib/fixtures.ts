/**
 * Demo fixtures for the console shell.
 *
 * TEMPORARY. These exist so the visual world can be built and reviewed against
 * a dense Operate surface before the schema lands; every one of them is deleted
 * when `lib/db/` and the seeds arrive (build order step 2). Nothing here is
 * imported by `lib/` logic — only by the console routes.
 *
 * Every patient, clinician and clinic is invented. Every number is in the US
 * fiction-reserved 555-01xx range and is masked before it reaches the screen,
 * because this UI ends up in a published video and on a public URL.
 */

import { maskPhone } from "@/lib/phone/normalize";

export type PlanState =
  | "on_track"
  | "drifting"
  | "escalated"
  | "awaiting_approval"
  | "paused"
  | "completed";

/**
 * One day of the follow-up window. The roster puts every patient's week on the
 * same seven-cell axis so they can be compared by eye down a column, rather
 * than read one tile at a time.
 */
export type DayState = "answered" | "missed" | "flagged" | "held" | "scheduled" | "none";

export interface FixturePatient {
  id: string;
  name: string;
  age: number;
  timezone: string;
  phone: string;
  reason: string;
  state: PlanState;
  /** Occurrences reached / occurrences due so far. */
  contacted: number;
  due: number;
  /** Days since the last answered call. The drift signal. */
  quietFor: number;
  lastHeard: string;
  /** Exactly seven, one per day of the window. */
  week: DayState[];
}

export const PATIENTS: FixturePatient[] = [
  {
    id: "asha-k",
    name: "Asha K",
    age: 54,
    timezone: "Asia/Kolkata",
    phone: "+14155550100",
    reason: "New metformin · tolerance and adherence",
    state: "escalated",
    contacted: 2,
    due: 3,
    quietFor: 0,
    lastHeard: "19 Aug · 17:31",
    week: ["answered", "answered", "flagged", "held", "scheduled", "scheduled", "scheduled"],
  },
  {
    id: "marcus-b",
    name: "Marcus B",
    age: 72,
    timezone: "Europe/London",
    phone: "+14155550117",
    reason: "Heart failure · daily weight and breathlessness",
    state: "drifting",
    contacted: 2,
    due: 5,
    quietFor: 3,
    lastHeard: "16 Aug · 09:04",
    week: ["answered", "answered", "missed", "missed", "missed", "scheduled", "scheduled"],
  },
  {
    id: "owen-h",
    name: "Owen H",
    age: 61,
    timezone: "Europe/London",
    phone: "+14155550142",
    reason: "Statin tolerance · muscle pain check",
    state: "paused",
    contacted: 4,
    due: 4,
    quietFor: 1,
    lastHeard: "18 Aug · 18:12",
    week: ["answered", "answered", "answered", "flagged", "held", "scheduled", "scheduled"],
  },
  {
    id: "daniel-o",
    name: "Daniel O",
    age: 67,
    timezone: "Europe/London",
    phone: "+14155550108",
    reason: "Post-op wound · signs of infection",
    state: "on_track",
    contacted: 4,
    due: 4,
    quietFor: 0,
    lastHeard: "19 Aug · 10:02",
    week: ["answered", "answered", "answered", "answered", "scheduled", "scheduled", "scheduled"],
  },
  {
    id: "priya-n",
    name: "Priya N",
    age: 41,
    timezone: "Asia/Kolkata",
    phone: "+14155550123",
    reason: "Asthma · inhaler technique and reliever use",
    state: "on_track",
    contacted: 3,
    due: 3,
    quietFor: 1,
    lastHeard: "18 Aug · 19:40",
    week: ["answered", "answered", "answered", "scheduled", "scheduled", "scheduled", "scheduled"],
  },
  {
    id: "nadia-f",
    name: "Nadia F",
    age: 35,
    timezone: "Europe/London",
    phone: "+14155550166",
    reason: "Post-discharge · pain and mobility",
    state: "on_track",
    contacted: 2,
    due: 2,
    quietFor: 0,
    lastHeard: "19 Aug · 11:15",
    week: ["answered", "answered", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"],
  },
  {
    id: "tomas-r",
    name: "Tomas R",
    age: 58,
    timezone: "Europe/London",
    phone: "+14155550171",
    reason: "Blood pressure recheck · new amlodipine",
    state: "awaiting_approval",
    contacted: 0,
    due: 0,
    quietFor: 0,
    lastHeard: "—",
    week: ["none", "none", "none", "none", "none", "none", "none"],
  },
  {
    id: "leah-s",
    name: "Leah S",
    age: 29,
    timezone: "Europe/London",
    phone: "+14155550188",
    reason: "Thyroid recheck · symptom review",
    state: "completed",
    contacted: 7,
    due: 7,
    quietFor: 6,
    lastHeard: "13 Aug · 17:29",
    week: ["answered", "answered", "answered", "missed", "answered", "answered", "answered"],
  },
];

export const STATE_LABEL: Record<PlanState, string> = {
  on_track: "On track",
  drifting: "Drifting",
  escalated: "Escalated",
  awaiting_approval: "Awaiting approval",
  paused: "Paused",
  completed: "Completed",
};

/** Red is danger only: escalations and drift. Nothing else earns it. */
export const STATE_TONE: Record<PlanState, "amber" | "danger" | "info" | "clear" | "plain"> = {
  on_track: "clear",
  drifting: "danger",
  escalated: "danger",
  awaiting_approval: "amber",
  paused: "amber",
  completed: "plain",
};

export interface FixtureEscalation {
  id: string;
  patientId: string;
  patient: string;
  rule: string;
  ruleLabel: string;
  urgent: boolean;
  raisedAt: string;
  /** The patient's own words. Never a summary. */
  utterance: string | null;
  reason: string;
}

export const ESCALATIONS: FixtureEscalation[] = [
  {
    id: "ESC-0031",
    patientId: "asha-k",
    patient: "Asha K",
    rule: "red_flag_term_heard",
    ruleLabel: "Red flag term heard",
    urgent: true,
    raisedAt: "19 Aug · 17:31",
    utterance: "I threw up twice yesterday and I couldn't keep water down.",
    reason:
      "The note listed vomiting and not keeping fluids down as terms to escalate the same day.",
  },
  {
    id: "ESC-0030",
    patientId: "marcus-b",
    patient: "Marcus B",
    rule: "no_answer_exhausted",
    ruleLabel: "Three attempts, no answer",
    urgent: false,
    raisedAt: "19 Aug · 09:12",
    utterance: null,
    reason:
      "Attempts 1, 2 and 3 all ended with a no-answer failure code. Nobody has heard from this patient in three days.",
  },
  {
    id: "ESC-0029",
    patientId: "owen-h",
    patient: "Owen H",
    rule: "unmappable_response",
    ruleLabel: "Answer could not be mapped",
    urgent: true,
    raisedAt: "18 Aug · 18:12",
    utterance: "Well, it's the same as it was, more or less, you know how it is.",
    reason:
      "The answer did not map to any of the offered values. Care Loop does not guess what a patient meant.",
  },
];

/** Phone numbers are masked everywhere, always. */
export function displayPhone(e164: string): string {
  return maskPhone(e164);
}
