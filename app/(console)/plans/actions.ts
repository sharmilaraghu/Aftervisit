"use server";

/**
 * Plan actions: compile a note, edit the draft, approve it, and take a plan
 * back off the clinician's hands from the queue.
 *
 * Compiling is the one place a model runs. Everything after it is code, which
 * is why the approve path can be described honestly as "the doctor's decision,
 * executed deterministically".
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { compileNote } from "@/lib/plan/compile";
import { applyDefaults } from "@/lib/plan/defaults";
import {
  approvePlan,
  cancelPlan,
  createPlanFromNote,
  deleteQuestion,
  updatePlanDraft,
  updatePlanRules,
} from "@/lib/db/plans";
import type { PlanRule } from "@/lib/rules/types";
import { getPatient } from "@/lib/db/patients";
import { resolveEscalation, resumePlan, closePlan } from "@/lib/schedule/store";
import { redFlagsFor } from "@/data/red-flags";
import type { CompileFormState } from "@/lib/patients/plan-form";

export async function compileNoteAction(
  patientId: string,
  _prev: CompileFormState,
  formData: FormData,
): Promise<CompileFormState> {
  const noteBody = String(formData.get("note") ?? "").trim();
  const timeScale = Number(formData.get("timeScale") ?? 1);

  if (noteBody.length < 20) {
    return {
      values: { note: noteBody, timeScale: String(timeScale) },
      error: "Write the note first. There is nothing to compile from a line or two.",
    };
  }

  const patient = await getPatient(patientId);
  if (!patient || patient.archivedAt) {
    return {
      values: { note: noteBody, timeScale: String(timeScale) },
      error: "That patient no longer exists, or has been archived.",
    };
  }

  const outcome = await compileNote({ noteBody, fallbackReason: "Follow-up" });

  /*
   * A refusal is a real outcome, not an error to swallow. The note is still
   * written, marked `refused`, and the doctor gets a blank, hand-editable plan —
   * Care Loop never invents a generic follow-up to paper over a missing key.
   */
  if (!outcome.ok) {
    const blank = applyDefaults(
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
      patientId,
      noteBody,
      plan: blank,
      compile: {
        status: "refused",
        provider: null,
        model: null,
        raw: null,
        error: outcome.detail,
      },
      timeScale,
    });

    revalidatePath("/patients");
    redirect(`/plans/${planId}`);
  }

  const planId = await createPlanFromNote({
    patientId,
    noteBody,
    plan: outcome.plan,
    compile: {
      status: "compiled",
      provider: outcome.provider,
      model: outcome.model,
      raw: outcome.raw,
      error: null,
    },
    rejectedQuestions: outcome.rejectedQuestions,
    timeScale,
  });

  revalidatePath("/patients");
  redirect(`/plans/${planId}`);
}

export async function updateDraftAction(planId: string, formData: FormData): Promise<void> {
  const durationDays = Number(formData.get("durationDays") ?? 7);
  const localTime = String(formData.get("localTime") ?? "10:00");
  const timeScale = Number(formData.get("timeScale") ?? 1);

  await updatePlanDraft(planId, {
    durationDays: Number.isInteger(durationDays) && durationDays > 0 ? durationDays : 7,
    localTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(localTime) ? localTime : "10:00",
    timeScale: timeScale > 0 ? timeScale : 1,
  });

  revalidatePath(`/plans/${planId}`);
}

export async function deleteQuestionAction(planId: string, questionId: string): Promise<void> {
  await deleteQuestion(planId, questionId);
  revalidatePath(`/plans/${planId}`);
}

/**
 * Persist an edited rule set.
 *
 * The whole list is sent rather than a diff. `lib/rules/edit.ts` produced it
 * from the list the page was rendered with, and `withLockedRules` is re-asserted
 * on write — so a stale tab cannot drop a locked rule, whatever it sends.
 */
export async function updateRulesAction(
  planId: string,
  rules: PlanRule[],
): Promise<{ ok: boolean }> {
  const ok = await updatePlanRules(planId, rules);
  revalidatePath(`/plans/${planId}`);
  revalidatePath("/patients");
  return { ok };
}

export async function approvePlanAction(
  planId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const result = await approvePlan(planId, "Dr Rao");
  revalidatePath("/patients");
  revalidatePath(`/plans/${planId}`);
  // A refusal is returned to the button, not swallowed by a redirect that would
  // look exactly like success.
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Stop a plan for good. Pending calls are skipped; the history stays. */
export async function cancelPlanAction(planId: string, patientId: string): Promise<void> {
  await cancelPlan(planId, "Dr Rao");
  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

export async function resumePlanAction(escalationId: string, planId: string): Promise<void> {
  await resolveEscalation(escalationId, "resumed", "Dr Rao");
  await resumePlan(planId, "Dr Rao");
  revalidatePath("/queue");
  revalidatePath("/patients");
}

export async function closePlanAction(escalationId: string, planId: string): Promise<void> {
  await resolveEscalation(escalationId, "closed", "Dr Rao");
  await closePlan(planId, "clinician_closed", "Dr Rao");
  revalidatePath("/queue");
  revalidatePath("/patients");
}
