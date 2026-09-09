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
import { readConfig } from "@/lib/config";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { stepTarget } from "@/lib/plan/ordinals";
import { getDb } from "@/lib/db/client";
import { withLockedRules } from "@/lib/rules/catalog";

import { compileNote } from "@/lib/plan/compile";
import { applyDefaults } from "@/lib/plan/defaults";
import {
  addQuestion,
  amendNote,
  approvePlan,
  cancelPlan,
  createPlanFromNote,
  getPlanForReview,
  mergeCompiledPlan,
  mergeCompiledQuestions,
  refreezeResultSchema,
  deleteQuestion,
  getPlanQuestionOrder,
  moveQuestion,
  updatePlanDraft,
  updateQuestionPrompt,
} from "@/lib/db/plans";
import { validateQuestionDraft } from "@/lib/plan/clinician-question";
import type { QuestionEditResult } from "@/lib/plan/clinician-question";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import { getPatient } from "@/lib/db/patients";
import {
  acknowledgeEscalation,
  closePlan,
  resolveEscalation,
  resumePlan,
  setResolution,
} from "@/lib/schedule/store";
import { redFlagsFor } from "@/data/red-flags";
import type { CompileFormState } from "@/lib/patients/plan-form";

/*
 * The refusal, in the guard's own register. The findings travel with it, so the
 * doctor reads which words were refused and why rather than a summary of them.
 */
const GUARD_REFUSAL =
  "The clinical guard refused this wording, so it will not be asked. " +
  "It is kept below, with the reason. Rewrite it as a question that asks and tells nothing.";

export async function compileNoteAction(
  patientId: string,
  _prev: CompileFormState,
  formData: FormData,
): Promise<CompileFormState> {
  const noteBody = String(formData.get("note") ?? "").trim();
  const escalationNote = String(formData.get("escalationNote") ?? "").trim();
  const timeScale = Number(formData.get("timeScale") ?? 1);

  if (noteBody.length < 20) {
    return {
      values: { note: noteBody, escalationNote, timeScale: String(timeScale) },
      error: "Write the note first. There is nothing to compile from a line or two.",
    };
  }

  const patient = await getPatient(patientId);
  if (!patient || patient.archivedAt) {
    return {
      values: { note: noteBody, escalationNote, timeScale: String(timeScale) },
      error: "That patient no longer exists, or has been archived.",
    };
  }

  const outcome = await compileNote({
    noteBody,
    escalationNote,
    patientAge: patient.age,
    fallbackReason: "Follow-up",
  });

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
      escalationNote,
    });

    revalidatePath("/patients");
  revalidatePath("/dashboard");
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
    escalationNote,
  });

  revalidatePath("/patients");
  redirect(`/plans/${planId}`);
}

