"use server";

/**
 * Plan actions: save a visit's note and start its follow-up, add to a running
 * one, and take a plan back off the clinician's hands from the queue.
 *
 * Reading the note is the one place a model runs. Everything after it is code,
 * which is why "Save and start follow-up" can be described honestly as the
 * doctor's decision, executed deterministically.
 */

import { revalidatePath } from "next/cache";
import { readConfig } from "@/lib/config";
import { runTickOnPageLoad } from "@/lib/schedule/trigger";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { withLockedRules } from "@/lib/rules/catalog";

import { compileNote } from "@/lib/plan/compile";
import {
  amendNote,
  cancelPlan,
  createPlanFromNote,
  getPlanForReview,
  startPlan,
  updatePlanGoal,
} from "@/lib/db/plans";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import { getVisit, markVisitSeen, reopenVisit } from "@/lib/db/visits";
import {
  acknowledgeEscalation,
  closePlan,
  recordClosingSummary,
  resolveEscalation,
  resumePlan,
  setResolution,
} from "@/lib/schedule/store";
import type { CompileFormState } from "@/lib/patients/plan-form";

/**
 * The consultation: the doctor has written the note for a waiting visit and
 * pressed *Save and start follow-up*.
 *
 * Read the note, write the plan, take the visit off the consult list, start the
 * calendar — in that order. A note that cannot be read starts nothing: Care Loop
 * never invents a generic follow-up to paper over a missing model, and the note
 * stays in the form for the doctor.
 */
export async function consultAction(
  visitId: string,
  _prev: CompileFormState,
  formData: FormData,
): Promise<CompileFormState> {
  const noteBody = String(formData.get("note") ?? "").trim();
  /* Optional, and kept verbatim: triage matches calls against the doctor's own
     escalating conditions, so they are stored as written, not as parsed. */
  const escalationNote = String(formData.get("escalation") ?? "").trim();
  const values = { note: noteBody, escalation: escalationNote };

  if (noteBody.length < 20) {
    return {
      values,
      error: "Write the note first. There is nothing to follow up from a line or two.",
    };
  }

  const visit = await getVisit(visitId);
  if (!visit || visit.patientArchived) {
    return { values, error: "That visit no longer exists, or the patient has been archived." };
  }
  if (visit.status !== "waiting") {
    return {
      values,
      error: "This visit has already been written up. Open it from Consultations to see that note.",
    };
  }

  const fallbackReason = visit.kind === "post_op" ? "Post-operative follow-up" : "Follow-up";

  const outcome = await compileNote({
    noteBody,
    escalationNote: escalationNote || undefined,
    patientAge: visit.age,
    fallbackReason,
    visitKind: visit.kind,
  });

  if (!outcome.ok) {
    return {
      values,
      error:
        outcome.reason === "no_provider"
          ? "Care Loop could not read this note: no model is configured. Nothing was scheduled."
          : `${outcome.detail} Nothing was scheduled.`,
    };
  }

  /*
   * A note that yields nothing specific does not start a generic call. With no
   * topic kept and the goal code's own default, the calls would ask "how have
   * you been" about a consultation the doctor wrote something particular about —
   * so the doctor is asked to say what they want to know instead.
   */
  if (outcome.plan.watchPoints.length === 0 && outcome.plan.provenance.goal === "default") {
    return {
      values,
      error:
        "Care Loop could not find anything specific to follow up in this note, so nothing was scheduled. " +
        "Say what you want to know — for example, whether the wound is dry or the pain is settling.",
    };
  }

  const planId = await createPlanFromNote({
    patientId: visit.patientId,
    noteBody,
    escalationNote: escalationNote || null,
    plan: outcome.plan,
    droppedTopics: outcome.droppedTopics,
    compile: {
      status: "compiled",
      provider: outcome.provider,
      model: outcome.model,
      raw: outcome.raw,
      error: null,
    },
  });

  /*
   * Zero rows means another tab wrote this visit up first. The plan just made
   * would be a second follow-up for the same consultation, so it is cancelled.
   */
  const by = readConfig().clinicianName;
  const seen = await markVisitSeen(visitId, planId);
  if (!seen) {
    await cancelPlan(planId, by);
    return {
      values,
      error: "This visit was written up in another tab. Open it from Consultations to see that note.",
    };
  }

  const started = await startPlan(planId, by);
  if (!started.ok) {
    /* Put the visit back, so the doctor can press start again. */
    await cancelPlan(planId, by);
    await reopenVisit(visitId);
    return { values, error: started.reason ?? "The follow-up could not be started." };
  }

  /*
   * Dial anything this start just made due. Starting is one of the three honest
   * triggers, and the one the doctor is present for. It cannot break the start:
   * the tick is bounded, never waits for a call, and records its own failures.
   */
  await runTickOnPageLoad();

  revalidatePath("/consult");
  revalidatePath("/patients");
  revalidatePath("/dashboard");
  revalidatePath(`/followups/${visit.patientId}`);
  redirect(`/followups/${visit.patientId}?started=1`);
}

