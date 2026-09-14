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

import type { TopicUnit } from "@/lib/plan/result-schema";

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
  /** BCP 47 tag the agent speaks — one of `LANGUAGE_OPTIONS`. */
  language: string;
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
  planStatus: "active" | "paused" | "completed";
  /** What the calls set out to find out, as the parser would read it from `note`. */
  goal: string;
  /**
   * What to find out, each with the note's own words for it — exactly what a
   * live parse stores. Every `quote` is a phrase `note` really contains.
   */
  watchPoints: { text: string; quote: string; unit?: TopicUnit }[];
  /** A short answer per topic, in the same order, for every reached call. */
  topicAnswers: string[];
  /** For a measured topic: the number given on each reached call, in order. */
  measured?: { topic: number; values: string[] };
  /**
   * Which topic the day's utterance answers, so the patient's words sit under
   * the one thing they were about. Omitted, no topic carries a quote — the
   * same sentence under every topic would be wrong evidence, not weak evidence.
   */
  utteranceTopic?: number;
  /**
   * The triage summary of the last answered call — what the doctor's
   * Follow-ups view reads as how the patient is doing. Omitted, the seed
   * writes a plain account of the call instead.
   */
  conditionSummary?: string;
  /**
   * A waiting visit booked for today, for a patient coming back with a new
   * problem. It puts them on the doctor's Consultations list with their
   * earlier follow-up shown beside the note.
   */
  visitToday?: { kind: "consultation" | "post_op"; reportedSymptoms: string };
  /*
   * The shape a live parse gives a plan: the note's words behind each schedule
   * value and the doctor's own escalation wording.
   */
  escalationNote?: string;
  scheduleQuotes?: Record<string, string>;
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
  /**
   * How this course ended, for `seed --closed`: the file the doctor closed and,
   * when a day was flagged or went quiet, what the doctor did about it. Written
   * as a clinician would record it — what happened, never advice to the patient.
   */
  closed?: { summary: string; resolution?: "resumed" | "contacted_patient"; resolutionNote?: string };
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
 * seeding that state means seeding a patient, booking their visit, and
 * stopping — the visit is what puts them on the doctor's consult list.
 */
export interface SeedUnplannedPatient {
  slug: string;
  name: string;
  age: number;
  timezone: string;
  language: string;
  phone: string;
  consent: "granted" | "unknown" | "declined";
  /** What the front desk booked. In the receptionist's words, never the model's input. */
  visit: { kind: "consultation" | "post_op"; reportedSymptoms: string };
}

/*
 * An India practice: every patient on Asia/Kolkata and speaking a language the
 * register form offers. The numbers stay US fiction-reserved on purpose (see
 * the header) — the +1 is the price of never committing a real person's phone.
 */
