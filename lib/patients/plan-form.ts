/**
 * The consult form's shape.
 *
 * Separate from the action for the same reason as the patient form: a
 * `"use server"` module may only export async functions, so the empty-state
 * object cannot live beside the action that consumes it.
 */

export interface CompileFormState {
  values: { note: string; escalation: string };
  error?: string;
}

export const EMPTY_COMPILE_FORM: CompileFormState = {
  values: { note: "", escalation: "" },
};

/**
 * How fast a clinical day runs.
 *
 * A persisted number on the plan, applied once at expansion. Everything
 * downstream sees real timestamps, so the mechanism being demonstrated at 1440×
 * is the same one that ships at 1×.
 */
export const TIME_SCALE_OPTIONS = [
  { value: "1", label: "Real time — a day is a day" },
  { value: "60", label: "Demo · a clinical day per hour" },
  { value: "1440", label: "Demo · a clinical day per minute" },
];
