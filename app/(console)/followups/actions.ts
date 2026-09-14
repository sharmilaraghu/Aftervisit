"use server";

/**
 * The calling schedule, from the doctor's side: move a call, skip one, place
 * one now, and watch it until it ends.
 *
 * Every write underneath is the store's conditional UPDATE or idempotent
 * INSERT, so a stale page or a double press changes nothing it should not —
 * and zero rows is answered with a sentence the doctor can act on.
 */

import { revalidatePath } from "next/cache";

import { callePortFromEnv } from "@/lib/calle/port";
import { readConfig } from "@/lib/config";
import { getPatient } from "@/lib/db/patients";
import {
  addTryCall,
  getCallState,
  rescheduleCall,
  skipCall,
  type TickCounters,
} from "@/lib/schedule/store";
import { completeCall, dialNow, loadContext } from "@/lib/schedule/tick";
import { zonedTimeToUtc } from "@/lib/time/clock";

function refresh(patientId: string) {
  revalidatePath(`/followups/${patientId}`);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/dashboard");
}

/**
 * "Try a call": one extra call to this patient, placed now.
 *
 * The planned calls are untouched — this rings on top of the calendar, it does
 * not spend a day of it. It takes exactly the path a scheduled call does: the
 * row is written before the dial, the claim is conditional, and consent, the
 * dial allowlist and the guard are all enforced inside the port. So the answer
 * is read back from the row rather than assumed, and a refusal is said out loud.
 */
export async function tryCallAction(
  planId: string,
  patientId: string,
): Promise<{ ok: boolean; message: string; callId?: string }> {
  if (!readConfig().liveCallsEnabled) {
    return { ok: false, message: "Calls are switched off on this instance, so nothing was placed." };
  }

  const added = await addTryCall(planId, patientId);
  if ("refused" in added) {
    return {
      ok: false,
      message:
        added.refused === "in_progress"
          ? "A call to this patient is already being placed. Wait for it to end, then try again."
          : added.refused === "planned_soon"
            ? "A planned call rings within the next 30 minutes, so nothing extra was placed."
            : "Nothing was placed: this follow-up is paused or has finished.",
    };
  }

  const run = await dialNow(added.callId);
  const state = await getCallState(added.callId);
  refresh(patientId);

  if (state?.status === "dialing") {
    return { ok: true, message: "Calling now.", callId: added.callId };
  }
  if (state?.status === "refused") {
    return { ok: false, message: state.refusalDetail ?? "The call was refused before it rang." };
  }
  /* Another run held the lease — often the first of a double press — and that
     run is the one placing this due call. */
  if (run.skipped) {
    return { ok: true, message: "The call is being placed.", callId: added.callId };
  }
  /* Still `scheduled` after our own run: CALL-E's line was busy, so it was deferred. */
  return {
    ok: true,
    message: "The line is busy, so the call is queued. It is placed the next time the scheduler runs.",
  };
}

export type CallWatch =
  | { done: false; status: string }
  | { done: true; status: string; outcome: string | null; recap: string | null; detail: string | null };

const NO_COUNTS: TickCounters = {
  retired: 0,
  claimed: 0,
  dialed: 0,
  refused: 0,
  deferred: 0,
  finished: 0,
  escalated: 0,
  expanded: 0,
};

/**
 * Where a call placed from this page has got to — and, once CALL-E is done
 * with it, finish it.
 *
 * The page watching a try asks every few seconds, the way OpenLine's Try a
 * call does, so the doctor hears the result where they pressed the button
 * rather than after the next scheduler run. It trusts nothing the page holds
 * but the call's id: the call is re-fetched through the authenticated API, and
 * finishing goes through `completeCall`, the same latch the webhook and the
 * reconciler use — so a poll racing either of them finishes the call once, and
 * triage, escalation and the no-retry rule for a try all run as they would
 * anywhere else.
 */
export async function watchCallAction(callId: string, patientId: string): Promise<CallWatch> {
  let row = await getCallState(callId);
  if (!row || row.patientId !== patientId) {
    return {
      done: true,
      status: "missing",
      outcome: null,
      recap: null,
      detail: "That call is no longer on this patient's record.",
    };
  }

  let live: string | null = null;
  if ((row.status === "claimed" || row.status === "dialing") && row.calleCallId) {
    const ctx = await loadContext({ ...row, idempotencyKey: "", scheduledFor: new Date() });
    if (ctx) {
      try {
        const call = await callePortFromEnv().fetchCall(row.calleCallId);
        live = String(call.status);
        await completeCall(ctx, call, { ...NO_COUNTS });
      } catch {
        /* CALL-E could not describe it just now. The next poll asks again. */
      }
      row = (await getCallState(callId)) ?? row;
    }
  }

  if (row.status === "scheduled" || row.status === "claimed" || row.status === "dialing") {
    return { done: false, status: live ?? row.status };
  }

  refresh(patientId);
  return {
    done: true,
    status: row.status,
    outcome: row.outcome,
    recap: row.recap,
    detail: row.refusalDetail,
  };
}

/**
 * Move one upcoming call to a new date and time, in the patient's own zone.
 *
 * The form sends wall-clock parts rather than an instant: "Thursday 17:30" has
 * to mean 17:30 where the patient lives, whatever zone the doctor's browser is in.
 */
export async function rescheduleCallAction(
  callId: string,
  patientId: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return { ok: false, error: "Pick a date and a time." };
  }

  const patient = await getPatient(patientId);
  if (!patient) return { ok: false, error: "That patient no longer exists." };

  const at = zonedTimeToUtc(date, time, patient.timezone);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Pick a date and a time." };
  /* Five minutes ahead, as the store enforces: sooner is a live call without the confirm. */
  if (at.getTime() <= Date.now() + 5 * 60_000) {
    return {
      ok: false,
      error: "Pick a time at least five minutes from now. To call now, use Try a call.",
    };
  }

  const moved = await rescheduleCall(callId, patientId, at);
  refresh(patientId);
  return moved
    ? { ok: true }
    : { ok: false, error: "This call can no longer be moved: it has been placed or skipped, or the follow-up is paused." };
}

/** Drop one upcoming call from the schedule. The rest still ring. */
export async function skipCallAction(
  callId: string,
  patientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const skipped = await skipCall(callId, patientId);
  refresh(patientId);
  return skipped
    ? { ok: true }
    : { ok: false, error: "This call can no longer be skipped: it has been placed, or the follow-up is paused." };
}
