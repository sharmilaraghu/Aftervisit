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
import { resumePlan } from "@/lib/schedule/store";
import { REJECTION_TEXT, normalizePhone } from "@/lib/phone/normalize";
import { compileNote } from "@/lib/plan/compile";
import { applyDefaults } from "@/lib/plan/defaults";
import { cancelPlan, createPlanFromNote, getPlanForReview, updatePlanDraft } from "@/lib/db/plans";
import { redFlagsFor } from "@/data/red-flags";
import { isValidTimezone } from "@/lib/patients/timezones";
import { isValidLanguage } from "@/lib/patients/languages";
import type { ConsentState } from "@/lib/db/enums";
import type { PatientFormState } from "@/lib/patients/form";

const CONSENTS: ConsentState[] = ["unknown", "granted", "declined"];

function parse(formData: FormData): {
  state: PatientFormState;
  input: PatientInput | null;
} {
  const name = String(formData.get("name") ?? "").trim();
  const ageRaw = String(formData.get("age") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const language = String(formData.get("language") ?? "en-US").trim() || "en-US";
  /*
   * Consent is asked once, at enrolment, and never re-asked on a call. It is
   * now what authorises dialling — `lib/calle/port.ts` refuses a patient whose
   * consent is anything but `granted` — so the default here is `unknown`, not
   * `granted`. A checkbox nobody ticked must not read as a patient who agreed.
   */
  const consentRaw =
    formData.get("consent") === null
      ? "unknown"
      : String(formData.get("consent")).trim() || "unknown";
  const note = String(formData.get("note") ?? "").trim();
  /* The doctor's own list of what to escalate on. Optional: a plan with none is
     still a plan, and the locked rules still fire. */
  const escalationNote = String(formData.get("escalationNote") ?? "").trim();
  const timeScale = String(formData.get("timeScale") ?? "1");

  /*
   * The schedule step. Every one of these may be blank, and blank means "take
   * it from the note" — the compiler infers cadence, duration and time of day
   * from what the doctor wrote, and a control that silently overrode that
   * inference would make the review screen's "Defaulted" mark a lie.
   */
  const localTime = String(formData.get("localTime") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "").trim();
  const durationDays = String(formData.get("durationDays") ?? "").trim();

  const state: PatientFormState = {
    errors: {},
    values: {
      name,
      age: ageRaw,
      phone: phoneRaw,
      timezone,
      language,
      consent: consentRaw,
      note,
      escalationNote,
      timeScale,
      localTime,
      cadence,
      durationDays,
    },
  };

  if (localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    state.errors.localTime = "Use a 24-hour time, like 09:30.";
  }
  if (cadence && !["daily", "every_other_day", "weekly"].includes(cadence)) {
    state.errors.cadence = "Pick how often the agent should call.";
  }
  if (durationDays) {
    const n = Number(durationDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      state.errors.durationDays = "Between 1 and 90 days.";
    }
  }

  /*
   * The note is optional — pure admin entry is a real case — but a couple of
   * words is not a note. Better to refuse than to compile a plan out of nothing
   * and hand the doctor something they have to unpick.
   */
  if (note && note.length < 20) {
    state.errors.note =
      "Write a little more, or leave it blank. There is nothing to compile from a few words.";
  }

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

  if (Object.keys(state.errors).length > 0 || !phone.ok || !consent) {
    return { state, input: null };
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
  };
}

/**
 * Going back to steps 1 to 3 after the questions have been compiled.
 *
 * The patient's record and the schedule are updated in place — those are
 * facts about who is being called and when, and nothing downstream has read
 * them yet.
 *
 * The note is different. The questions on the draft were compiled *from* it,
 * and some of them the doctor has since edited by hand. Changing the note and
 * keeping those questions would produce a plan that claims to come from a note
 * it no longer matches, so a changed note cancels this draft and compiles a
 * fresh one. That is destructive and the step says so before it happens.
 */
export async function revisePlanAction(
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const planId = String(formData.get("planId") ?? "").trim();
  const plan = planId ? await getPlanForReview(planId) : null;
  if (!plan || plan.status !== "awaiting_approval") {
    return { ...parse(formData).state, errors: { form: "That draft is no longer open for editing." } };
  }

  const { state, input } = parse(formData);
  if (!state.values.note) {
    state.errors.note = "Write the note from the consultation. There is nothing to compile without it.";
  }
  if (!input || Object.keys(state.errors).length > 0) return state;

  try {
    await updatePatient(plan.patientId, input);
  } catch (error) {
    if (error instanceof DuplicatePhoneError) {
      return {
        ...state,
        errors: { ...state.errors, phone: "Another active patient already has this number." },
      };
    }
    throw error;
  }

  const noteChanged =
    state.values.note.trim() !== plan.noteBody.trim() ||
    state.values.escalationNote.trim() !== (plan.escalationNote ?? "").trim();

  if (!noteChanged) {
    await updatePlanDraft(planId, {
      localTime: state.values.localTime || undefined,
      cadence: (state.values.cadence || undefined) as
        | "daily"
        | "every_other_day"
        | "weekly"
        | undefined,
      durationDays: state.values.durationDays ? Number(state.values.durationDays) : undefined,
      timeScale: Number(state.values.timeScale) || undefined,
    });
    revalidatePath("/patients");
    redirect(`/plan/new?plan=${planId}&step=4`);
  }

  /* The note moved, so the questions it produced are no longer its. */
  await cancelPlan(planId, readConfig().clinicianName);
  return startPlanAction(_prev, formData);
}

/**
 * The wizard's one submit: steps 1 to 3, then compile.
 *
 * Three steps of a five-step flow land here together because they are one
 * `<form>` — there is no session to keep a half-written note in between two
 * routes, and every field stays mounted so a hidden step's value is still in
 * the submission. What the doctor has typed only becomes rows at this point,
 * which is also what makes going back from step 4 safe: from here on the draft
 * is the plan, and editing it is editing the thing itself.
 *
 * `patientId` set means the same person is back with a new problem. Their
 * record is corrected in place and a second plan is written against it; nothing
 * clinical is carried across from the last one.
 */
export async function startPlanAction(
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const existingId = String(formData.get("patientId") ?? "").trim();
  const { state, input } = parse(formData);

  /*
   * The wizard compiles a plan, so it needs something to compile. The old
   * add-patient form let the note be blank and saved a bare record; there is
   * no longer a screen that does that, and a wizard that silently produced no
   * plan would strand the doctor on step 4 with nothing on it.
   */
  if (!state.values.note) {
    state.errors.note = "Write the note from the consultation. There is nothing to compile without it.";
  }
  if (!input || Object.keys(state.errors).length > 0) return state;

  const note = state.values.note;
  const escalationNote = state.values.escalationNote;
  const timeScale = Number(state.values.timeScale) || 1;

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
            "Another active patient already has this number. Care Loop will not " +
            "create a second record on it — two plans would phone the same person twice.",
        },
      };
    }
    throw error;
  }

  {
    const outcome = await compileNote({
      noteBody: note,
      escalationNote,
      patientAge: input.age,
      fallbackReason: "Follow-up",
    });

    const resolved = outcome.ok
      ? outcome.plan
      : applyDefaults(
          {
            reason: null,
            condition: null,
            durationDays: null,
            cadence: null,
            localTime: null,
            questions: null,
            redFlagTerms: null,
            medications: null,
          },
          { fallbackReason: "Follow-up", baseRedFlags: redFlagsFor(null), baseRules: [] },
        );

    const planId = await createPlanFromNote({
      patientId: id,
      noteBody: note,
      plan: resolved,
      compile: outcome.ok
        ? {
            status: "compiled",
            provider: outcome.provider,
            model: outcome.model,
            raw: outcome.raw,
            error: null,
          }
        : { status: "refused", provider: null, model: null, raw: null, error: outcome.detail },
      rejectedQuestions: outcome.ok ? outcome.rejectedQuestions : undefined,
      timeScale,
      escalationNote,
    });

    /* Only what the doctor actually chose on step 3. A blank control leaves the
       note's own inference — and its "Defaulted" mark — untouched. */
    await updatePlanDraft(planId, {
      localTime: state.values.localTime || undefined,
      cadence: (state.values.cadence || undefined) as
        | "daily"
        | "every_other_day"
        | "weekly"
        | undefined,
      durationDays: state.values.durationDays ? Number(state.values.durationDays) : undefined,
    });

    revalidatePath("/patients");
    revalidatePath("/dashboard");
    // On to step 4, with the compiled questions to look at.
    redirect(`/plan/new?plan=${planId}`);
  }
}

export async function updatePatientAction(
  id: string,
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const { state, input } = parse(formData);
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
 * Correct a patient's details without leaving the approval screen.
 *
 * Same validation, same `updatePatient`, same duplicate-phone refusal as the
 * full edit page — the difference is only where it returns to. A doctor who
 * spots a wrong number, zone, language or consent state while reviewing a plan
 * was previously sent on a three-hop round trip to the patient page and back,
 * losing the review they were half-way through. The reason to look at these
 * fields is that something on *this* screen is wrong, so this is where they get
 * fixed.
 */
export async function correctPatientAction(
  patientId: string,
  planId: string,
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const { state, input } = parse(formData);
  if (!input) return state;

  let ok: boolean;
  try {
    ok = await updatePatient(patientId, input);
  } catch (error) {
    if (error instanceof DuplicatePhoneError) {
      return {
        ...state,
        errors: { ...state.errors, phone: "Another active patient already has this number." },
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
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/plans/${planId}`);
  return { ...state, saved: true };
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
}

export async function deletePatientAction(id: string): Promise<void> {
  await deletePatient(id);
  revalidatePath("/patients");
  redirect("/patients");
}

