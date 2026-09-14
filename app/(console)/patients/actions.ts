"use server";

/**
 * Patient mutations.
 *
 * There is no auth in this build, deliberately, and the chrome says so. Every
 * action here is therefore reachable by anyone with the URL — which is why the
 * dial allowlist, not a session, is what stops the scheduler phoning a stranger.
 *
 * Validation refuses rather than guesses. A phone number without a country code
 * is rejected with the sentence already written in `lib/phone/normalize.ts`,
 * because a guessed code dials someone who never consented to anything.
 */

import { revalidatePath } from "next/cache";
import { readConfig } from "@/lib/config";
import { redirect } from "next/navigation";

import {
  createPatient,
  deletePatient,
  DuplicatePhoneError,
  stopCalls,
  updatePatient,
  type PatientInput,
} from "@/lib/db/patients";
import { createVisit } from "@/lib/db/visits";
import { resumePlan } from "@/lib/schedule/store";
import { REJECTION_TEXT, normalizePhone } from "@/lib/phone/normalize";
import { PRACTICE_TIMEZONE, isValidTimezone } from "@/lib/patients/timezones";
import { isValidLanguage } from "@/lib/patients/languages";
import { VISIT_KINDS, type ConsentState, type VisitKind } from "@/lib/db/enums";
import type { PatientFormState } from "@/lib/patients/form";

const CONSENTS: ConsentState[] = ["unknown", "granted", "declined"];

/**
 * Read the form. `withVisit` is the registration desk, which also books the
 * visit; the edit page passes false and the visit fields are not looked at.
 */
