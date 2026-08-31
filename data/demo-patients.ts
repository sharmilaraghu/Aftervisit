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
   */
  flagRule?: "red_flag_term_heard" | "unmappable_response";
  week: SeedDay[];
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
  },
  {
    slug: "owen-h",
    name: "Owen H",
    age: 61,
    timezone: "Europe/London",
    phone: "+14155550142",
    consent: "granted",
    condition: "statin_tolerance",
    reason: "Statin tolerance · muscle pain check",
    note:
      "Owen H, 61. Second attempt at a statin after stopping the last one for " +
      "muscle aches. Daily for a week — ask about muscle pain and weakness. If " +
      "he reports dark urine, that is same-day.",
    planStatus: "paused",
    flagRule: "unmappable_response",
    week: ["answered", "answered", "answered", "flagged", "held", "scheduled", "scheduled"],
  },
  {
    slug: "daniel-o",
    name: "Daniel O",
    age: 67,
    timezone: "Europe/London",
    phone: "+14155550108",
    consent: "granted",
    condition: "post_op_wound",
    reason: "Post-op wound · signs of infection",
    note:
      "Daniel O, 67. Day 2 post inguinal hernia repair. Wound clean and dry on " +
      "discharge. Daily wound check for a week — redness, discharge, fever.",
    planStatus: "active",
    week: ["answered", "answered", "answered", "answered", "scheduled", "scheduled", "scheduled"],
  },
  {
    slug: "priya-n",
    name: "Priya N",
    age: 41,
    timezone: "Asia/Kolkata",
    phone: "+14155550123",
    consent: "granted",
    condition: "asthma",
    reason: "Asthma · inhaler technique and reliever use",
    note:
      "Priya N, 41. Asthma review — reliever use had crept up to most days. " +
      "Retaught inhaler technique and started a preventer. Daily for a week: " +
      "how many times she has needed the reliever, and night symptoms.",
    planStatus: "active",
    week: ["answered", "answered", "answered", "scheduled", "scheduled", "scheduled", "scheduled"],
  },
  {
    slug: "nadia-f",
    name: "Nadia F",
    age: 35,
    timezone: "Europe/London",
    phone: "+14155550166",
    consent: "granted",
    condition: "post_discharge",
    reason: "Post-discharge · pain and mobility",
    note:
      "Nadia F, 35. Discharged yesterday after a fall. No fracture. Daily for a " +
      "week — pain control and whether she is managing to move about at home.",
    planStatus: "active",
    week: ["answered", "answered", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"],
  },
  {
    slug: "tomas-r",
    name: "Tomas R",
    age: 58,
    timezone: "Europe/London",
    phone: "+14155550171",
    consent: "unknown",
    condition: "blood_pressure",
    reason: "Blood pressure recheck · new amlodipine",
    note:
      "Tomas R, 58. Started amlodipine 5mg today. Recheck over the next week — " +
      "ankle swelling, dizziness, and whether he is actually taking it.",
    // Seeded unapproved on purpose: the roster needs one plan waiting on the
    // doctor, and consent is still `unknown` because nobody has asked him yet.
    planStatus: "awaiting_approval",
    week: ["none", "none", "none", "none", "none", "none", "none"],
  },
  {
    slug: "leah-s",
    name: "Leah S",
    age: 29,
    timezone: "Europe/London",
    phone: "+14155550188",
    consent: "granted",
    condition: "thyroid",
    reason: "Thyroid recheck · symptom review",
    note:
      "Leah S, 29. Levothyroxine dose changed six weeks ago. A week of daily " +
      "symptom checks before her bloods: energy, palpitations, sleep.",
    planStatus: "completed",
    week: ["answered", "answered", "answered", "missed", "answered", "answered", "answered"],
  },
];

/** What a reached call actually said, per condition. Real sentences, not lorem. */
export const DEMO_UTTERANCES: Record<string, string[]> = {
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
