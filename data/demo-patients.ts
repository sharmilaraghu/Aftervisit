/**
 * The seeded demo cohort.
 *
 * Every patient, clinician and clinic here is invented. Every phone literal is
 * in the US fiction-reserved 555-01xx range, because India publishes no reserved
 * range and a plausible +91 number probably belongs to a real person. The two
 * numbers that are actually dialled in the demo come from the environment at
 * seed time and are never committed — see `phoneOverrideEnv` below.
 *
 * `week` is not stored anywhere. It is written here as the *intended* shape of
 * each patient's seven days, and the seed builds real `scheduled_calls` rows
 * that produce it. The console then derives the band back out of those rows —
 * so the roster is reading the database, not this file.
 */

export type SeedDay =
  | "answered"
  | "flagged"
  | "missed"
  | "held"
  | "scheduled"
  | "none";

export interface SeedPatient {
  slug: string;
  name: string;
  age: number;
  timezone: string;
  phone: string;
  /**
   * When set, the value of this environment variable replaces `phone` at seed
   * time. This is how a real, armed number reaches the demo without ever being
   * written down in the repository.
   */
  phoneOverrideEnv?: string;
  consent: "granted" | "unknown" | "declined";
  condition: string;
  reason: string;
  /** The doctor's free text. The compiler's input, and the grounding source. */
  note: string;
  /** `awaiting_approval` seeds an unapproved plan with no occurrences. */
  planStatus: "active" | "paused" | "completed" | "awaiting_approval";
  /**
   * Which rule the `flagged` day fires. It has to match what the patient
   * actually said: the queue's entire claim is that the rule, the reason and
   * the words are the same story, and a red-flag label over a vague answer
   * quietly breaks it.
   *
   * `moderate_symptoms` is the only routine one. It raises a queue entry and
   * leaves the plan running, which is what separates "waiting on you" from
   * "needs you now" — and it still carries the patient's words, because a rule
   * fired on something they actually said.
   */
  flagRule?: "red_flag_term_heard" | "unmappable_response" | "moderate_symptoms";
  week: SeedDay[];
  /**
   * A course of treatment that ended before the current one.
   *
   * Real patients are followed up more than once, and until the console could
   * show that, "what were we treating them for in the summer" was a question it
   * could not answer. One `clinician_closed` and one `superseded` between them
   * cover both ways a plan ends by a decision rather than by running out of
   * calendar.
   */
  priorPlan?: SeedPriorPlan;
}

export interface SeedPriorPlan {
  condition: string;
  reason: string;
  note: string;
  /** How it ended. `superseded` also stamps the successor's `version`. */
  closeReason: "clinician_closed" | "superseded";
  /** How long ago it started and ended, in days. */
  startedDaysAgo: number;
  closedDaysAgo: number;
  /** How many of its calls were answered. The rest are never seeded. */
  answered: number;
}

/**
 * A patient nobody has written a plan for.
 *
 * Their own list rather than a variant of `SeedPatient`, because none of the
 * plan fields above mean anything here: there is no note, no condition, no
 * cadence and no week. `needs_plan` is derived from the *absent* plan row, so
 * seeding that state means seeding a patient and stopping.
 */
export interface SeedUnplannedPatient {
  slug: string;
  name: string;
  age: number;
  timezone: string;
  phone: string;
  consent: "granted" | "unknown" | "declined";
}