export const SEED_PATIENTS: SeedPatient[] = [
  {
    slug: "asha-k",
    name: "Asha K",
    age: 54,
    timezone: "Asia/Kolkata",
    language: "hi-IN",
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
    goal: "Find out whether she is taking the metformin and tolerating it.",
    watchPoints: [
      { text: "whether she is taking the metformin", quote: "she is taking it" },
      { text: "how she is tolerating it", quote: "tolerating it" },
    ],
    topicAnswers: ["taking it twice a day with food", "stomach upset at times"],
    utteranceTopic: 1,
    scheduleQuotes: { cadence: "daily", durationDays: "for a week" },
    flagRule: "red_flag_term_heard",
    week: ["answered", "answered", "flagged", "held", "scheduled", "scheduled", "scheduled"],
    closed: {
      summary:
        "Vomiting settled within a day once the tablets were taken with food. Taking metformin twice daily and tolerating it on every later call. Follow-up complete.",
      resolution: "resumed",
      resolutionNote: "Spoke to her the same afternoon. Keeping fluids down by the evening, so calls resumed.",
    },
  },
  {
    slug: "mohan-b",
    name: "Mohan B",
    age: 72,
    timezone: "Asia/Kolkata",
    language: "en-IN",
    phone: "+14155550117",
    // The retry ladder is demonstrated against a line that genuinely never
    // answers. No fake no_answer rows are ever seeded.
    phoneOverrideEnv: "CARELOOP_UNANSWERED_PHONE",
    consent: "granted",
    condition: "heart_failure",
    reason: "Heart failure · daily weight and breathlessness",
    note:
      "Mohan B, 72. Heart failure, recently up-titrated. Daily check for a " +
      "week: daily weight, breathlessness, ankle swelling. He lives alone and " +
      "he does not ring us when things slip, so I want to know if he goes quiet.",
    planStatus: "active",
    goal: "Find out whether his weight, breathing and ankle swelling are holding steady.",
    watchPoints: [
      { text: "his daily weight", quote: "daily weight" },
      { text: "breathlessness", quote: "breathlessness" },
      { text: "ankle swelling", quote: "ankle swelling" },
    ],
    topicAnswers: ["same as yesterday", "breathing alright", "no change"],
    scheduleQuotes: { cadence: "Daily check", durationDays: "for a week" },
    week: ["answered", "answered", "missed", "missed", "missed", "scheduled", "scheduled"],
    closed: {
      summary:
        "Went quiet for three days mid-week. Reached by the clinic; weight and breathing steady on the last two calls. File closed, clinic review booked.",
      resolution: "contacted_patient",
      resolutionNote: "Rang him from the clinic. He had been staying with his daughter and had no new symptoms.",
    },
    priorPlan: {
      condition: "chest_infection",
      reason: "Chest infection · antibiotic course",
      note:
        "Mohan B, 72. Community-acquired chest infection, five days of " +
        "amoxicillin. Daily check while he is on it — cough, fever, breathing.",
      closeReason: "clinician_closed",
      startedDaysAgo: 38,
      closedDaysAgo: 31,
      answered: 5,
    },
  },
  {
    /* Recovering well: three calls answered, nothing concerning. The doctor's
       view shows her as "No concerns raised", with the last reading's words. */
    slug: "farida-s",
    name: "Farida S",
    age: 47,
    timezone: "Asia/Kolkata",
    language: "en-IN",
    phone: "+14155550131",
    consent: "granted",
    condition: "post_op_wound",
    reason: "Hernia repair · wound and pain",
    note:
      "Farida S, 47. Day 3 after an inguinal hernia repair. Call each evening for a week: " +
      "is the wound dry, is the pain settling. Escalate if the wound discharges or she has a fever.",
    planStatus: "active",
    goal: "Find out whether the wound is staying dry and the pain is settling.",
    watchPoints: [
      { text: "whether the wound is dry", quote: "is the wound dry" },
      { text: "her pain score", quote: "is the pain settling", unit: "score_0_10" },
    ],
    topicAnswers: ["dry, no discharge", "settling"],
    measured: { topic: 1, values: ["5", "4", "3", "3", "2", "2", "1"] },
    utteranceTopic: 0,
    scheduleQuotes: { cadence: "each evening", durationDays: "for a week", localTime: "each evening" },
    week: ["answered", "answered", "answered", "scheduled", "scheduled", "scheduled", "scheduled"],
    closed: {
      summary: "Wound dry and healed, pain down to 1 out of 10 by the end of the week. Discharged from follow-up.",
    },
    conditionSummary:
      "Wound is dry with no redness or discharge, and the pain is settling. Nothing she described is concerning.",
  },
  {
    /*
     * A follow-up whose window ran out with nobody closing the file — the
     * doctor's "Finished: close the file or restart" band. He is also back
     * today with something new, so the consultation shows this course as his
     * history beside the note.
     */
    slug: "ravi-t",
    name: "Ravi T",
    age: 58,
    timezone: "Asia/Kolkata",
    language: "en-IN",
    phone: "+14155550164",
    consent: "granted",
    condition: "thyroid",
    reason: "Thyroid dose change · energy and palpitations",
    note:
      "Ravi T, 58. Levothyroxine increased to 75mcg. Daily check for a week: energy, " +
      "palpitations, sleep. Escalate if he has chest pain or a racing heart.",
    planStatus: "completed",
    goal: "Find out how his energy, heart rhythm and sleep are on the new dose.",
    watchPoints: [
      { text: "his energy", quote: "energy" },
      { text: "palpitations", quote: "palpitations" },
      { text: "his sleep", quote: "sleep" },
    ],
    topicAnswers: ["better than before", "none this week", "sleeping properly"],
    scheduleQuotes: { cadence: "Daily check", durationDays: "for a week" },
    week: ["answered", "answered", "answered", "answered", "answered", "answered", "answered"],
    conditionSummary:
      "Energy is better, no palpitations this week, and he is sleeping properly. Nothing concerning on any call.",
    closed: {
      summary: "Energy and sleep back to normal on 75mcg, no palpitations all week. No further calls needed.",
    },
    visitToday: {
      kind: "consultation",
      reportedSymptoms:
        "Sore throat and a mild fever for two days. Also asking whether the thyroid tablets need changing.",
    },
  },
];