export async function updateDraftAction(planId: string, formData: FormData): Promise<void> {
  const durationDays = Number(formData.get("durationDays") ?? 7);
  const localTime = String(formData.get("localTime") ?? "10:00");
  const timeScale = Number(formData.get("timeScale") ?? 1);
  const cadence = String(formData.get("cadence") ?? "daily");
  const maxAttempts = Number(formData.get("maxAttempts") ?? 3);

  await updatePlanDraft(planId, {
    /* Every one of these printed a provenance mark — "You set this" — while
       having no control anywhere in the product. Either the mark was a lie or
       the field was missing; these are the fields. */
    cadence: (["daily", "every_other_day", "weekly"] as const).includes(
      cadence as "daily",
    )
      ? (cadence as "daily" | "every_other_day" | "weekly")
      : "daily",
    maxAttempts: Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5
      ? maxAttempts
      : 3,
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
 * Move a question one place in the order the agent will ask them.
 *
 * The UI thinks in up and down; the database thinks in "after this row".
 * `stepTarget` translates, so neither side has to know how ordinals work — and
 * a refusal here is a sentence the doctor can act on, because the alternative
 * is a silent no-op that looks like the button is broken.
 */
export async function moveQuestionAction(
  planId: string,
  questionId: string,
  direction: "up" | "down",
): Promise<{ ok: boolean; reason?: string }> {
  const rows = await getPlanQuestionOrder(planId);
  const step = stepTarget(rows, questionId, direction);
  if (!step.ok) {
    return step.reason === "edge"
      ? { ok: true }
      : { ok: false, reason: "The order changed while you were editing. Reload the plan." };
  }

  const result = await moveQuestion(planId, questionId, step.afterId);
  revalidatePath(`/plans/${planId}`);
  return result.moved ? { ok: true } : { ok: false, reason: result.reason };
}

/**
 * The doctor rewrites what the agent will say.
 *
 * The guard is not consulted here. It runs inside `updateQuestionPrompt`, on the
 * way to the row, so the refusal this returns is a report of what was already
 * written — never a decision this action could have skipped or overruled.
 */
export async function editQuestionAction(
  planId: string,
  questionId: string,
  prompt: string,
): Promise<QuestionEditResult> {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Write the question first. Care Loop will not ask an empty one." };
  }

  const result = await updateQuestionPrompt(planId, questionId, trimmed);
  revalidatePath(`/plans/${planId}`);

  if (!result.saved) {
    return {
      ok: false,
      error:
        "Nothing was saved. This plan is no longer awaiting approval, or that " +
        "question is one of the locked ones.",
    };
  }
  if (!result.guard.ok) return { ok: false, error: GUARD_REFUSAL, findings: result.guard.findings };
  return { ok: true };
}

export async function addQuestionAction(
  planId: string,
  formData: FormData,
): Promise<QuestionEditResult> {
  const validation = validateQuestionDraft({
    prompt: String(formData.get("prompt") ?? ""),
    answerType: String(formData.get("answerType") ?? ""),
    enumValues: String(formData.get("enumValues") ?? ""),
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const result = await addQuestion(planId, validation.draft);
  revalidatePath(`/plans/${planId}`);

  if (!result.saved) {
    return { ok: false, error: "Nothing was saved. This plan is no longer awaiting approval." };
  }
  if (!result.guard.ok) return { ok: false, error: GUARD_REFUSAL, findings: result.guard.findings };
  return { ok: true };
}

/**
 * Save what escalates: the doctor's own words, and the words to listen for.
 *
 * Both halves are optional because they are saved by different gestures — the
 * note has a Save button, a red-flag word is added or deleted on the spot — and
 * sending only what changed is what stops a chip click from overwriting a
 * half-typed sentence.
 *
 * Allowed on a running plan as well as a draft, the same window
 * `updatePlanRules` uses: day three is when a doctor discovers the wrong word
 * was on the list. Forward-only either way; finished calls are not re-evaluated.
 *
 * Two tables, and the Neon HTTP driver has no transactions — so these are two
 * independent statements rather than one atomic write. That is safe because
 * neither is a delta: each sets a whole value the client already holds, so a
 * half-applied save leaves both columns individually valid and the next save
 * converges. Nothing derived is written from either.
 */
export async function updateEscalationAction(
  planId: string,
  input: { escalationNote?: string; terms?: RedFlagTerm[] },
): Promise<{ ok: boolean }> {
  const db = getDb();
  let ok = true;

  if (input.escalationNote !== undefined) {
    const note = await db.execute(sql`
      update consultation_notes
      set escalation_note = ${input.escalationNote.trim() || null}
      where id = (
        select note_id from follow_up_plans
        where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
      )
      returning id
    `);
    ok = note.rows.length > 0;
  }

  if (input.terms !== undefined) {
    /*
     * Matching is case-insensitive, so a case variant is the same word twice.
     *
     * The source is narrowed rather than trusted: the panel groups terms under
     * the three known provenances, so a word arriving with any other would be
     * live on the plan and invisible on the screen.
     */
    const seen = new Set<string>();
    const terms: RedFlagTerm[] = [];
    for (const t of input.terms) {
      const term = t.term.trim().toLowerCase();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      terms.push({
        term,
        source: t.source === "note" || t.source === "default" ? t.source : "clinician",
      });
    }

    /*
     * The plan's list is the only list.
     *
     * No rule reads these words any more. They are the doctor's own vocabulary,
     * handed to the model as the reference standard for what to escalate on —
     * which is strictly better than the substring matcher that used to consume
     * them, because that matched inside a negation and could not say why.
     */
    const current = await db.execute(sql`select rules from follow_up_plans where id = ${planId}`);
    const rules = ((current.rows as Record<string, unknown>[])[0]?.rules ?? []) as PlanRule[];

    const plan = await db.execute(sql`
      update follow_up_plans
      set red_flag_terms = ${JSON.stringify(terms)}::jsonb,
          -- Re-asserted on every write, exactly as updatePlanRules does it:
          -- whatever the row held, the locked three leave with it.
          rules = ${JSON.stringify(withLockedRules(rules))}::jsonb,
          updated_at = now()
      where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
      returning id
    `);
    ok = ok && plan.rows.length > 0;
  }

  revalidatePath(`/plans/${planId}`);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
  return { ok };
}

export async function approvePlanAction(
  planId: string,
  /** Where to land on success — the patient's own file, where the calendar is. */
  patientId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const result = await approvePlan(planId, readConfig().clinicianName);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
  revalidatePath(`/plans/${planId}`);

  // A refusal is returned to the button, not swallowed by a redirect that would
  // look exactly like success.
  if (!result.ok) return { ok: false, reason: result.reason };

  /*
   * Success lands somewhere, and somewhere specific.
   *
   * Approving used to return quietly: the panel unmounted, the headline
   * mutated, and the page shrank by several hundred pixels under a doctor
   * sitting at the very bottom of it. The single most consequential act in the
   * product was acknowledged by an absence — and the dated rows it had just
   * created, which are the whole argument for the product, were never shown.
   *
   * `redirect` throws, so nothing after this runs.
   */
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?approved=1`);
}

/** Stop a plan for good. Pending calls are skipped; the history stays. */
export async function cancelPlanAction(planId: string, patientId: string): Promise<void> {
  await cancelPlan(planId, readConfig().clinicianName);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

/**
 * The clinician has dealt with it.
 *
 * One action, whatever state the plan is in — because "I have handled this" is
 * one decision and the plan's status is a detail of it. If this escalation
 * paused the plan, resolving it restarts the follow-up, skipping the calls
 * missed while it was stopped; if the plan was running all along, nothing
 * happens to it and the resolution records exactly that.
 *
 * It used to call `resumePlan` either way, so a queue entry on a running plan
 * recorded `resumed` for something nobody had paused.
 */
export async function resolveEscalationAction(
  escalationId: string,
  planId: string,
  note: string | null,
): Promise<void> {
  const resolved = await resolveEscalation(escalationId, null, readConfig().clinicianName, note);
  if (resolved) {
    const resumed = resolved.pausedPlan ? await resumePlan(planId, readConfig().clinicianName) : false;
    await setResolution(escalationId, resumed ? "resumed" : "no_action");
  }
  revalidatePath("/patients");
  revalidatePath("/dashboard");
}

/** The follow-up is over. Destructive, so the UI arms before it fires. */
export async function closePlanAction(
  escalationId: string,
  planId: string,
  note: string | null,
): Promise<void> {
  await resolveEscalation(escalationId, "closed", readConfig().clinicianName, note);
  /* Ending a follow-up from the queue is still ending it, and what the
     clinician wrote there is the same fact the patient's record needs. */
  await closePlan(planId, "clinician_closed", readConfig().clinicianName, note);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
}

/**
 * A clinician has read this escalation.
 *
 * Distinct from resolving it, and that distinction is the human-in-the-loop
 * step the queue never had: `open` means nobody has looked, `acknowledged`
 * means somebody has and it is still theirs to act on, `resolved` means they
 * acted. Without the middle state, a queue of five looks identical whether one
 * has been read or none have.
 */
/**
 * The treatment is finished.
 *
 * Distinct from the window elapsing and from cancelling. `completed` on its own
 * conflates three different things — the calendar ran out, a clinician ended
 * it, nobody was ever reached — and only the middle one is a clinical decision.
 * This is that decision, said out loud, and it stops the remaining calls.
 */
export async function finishTreatmentAction(
  planId: string,
  patientId: string,
  /** How it resolved, in the clinician's words. Kept on the patient's record. */
  summary: string | null,
): Promise<void> {
  const text = summary?.trim();
  await closePlan(planId, "clinician_closed", readConfig().clinicianName, text || null);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
}

export async function acknowledgeEscalationAction(escalationId: string): Promise<void> {
  await acknowledgeEscalation(escalationId);
  revalidatePath("/dashboard");
}

export async function amendNoteAction(
  planId: string,
  addition: string,
): Promise<{ ok: boolean; error?: string; added?: number; rewritten?: number }> {
  const text = addition.trim();
  if (text.length < 3) {
    return { ok: false, error: "Write the addition first. There is nothing to add." };
  }

  const amended = await amendNote(planId, text);
  if (!amended.ok) {
    return {
      ok: false,
      error:
        "This plan has finished, so its note cannot be changed. Start a new " +
        "follow-up for this patient instead.",
    };
  }

  const plan = await getPlanForReview(planId);
  const outcome = await compileNote({
    noteBody: amended.body,
    escalationNote: amended.escalationNote ?? undefined,
    patientAge: plan?.patientAge ?? undefined,
    fallbackReason: plan?.reason ?? "Follow-up",
  });

  revalidatePath(`/plans/${planId}`);

  if (!outcome.ok) {
    return {
      ok: false,
      error: `Your note was saved, but it could not be re-read: ${outcome.detail}`,
    };
  }

  const merged = await mergeCompiledQuestions(planId, outcome.plan.questions);
  /* Plan-level values are the draft's to change. A running plan keeps the
     cadence and the local time it was approved with — a doctor adding a new
     symptom is not asking to move tomorrow's call. */
  if (plan?.status === "awaiting_approval") await mergeCompiledPlan(planId, outcome.plan);

  /*
   * Re-freeze the schema, or the new questions are asked and their answers
   * thrown away: `buildResultSchema` output is frozen onto the plan at approval
   * and `loadContext` sends that frozen copy to CALL-E. Adding a key is
   * additive and safe — calls already placed were extracted against the older
   * schema and their slots are already written.
   */
  if (merged.added > 0) await refreezeResultSchema(planId);

  revalidatePath(`/plans/${planId}`);
  revalidatePath("/patients");

  return { ok: true, ...merged };
}
