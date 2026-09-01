/**
 * The patient form's shape, shared by the server action and the client form.
 *
 * It lives here rather than beside the action because a `"use server"` module
 * may only export async functions — a type is fine, but the empty-state object
 * is not, and exporting one turns every page that imports it into a 500.
 */

export interface PatientFormState {
  errors: Partial<
    Record<"name" | "age" | "phone" | "timezone" | "language" | "consent" | "note" | "form", string>
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
    timeScale: string;
  };
}

export const EMPTY_PATIENT_FORM: PatientFormState = {
  errors: {},
  values: {
    name: "",
    age: "",
    phone: "",
    timezone: "Europe/London",
    language: "en-US",
    consent: "unknown",
    note: "",
    timeScale: "1",
  },
};