export const SEED_UNPLANNED: SeedUnplannedPatient[] = [
  {
    slug: "vikram-l",
    name: "Vikram L",
    age: 46,
    timezone: "Asia/Kolkata",
    language: "ta-IN",
    phone: "+14155550193",
    // Nobody has asked him about automated calls, because nobody has got as far
    // as writing his plan.
    consent: "unknown",
    visit: {
      kind: "consultation",
      reportedSymptoms:
        "Three weeks of a dry cough, worse at night. No fever. Wants to know whether it needs anything.",
    },
  },
  {
    slug: "priya-n",
    name: "Priya N",
    age: 38,
    timezone: "Asia/Kolkata",
    language: "en-IN",
    phone: "+14155550158",
    // Agreed at the desk, so the plan compiled from her note can actually ring.
    consent: "granted",
    visit: {
      kind: "post_op",
      reportedSymptoms:
        "Day 3 after laparoscopic cholecystectomy. Asking whether some redness around the lower port site is normal.",
    },
  },
];

/**
 * Patients waiting to be seen today, for `seed --waiting`.
 *
 * Booked at the desk, consent recorded, no note yet — they sit on the doctor's
 * Consultations list so a demo can write the note and press Save and start
 * follow-up. Numbers stay fiction-reserved: a follow-up started for one of them
 * dials a line that cannot connect.
 */
export const SEED_WAITING: SeedUnplannedPatient[] = [
  {
    slug: "anil-d",
    name: "Anil D",
    age: 63,
    timezone: "Asia/Kolkata",
    language: "en-IN",
    phone: "+14155550172",
    consent: "granted",
    visit: {
      kind: "consultation",
      reportedSymptoms:
        "Blood pressure read 164/100 at the pharmacy last week. Occasional headaches in the morning. Already on amlodipine.",
    },
  },
  {
    slug: "kavya-m",
    name: "Kavya M",
    age: 34,
    timezone: "Asia/Kolkata",
    language: "ta-IN",
    phone: "+14155550185",
    consent: "granted",
    visit: {
      kind: "post_op",
      reportedSymptoms:
        "Day 2 after a laparoscopic appendectomy. Asking how to look after the wound and when the stitches come out.",
    },
  },
  {
    slug: "joseph-p",
    name: "Joseph P",
    age: 69,
    timezone: "Asia/Kolkata",
    language: "ml-IN",
    phone: "+14155550146",
    consent: "granted",
    visit: {
      kind: "consultation",
      reportedSymptoms:
        "Getting short of breath on the stairs for about two weeks. Ankles swollen by the evening.",
    },
  },
];

/** What a reached call actually said, per condition. Real sentences, not lorem. */
export const DEMO_UTTERANCES: Record<string, string[]> = {
  chest_infection: [
    "Cough's still there but it's loosened up a lot since the tablets.",
    "No fever last night, first night I've slept through.",
    "Breathing's back to normal walking around the house.",
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