/**
 * Save what escalates: the doctor's own words, and the words to listen for.
 *
 * Both halves are optional because they are saved by different gestures — the
 * note has a Save button, a red-flag word is added or deleted on the spot — and
 * sending only what changed is what stops a chip click from overwriting a
 * half-typed sentence.
 *
 * Forward-only: finished calls are not re-evaluated.
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
     * The plan's list is the only list. No rule reads these words; they are the
     * doctor's own vocabulary, handed to the model as the reference standard.
     */
    const current = await db.execute(sql`select rules from follow_up_plans where id = ${planId}`);
    const rules = ((current.rows as Record<string, unknown>[])[0]?.rules ?? []) as PlanRule[];

    const plan = await db.execute(sql`
      update follow_up_plans
      set red_flag_terms = ${JSON.stringify(terms)}::jsonb,
          -- Re-asserted on every write: whatever the row held, the locked
          -- rules leave with it.
          rules = ${JSON.stringify(withLockedRules(rules))}::jsonb,
          updated_at = now()
      where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
      returning id
    `);
    ok = ok && plan.rows.length > 0;
  }

  revalidatePath("/followups", "layout");
  revalidatePath("/patients");
  revalidatePath("/dashboard");
  return { ok };
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

/**
 * Close the file on a follow-up whose window already ran out.
 *
 * Nothing is dialled or skipped — there is nothing left to. It records how the
 * episode resolved, which is what takes the patient off the doctor's
 * "Finished" band.
 */
export async function closeFinishedAction(
  planId: string,
  patientId: string,
  summary: string | null,
): Promise<void> {
  await recordClosingSummary(planId, readConfig().clinicianName, summary);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  revalidatePath("/dashboard");
}

/**
 * A clinician has read this escalation.
 *
 * Distinct from resolving it: `open` means nobody has looked, `acknowledged`
 * means somebody has and it is still theirs to act on, `resolved` means they
 * acted.
 */
export async function acknowledgeEscalationAction(escalationId: string): Promise<void> {
  await acknowledgeEscalation(escalationId);
  revalidatePath("/dashboard");
}

/**
 * Add to a running follow-up's note, and read the whole note again.
 *
 * The new goal replaces the old one; new things to find out are appended to the
 * running plan, never rewritten over the old ones — see `updatePlanGoal`.
 */
export async function amendNoteAction(
  planId: string,
  addition: string,
): Promise<{ ok: boolean; error?: string; added?: number }> {
  const text = addition.trim();
  if (text.length < 3) {
    return { ok: false, error: "Write the addition first. There is nothing to add." };
  }

  const amended = await amendNote(planId, text);
  if (!amended.ok) {
    return {
      ok: false,
      error:
        "This follow-up has finished, so its note cannot be changed. Start a new " +
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

  if (!outcome.ok) {
    revalidatePath("/followups", "layout");
    return {
      ok: false,
      error: `Your note was saved, but it could not be read again: ${outcome.detail}`,
    };
  }

  const updated = await updatePlanGoal(planId, outcome.plan);

  revalidatePath("/followups", "layout");
  revalidatePath("/patients");

  return { ok: updated.ok, added: updated.added };
}
