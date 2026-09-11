/**
 * The registration form's shape, shared by the server action and the client form.
 *
 * It lives here rather than beside the action because a `"use server"` module
 * may only export async functions — a type is fine, but the empty-state object
 * is not, and exporting one turns every page that imports it into a 500.
 */

export interface PatientFormState {
  errors: Partial<
    Record<
      | "name"
      | "age"
      | "phone"
      | "timezone"
      | "language"
      | "consent"
      | "visitKind"
      | "visitDate"
      | "reportedSymptoms"
      | "form",
      string
    >
  >;
  /** Echoed back so a rejected form does not make the front desk retype everything. */
  values: {
    name: string;
    age: string;
    phone: string;
    timezone: string;
    language: string;
    consent: string;
    /*
     * The visit. Present only when registering; editing a record never books
     * one, and the edit form leaves these blank and unrendered.
     */
    visitKind: string;
    visitDate: string;
    reportedSymptoms: string;
  };
}

export const EMPTY_PATIENT_FORM: PatientFormState = {
  errors: {},
  values: {
    name: "",
    age: "",
    phone: "",
    /* No zone until the number says one, or the desk picks. A pre-selected
       default is a choice nobody made, and a wrong zone means every call for
       the life of the plan lands at the wrong hour. */
    timezone: "",
    language: "en-IN",
    consent: "unknown",
    visitKind: "consultation",
    visitDate: "",
    reportedSymptoms: "",
  },
};
