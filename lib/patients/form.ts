/**
 * The patient form's shape, shared by the server action and the client form.
 *
 * It lives here rather than beside the action because a `"use server"` module
 * may only export async functions — a type is fine, but the empty-state object
 * is not, and exporting one turns every page that imports it into a 500.
 */

export interface PatientFormState {
  /**
   * Set once a save actually landed. Only the inline corrections drawer on the
   * approval screen reads it: the full-page form redirects on success, so it
   * never needs to report one, but a drawer that stays put does.
   */
  saved?: boolean;
  errors: Partial<
    Record<
      | "name"
      | "age"
      | "phone"
      | "timezone"
      | "language"
      | "consent"
      | "note"
      | "escalationNote"
      | "localTime"
      | "cadence"
      | "durationDays"
      | "form",
      string
    >
  >;
  /** Echoed back so a rejected form does not make the clinician retype everything. */
  values: {
    name: string;
    age: string;
    phone: string;
    timezone: string;
    language: string;
    consent: string;
    /** Written in the same step as the patient, because that is when it exists. */
    note: string;
    escalationNote: string;
    timeScale: string;
    /* Blank on all three means "take it from the note". */
    localTime: string;
    cadence: string;
    durationDays: string;
  };
}

export const EMPTY_PATIENT_FORM: PatientFormState = {
  errors: {},
  values: {
    name: "",
    age: "",
    phone: "",
    /* No zone until the number says one, or the doctor picks. A pre-selected
       default is a choice nobody made, and a wrong zone means every call for
       the life of the plan lands at the wrong hour. */
    timezone: "",
    language: "en-US",
    consent: "unknown",
    note: "",
    escalationNote: "",
    timeScale: "1",
    localTime: "",
    cadence: "",
    durationDays: "",
  },
};
