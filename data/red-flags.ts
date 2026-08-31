/**
 * The global red-flag term lists, per condition.
 *
 * These seed every plan before the compiler ever runs. A term the compiler adds
 * from the doctor's note is stored with `source: "note"` and rendered marked as
 * an addition, so the clinician can see what the model proposed and delete it.
 * The clinician stays the clinical author.
 *
 * These are terms to *route on*, never to interpret. Hearing one raises an
 * escalation; it never produces a conclusion about what the patient has.
 */

export interface ConditionFlags {
  condition: string;
  label: string;
  terms: string[];
}

/** Applies to every plan regardless of condition. */
export const UNIVERSAL_RED_FLAGS = [
  "chest pain",
  "can't breathe",
  "cannot breathe",
  "struggling to breathe",
  "passed out",
  "fainted",
  "collapsed",
  "coughing blood",
  "vomiting blood",
  "blood in my stool",
  "worst headache",
  "slurred speech",
  "face is drooping",
  "can't move my arm",
  "suicidal",
  "want to end it",
];

export const CONDITION_RED_FLAGS: ConditionFlags[] = [
  {
    condition: "new_metformin",
    label: "New metformin · tolerance and adherence",
    terms: [
      "vomiting",
      "threw up",
      "can't keep water down",
      "cannot keep fluids down",
      "severe stomach pain",
      "not eating",
      "very dizzy",
      "confused",
    ],
  },
  {
    condition: "heart_failure",
    label: "Heart failure · daily weight and breathlessness",
    terms: [
      "breathless lying flat",
      "can't lie flat",
      "swollen ankles",
      "swollen legs",
      "gained weight overnight",
      "waking up gasping",
      "sleeping in a chair",
    ],
  },
  {
    condition: "statin_tolerance",
    label: "Statin tolerance · muscle pain check",
    terms: [
      "muscle pain",
      "muscle weakness",
      "dark urine",
      "brown urine",
      "can't climb stairs",
      "aching all over",
    ],
  },
  {
    condition: "post_op_wound",
    label: "Post-op wound · signs of infection",
    terms: [
      "wound is hot",
      "red streaks",
      "pus",
      "smells bad",
      "wound opened",
      "fever",
      "shivering",
      "bleeding through",
    ],
  },
  {
    condition: "asthma",
    label: "Asthma · inhaler technique and reliever use",
    terms: [
      "using my inhaler every",
      "reliever not working",
      "can't finish a sentence",
      "wheezing all night",
      "chest is tight",
    ],
  },
  {
    condition: "post_discharge",
    label: "Post-discharge · pain and mobility",
    terms: [
      "pain is worse",
      "can't stand",
      "fell over",
      "not managing at home",
      "no one is helping",
    ],
  },
  {
    condition: "blood_pressure",
    label: "Blood pressure recheck · new amlodipine",
    terms: [
      "very dizzy",
      "fainted",
      "swollen ankles",
      "pounding headache",
      "blurred vision",
    ],
  },
  {
    condition: "thyroid",
    label: "Thyroid recheck · symptom review",
    terms: [
      "heart racing",
      "can't sleep at all",
      "losing weight fast",
      "hands shaking",
      "very cold all the time",
    ],
  },
];

export function redFlagsFor(condition: string | null): string[] {
  const match = CONDITION_RED_FLAGS.find((c) => c.condition === condition);
  return [...UNIVERSAL_RED_FLAGS, ...(match?.terms ?? [])];
}