export const SEED_PATIENTS: SeedPatient[] = [
  {
    slug: "asha-k",
    name: "Asha K",
    age: 54,
    timezone: "Asia/Kolkata",
    phone: "+14155550100",
    phoneOverrideEnv: "CARELOOP_SEED_PHONE_PRIMARY",
    consent: "granted",
    condition: "new_metformin",
    reason: "New metformin · tolerance and adherence",
    note:
      "Asha K, 54. Started metformin 500mg BD today for newly diagnosed type 2 " +
      "diabetes. Counselled on GI side effects. Follow up daily for a week — I " +
      "want to know she is taking it and tolerating it. Escalate to me same day " +
      "if she reports vomiting or cannot keep fluids down.",
    planStatus: "paused",
    flagRule: "red_flag_term_heard",
    week: ["answered", "answered", "flagged", "held", "scheduled", "scheduled", "scheduled"],
  },
  {
    slug: "marcus-b",
    name: "Marcus B",
    age: 72,
    timezone: "Europe/London",
    phone: "+14155550117",
    // The retry ladder is demonstrated against a line that genuinely never
    // answers. No fake no_answer rows are ever seeded.
    phoneOverrideEnv: "CARELOOP_UNANSWERED_PHONE",
    consent: "granted",
    condition: "heart_failure",
    reason: "Heart failure · daily weight and breathlessness",
    note:
      "Marcus B, 72. Heart failure, recently up-titrated. Daily check for a " +
      "week: daily weight, breathlessness, ankle swelling. He lives alone and " +
      "he does not ring us when things slip, so I want to know if he goes quiet.",
    planStatus: "active",
    week: ["answered", "answered", "missed", "missed", "missed", "scheduled", "scheduled"],
    priorPlan: {
      condition: "chest_infection",
      reason: "Chest infection · antibiotic course",
      note:
        "Marcus B, 72. Community-acquired chest infection, five days of " +
        "amoxicillin. Daily check while he is on it — cough, fever, breathing.",
      closeReason: "clinician_closed",
      startedDaysAgo: 38,
      closedDaysAgo: 31,
      answered: 5,
    },
  },
];

export const SEED_UNPLANNED: SeedUnplannedPatient[] = [
  {
    slug: "victor-l",
    name: "Victor L",
    age: 46,
    timezone: "Europe/London",
    phone: "+14155550193",
    // Nobody has asked him about automated calls, because nobody has got as far
    // as writing his plan.
    consent: "unknown",
  },
];

/** What a reached call actually said, per condition. Real sentences, not lorem. */
export const DEMO_UTTERANCES: Record<string, string[]> = {
  chest_infection: [
    "Cough's still there but it's loosened up a lot since the tablets.",
    "No fever last night, first night I've slept through.",
    "Breathing's back to normal walking round the flat.",
  ],
  new_metformin: [
    "Yes, one in the morning and one at night, with food like you said.",
    "A bit of an upset stomach yesterday but it settled down.",
    "I threw up twice yesterday and I couldn't keep water down.",
  ],
  heart_failure: [
    "Weighed myself, same as yesterday. Breathing's alright.",
    "No change really. Ankles look the same to me.",
  ],
  statin_tolerance: [
    "No aches so far, taking it at night.",
    "Legs feel fine, no different from before.",
    "Still alright, nothing to report.",
    "Well, it's the same as it was, more or less, you know how it is.",
  ],
  post_op_wound: [
    "It's dry, no redness. Dressing's still clean.",
    "Bit sore but no discharge or anything.",
    "Looks the same as yesterday, clean.",
    "All fine, I've kept it covered.",
  ],
  asthma: [
    "Used the blue one twice yesterday.",
    "Slept through, no coughing.",
    "Once yesterday. Technique feels easier now.",
  ],
  post_discharge: [
    "Pain's about a four. I'm getting to the kitchen and back.",
    "Managing alright, my sister's been over.",
    // Last, because the seeded `flagged` day always takes the last sentence.
    // It has to be an answer that genuinely reads as moderate — the rule that
    // fires on it is `symptom_severity in ("moderate")`.
    "It's got a fair bit sorer since yesterday and I've stopped going upstairs.",
  ],
  thyroid: [
    "Energy's better than it was.",
    "No palpitations this week.",
    "Sleeping properly again.",
    "Still good, nothing new.",
    "Fine, same as before.",
    "All good, no complaints.",
  ],
};