function parse(
  formData: FormData,
  withVisit: boolean,
): {
  state: PatientFormState;
  input: PatientInput | null;
  visit: { kind: VisitKind; visitDate: string; reportedSymptoms: string } | null;
} {
  const name = String(formData.get("name") ?? "").trim();
  const ageRaw = String(formData.get("age") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  /* Set here, not read from the form: the practice runs on one clock. */
  const timezone = PRACTICE_TIMEZONE;
  const language = String(formData.get("language") ?? "en-IN").trim() || "en-IN";
  /*
   * Consent is asked once, at registration, and never re-asked on a call. It
   * is what authorises dialling — `lib/calle/port.ts` refuses a patient whose
   * consent is anything but `granted` — so the default here is `unknown`, not
   * `granted`. A checkbox nobody ticked must not read as a patient who agreed.
   */
  const consentRaw =
    formData.get("consent") === null
      ? "unknown"
      : String(formData.get("consent")).trim() || "unknown";
  const visitKind = String(formData.get("visitKind") ?? "consultation").trim();
  const visitDate = String(formData.get("visitDate") ?? "").trim();
  const reportedSymptoms = String(formData.get("reportedSymptoms") ?? "").trim();

  const state: PatientFormState = {
    errors: {},
    values: {
      name,
      age: ageRaw,
      phone: phoneRaw,
      timezone,
      language,
      consent: consentRaw,
      visitKind,
      visitDate,
      reportedSymptoms,
    },
  };

  if (!name) state.errors.name = "A name is required.";

  const age = Number(ageRaw);
  if (!ageRaw) {
    state.errors.age = "An age is required.";
  } else if (!Number.isInteger(age) || age < 0 || age > 129) {
    state.errors.age = "Age must be a whole number between 0 and 129.";
  }

  // The refusal text is already written, in the product's voice, and tested.
  // Rewriting it here would let two versions of the same sentence drift.
  const phone = normalizePhone(phoneRaw);
  if (!phone.ok) state.errors.phone = REJECTION_TEXT[phone.reason];

  if (!isValidTimezone(timezone)) {
    state.errors.timezone =
      "Pick a timezone. Without one, a plan's 10:00 means the server's 10:00 and drifts across daylight saving.";
  }

  if (!isValidLanguage(language)) {
    state.errors.language =
      "Pick a language. This is what the agent speaks on the call, so a malformed tag reaches a real phone.";
  }

  const consent = CONSENTS.includes(consentRaw as ConsentState)
    ? (consentRaw as ConsentState)
    : null;
  if (!consent) state.errors.consent = "Choose whether this patient has agreed to AI calls.";

  if (withVisit) {
    if (!(VISIT_KINDS as readonly string[]).includes(visitKind)) {
      state.errors.visitKind = "Pick what sort of visit this is.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      state.errors.visitDate = "Pick the day of the visit.";
    }
    /* A visit with no complaint is a booking nobody can consult on. */
    if (!reportedSymptoms) {
      state.errors.reportedSymptoms = "Write what they came in with, even briefly.";
    }
  }

  if (Object.keys(state.errors).length > 0 || !phone.ok || !consent) {
    return { state, input: null, visit: null };
  }

  return {
    state,
    input: {
      name,
      age,
      phoneE164: phone.e164,
      timezone,
      language,
      aiCallConsent: consent,
    },
    visit: withVisit
      ? { kind: visitKind as VisitKind, visitDate, reportedSymptoms }
      : null,
  };
}

/**
 * The front desk: register a patient, or bring a known one back, and book the
 * visit the doctor will see on the consult list.
 *
 * Nothing clinical happens here. The note, the questions and the schedule are
 * the doctor's, written at the consultation; this only records who is coming,
 * when, and what they say is wrong.
 */
export async function registerVisitAction(
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const existingId = String(formData.get("patientId") ?? "").trim();
  const { state, input, visit } = parse(formData, true);
  if (!input || !visit) return state;

  let id: string;
  try {
    id = existingId ? ((await updatePatient(existingId, input)), existingId) : await createPatient(input);
  } catch (error) {
    if (error instanceof DuplicatePhoneError) {
      return {
        ...state,
        errors: {
          ...state.errors,
          phone:
            "Another active patient already has this number. AfterVisit will not " +
            "create a second record on it — two plans would phone the same person twice.",
        },
      };
    }
    throw error;
  }

  const visitId = await createVisit({ patientId: id, ...visit });

  /* Straight to the doctor's list. It has no tabs: the notice there says
     when a visit booked for a later day will appear. */
  revalidatePath("/patients");
  revalidatePath("/consult");
  redirect(`/consult?registered=${visitId}`);
}

export async function updatePatientAction(
  id: string,
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const { state, input } = parse(formData, false);
  if (!input) return state;

  let ok: boolean;
  try {
    ok = await updatePatient(id, input);
  } catch (error) {
    if (error instanceof DuplicatePhoneError) {
      return {
        ...state,
        errors: {
          ...state.errors,
          phone: "Another active patient already has this number.",
        },
      };
    }
    throw error;
  }

  if (!ok) {
    return {
      ...state,
      errors: { ...state.errors, form: "That patient no longer exists, or has been archived." },
    };
  }

  revalidatePath("/patients");
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}`);
}

/** The emergency brake: skip every unplaced call and pause the plan. */
export async function stopCallsAction(id: string): Promise<{ stopped: number }> {
  const result = await stopCalls(id);
  revalidatePath("/patients");
  revalidatePath(`/patients/${id}`);
  return { stopped: result.stopped };
}

/**
 * Let the brake off again.
 *
 * `stopCalls` pauses the plan without raising an escalation, and the only
 * resume path in the app went through `QueueActions`, which needs an escalation
 * id. So a plan a clinician stopped by hand was paused permanently — while the
 * button that stopped it justified having no confirmation step on the grounds
 * that stopping "is always reversible". This is the control that makes that
 * sentence true.
 *
 * `resumePlan` skips the backlog before it reactivates, so a plan stopped for
 * two days does not dial twice the moment this is pressed.
 */
export async function resumeStoppedPlanAction(
  patientId: string,
  planId: string,
): Promise<void> {
  await resumePlan(planId, readConfig().clinicianName);
  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  /* Follow-ups shows paused plans too, and offers this same control. */
  revalidatePath("/dashboard");
  revalidatePath(`/followups/${patientId}`);
}

export async function deletePatientAction(id: string): Promise<void> {
  await deletePatient(id);
  revalidatePath("/patients");
  redirect("/patients");
}
