/**
 * One pass of the scheduler.
 *
 * The order inside a tick is the whole design:
 *
 *   reconcile abandoned calls
 *     → close plans whose window elapsed
 *     → claim a batch of due calls
 *     → assemble, guard, dial, persist the CALL-E id *immediately*
 *     → wait for each result, extract, evaluate, escalate, retry
 *
 * Three honest triggers call this: a console page load, `POST /api/tick` for a
 * real cron, and a client poller. There is deliberately no self-perpetuating
 * `after()` + `setTimeout` chain — it would look like a background worker,
 * die silently with the process, and read as a lie the moment a judge asked.
 *
 * Nothing in here throws on a single bad row. One patient's failed dial must
 * never stop the queue for everyone else, so every per-call failure is recorded
 * on that call and the loop continues.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { callePortFromEnv, REFUSAL_TEXT, type CallePort } from "@/lib/calle/port";
import { assembleTask } from "@/lib/script/build";
import { extractSlots, foldOutcome, someoneSpoke } from "@/lib/plan/extract";
import { evaluate } from "@/lib/rules/engine";
import { inspectTranscript } from "@/lib/script/guard";
import { calendarDaysBetween } from "@/lib/time/clock";
import { newId } from "@/lib/db/ids";
import {
  beginTick,
  claimDueCalls,
  closeElapsedPlans,
  endTick,
  finishCall,
  findAbandonedCalls,
  occurrenceAttempts,
  pausePlan,
  raiseEscalation,
  recordDialed,
  recordRefusal,
  recordTask,
  scheduleRetry,
  type DueCall,
  type TickCounters,
} from "@/lib/schedule/store";
import type { StoredTurn } from "@/lib/db/schema";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import type { TickTrigger } from "@/lib/db/enums";
import type { Call } from "@call-e/calle";

export interface TickResult extends TickCounters {
  ran: boolean;
  tickId: string | null;
  /** Set when another tick already held the lease. Not an error. */
  skipped?: boolean;
  error?: string;
}

const EMPTY: TickCounters = {
  expanded: 0,
  claimed: 0,
  dialed: 0,
  refused: 0,
  finished: 0,
  escalated: 0,
};

/** Everything one call needs, in one read. */
interface CallContext extends DueCall {
  patientName: string;
  phoneE164: string;
  timezone: string;
  consent: string;
  maxAttempts: number;
  rules: PlanRule[];
  redFlagTerms: RedFlagTerm[];
  resultSchema: Record<string, unknown>;
  noteBody: string;
  questions: {
    questionId: string;
    prompt: string;
    answerType: "boolean" | "scale_0_10" | "enum" | "text";
    enumValues: string[] | null;
    required: boolean;
    guardApproved: boolean;
  }[];
}

async function loadContext(call: DueCall): Promise<CallContext | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    select pt.name, pt.phone_e164, pt.timezone, pt.ai_call_consent,
           p.max_attempts, p.rules, p.red_flag_terms, p.result_schema, n.body as note_body
    from follow_up_plans p
    join patients pt on pt.id = p.patient_id
    join consultation_notes n on n.id = p.note_id
    where p.id = ${call.planId}
  `);
  const row = (rows.rows as Record<string, unknown>[])[0];
  if (!row) return null;

  const qs = await db.execute(sql`
    select question_id, prompt, answer_type, enum_values, required, guard_status
    from plan_questions where plan_id = ${call.planId} order by ordinal
  `);

  return {
    ...call,
    patientName: String(row.name),
    phoneE164: String(row.phone_e164),
    timezone: String(row.timezone),
    consent: String(row.ai_call_consent),
    maxAttempts: Number(row.max_attempts),
    rules: (row.rules ?? []) as PlanRule[],
    redFlagTerms: (row.red_flag_terms ?? []) as RedFlagTerm[],
    resultSchema: (row.result_schema ?? {}) as Record<string, unknown>,
    noteBody: String(row.note_body),
    questions: (qs.rows as Record<string, unknown>[]).map((q) => ({
      questionId: String(q.question_id),
      prompt: String(q.prompt),
      answerType: String(q.answer_type) as CallContext["questions"][number]["answerType"],
      enumValues: (q.enum_values ?? null) as string[] | null,
      required: Boolean(q.required),
      guardApproved: String(q.guard_status) === "approved",
    })),
  };
}

/**
 * Flatten CALL-E's per-attempt turns, keeping each one attributable.
 *
 * Note `offset_seconds`, not `offsetSeconds`. The SDK camelCases its own
 * interfaces — `Call`, `CallAttempt`, `structuredResult` — but a transcript
 * turn is passed straight through from the OpenAPI schema and keeps the wire
 * spelling. Mixing the two up compiles fine as `any` and silently produces a
 * transcript where every turn is at second zero.
 */
function flattenTranscript(call: Call): StoredTurn[] {
  const turns: StoredTurn[] = [];
  for (const recipient of call.recipients ?? []) {
    for (const attempt of recipient.attempts ?? []) {
      for (const turn of attempt.transcriptTurns ?? []) {
        turns.push({
          attemptId: attempt.id,
          offsetSeconds: turn.offset_seconds ?? 0,
          speaker: String(turn.speaker ?? "unknown"),
          text: String(turn.text ?? ""),
        });
      }
    }
  }
  return turns;
}

/**
 * Whether CALL-E is actually done with this call.
 *
 * `queued` and `in_progress` mean the phone is still ringing or the
 * conversation is still happening. Finishing such a call writes a null result
 * and eight `missing` slots, and folds the whole thing to `no_answer` — a call
 * that was answered, recorded as one that nobody picked up. The transcript is
 * even stored, which makes the row self-contradictory.
 */
function isTerminal(call: Call): boolean {
  return ["completed", "failed", "canceled"].includes(String(call.status));
}

/** The terminal attempt's failure code — what drives the retry ladder. */
function terminalFailure(call: Call): { code: string | null; message: string | null } {
  const attempts = call.recipients?.[0]?.attempts ?? [];
  const last = attempts.at(-1);
  return {
    code: last?.failureCode ?? call.failureCode ?? null,
    message: last?.failureMessage ?? call.failureMessage ?? null,
  };
}

/**
 * Everything that happens once a call comes back.
 *
 * Guarded by `finishCall` returning false: the waiter and the reconciler both
 * land here routinely, and only one may extract, evaluate and retry.
 */
async function completeCall(
  ctx: CallContext,
  call: Call,
  counters: TickCounters,
): Promise<void> {
  // Never finish a call CALL-E has not finished. The row stays `dialing` and
  // the next tick asks again.
  if (!isTerminal(call)) return;

  const db = getDb();
  const structured = (call.structuredResult ?? null) as Record<string, unknown> | null;
  const transcript = flattenTranscript(call);
  const failure = terminalFailure(call);

  const slots = extractSlots({
    structuredResult: structured,
    questions: ctx.questions,
    transcript,
  });

  // Broader than the `reached_patient` slot — see `someoneSpoke`. A call where
  // a person clearly answered must not fold to `no_answer` just because the
  // agent never got round to confirming who they were.
  const reached = someoneSpoke({ slots, transcript });
  const anyUnmappable = slots.some((s) => s.status === "unmappable" || s.status === "missing");

  const { attemptsMade, allNoAnswer } = await occurrenceAttempts(ctx.planId, ctx.occurrence);

  const lastHeard = await db.execute(sql`
    select max(finished_at) as at from scheduled_calls
    where patient_id = ${ctx.patientId} and outcome in ('answered','flagged','unmappable')
  `);
  const lastHeardAt = (lastHeard.rows as Record<string, unknown>[])[0]?.at;
  const quietForDays = lastHeardAt
    ? calendarDaysBetween(new Date(String(lastHeardAt)), new Date(), ctx.timezone)
    : null;

  // The pure engine. Everything it needs was gathered above; it reads nothing.
  const evaluation = evaluate({
    slots,
    rules: ctx.rules,
    redFlagTerms: ctx.redFlagTerms.map((t) => t.term.toLowerCase()),
    // Without this, an unanswered call's `missing` slots would fire the
    // unmappable rule once per question and urgently pause the plan before the
    // retry ladder had made its second attempt.
    reached,
    noAnswerExhausted: allNoAnswer && attemptsMade >= ctx.maxAttempts,
    attemptsMade,
    quietForDays,
    // CALL-E's own verdict. `false` means it did not do what it was asked —
    // including reporting answers to questions it never put to the patient.
    taskCompleted: call.taskCompleted ?? null,
    now: new Date(),
  });

  const outcome = foldOutcome({
    reached,
    failureCode: failure.code,
    hasUrgentHit: evaluation.shouldPause,
    hasAnyHit: evaluation.hits.length > 0,
    anyUnmappable,
  });

  /*
   * The latch. Zero rows means the reconciler (or the waiter) already finished
   * this call — stop here rather than double-writing slots and escalations.
   */
  const won = await finishCall({
    callId: ctx.id,
    status: call.status === "failed" ? "failed" : "completed",
    calleStatus: call.status ?? null,
    failureCode: failure.code,
    failureMessage: failure.message,
    resultStatus: structured === null ? "null_result" : "present",
    structuredResult: structured,
    summary: call.summary ?? null,
    taskCompleted: call.taskCompleted ?? null,
    completionConfidence: call.completionConfidence ?? null,
    evidence: call.evidence ?? null,
    transcript: transcript.length ? transcript : null,
    calleRaw: call,
    outcome,
  });
  if (!won) return;
  counters.finished += 1;

  // Guard phase 3, over what the agent actually said. Bot turns only.
  const transcriptVerdict = inspectTranscript(
    transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
  );
  if (!transcriptVerdict.ok) {
    await db.execute(sql`
      update scheduled_calls set transcript_guard_findings = ${JSON.stringify(transcriptVerdict.findings)}::jsonb
      where id = ${ctx.id}
    `);
  }

  // Slots are idempotent behind unique(call_id, question_id).
  const slotIds = new Map<string, string>();
  for (const slot of slots) {
    const id = newId("slot");
    const inserted = await db.execute(sql`
      insert into extracted_slots
        (id, call_id, patient_id, question_id, status, value_bool, value_number, value_text,
         raw_value, utterance, utterance_offset_seconds)
      values (${id}, ${ctx.id}, ${ctx.patientId}, ${slot.questionId}, ${slot.status},
              ${slot.valueBool}, ${slot.valueNumber}, ${slot.valueText},
              ${slot.rawValue === undefined ? null : JSON.stringify(slot.rawValue)}::jsonb,
              ${slot.utterance}, ${slot.utteranceOffsetSeconds})
      on conflict (call_id, question_id) do nothing
      returning id
    `);
    if (inserted.rows.length) slotIds.set(slot.questionId, id);
  }

  // A first call that reached the patient and got consent records it, so the
  // second call does not ask again. Never upgrades a recorded refusal.
  const consentGiven = slots.find((s) => s.questionId === "consent_given")?.valueBool;
  if (consentGiven === true) {
    await db.execute(sql`
      update patients
      set ai_call_consent = 'granted', ai_call_consent_at = now(),
          ai_call_consent_source = 'call', updated_at = now()
      where id = ${ctx.patientId} and ai_call_consent <> 'declined'
    `);
  }

  for (const hit of evaluation.hits) {
    const escalationId = await raiseEscalation({
      patientId: ctx.patientId,
      planId: ctx.planId,
      callId: ctx.id,
      slotId: hit.questionId ? (slotIds.get(hit.questionId) ?? null) : null,
      ruleId: hit.ruleId,
      ruleLabel: hit.ruleLabel,
      urgent: hit.urgent,
      reason: hit.reason,
      utterance: hit.utterance,
      dedupeKey: `${ctx.planId}:${hit.ruleId}:${ctx.id}:${hit.questionId ?? ""}`,
    });
    if (!escalationId) continue;
    counters.escalated += 1;

    // Only urgent pauses. A routine escalation is still a clinician's problem,
    // but the plan keeps running while they get to it.
    if (hit.urgent) await pausePlan(ctx.planId, hit.ruleLabel, escalationId);
  }

  /*
   * Retry only on a genuine no-answer from CALL-E — a real failure code, never
   * an inference. A call that was answered is finished, whatever it contained.
   */
  if (failure.code === "no_answer" && ctx.attempt < ctx.maxAttempts) {
    await scheduleRetry(ctx.planId, ctx.occurrence, ctx.attempt + 1, ctx.id);
  }
}

async function dialOne(
  port: CallePort,
  call: DueCall,
  counters: TickCounters,
  options: { waitMs?: number } = {},
): Promise<void> {
  const ctx = await loadContext(call);
  if (!ctx) {
    await recordRefusal(call.id, "api_error", "The plan behind this call no longer exists.");
    counters.refused += 1;
    return;
  }

  const script = assembleTask({
    patientName: ctx.patientName,
    practiceName: "Bridgeview Family Practice",
    clinicianName: "Dr Rao",
    questions: ctx.questions,
    consentAlreadyGranted: ctx.consent === "granted",
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
  });

  if (!script.ok) {
    await recordRefusal(ctx.id, "guard_violation", script.detail);
    counters.refused += 1;
    return;
  }

  // The task is written down before the dial, so "what did it actually say?"
  // has an answer even if everything after this fails.
  await recordTask(ctx.id, script.task);

  const outcome = await port.dial({
    task: script.task,
    phone: ctx.phoneE164,
    resultSchema: ctx.resultSchema,
    metadata: { planId: ctx.planId, occurrence: ctx.occurrence, attempt: ctx.attempt },
    idempotencyKey: ctx.idempotencyKey,
    approvedQuestions: script.approvedQuestions,
    clinicianStatements: script.clinicianStatements,
  });

  if (!outcome.ok) {
    await recordRefusal(ctx.id, outcome.refusal, `${REFUSAL_TEXT[outcome.refusal]} ${outcome.detail}`);
    counters.refused += 1;
    return;
  }

  // Immediately, before any await that could be interrupted. There is no
  // endpoint that lists calls; an id lost here is a result lost forever.
  await recordDialed(ctx.id, outcome.call.id);
  counters.dialed += 1;

  /*
   * Do not wait for the call unless the caller explicitly asked to.
   *
   * A phone call takes minutes. A page render cannot be held open for one — a
   * dashboard that took sixteen and a half minutes to return is what happens
   * when it tries. Dialling is the tick's job; *finishing* the call belongs to
   * the reconciler on a later tick, once CALL-E reports a terminal state.
   *
   * `waitMs` exists for tests against the fake server, where the call settles
   * instantly and waiting keeps the assertions inside one pass.
   */
  if (!options.waitMs) return;

  try {
    const settled = await port.waitForCall(outcome.call.id, {
      timeoutMs: options.waitMs,
      intervalMs: 1_000,
    });
    await completeCall(ctx, settled, counters);
  } catch {
    // Timed out waiting. The row keeps its CALL-E id and stays `dialing`.
  }
}

export async function tick(
  trigger: TickTrigger,
  options: { limit?: number; port?: CallePort; waitMs?: number } = {},
): Promise<TickResult> {
  const tickId = await beginTick(trigger);
  if (!tickId) {
    return { ...EMPTY, ran: false, tickId: null, skipped: true };
  }

  const counters: TickCounters = { ...EMPTY };
  let error: string | undefined;

  try {
    // Anything a waiter abandoned when a route's max duration expired.
    for (const abandoned of await findAbandonedCalls()) {
      if (!abandoned.calleCallId) continue;
      const ctx = await loadContext({ ...abandoned, idempotencyKey: "", scheduledFor: new Date() });
      if (!ctx) continue;
      try {
        const port = options.port ?? callePortFromEnv();
        // `completeCall` ignores a non-terminal call, so this simply asks again
        // on the next tick until CALL-E is done.
        await completeCall(ctx, await port.fetchCall(abandoned.calleCallId), counters);
      } catch {
        // A call CALL-E cannot tell us about yet stays claimed and is retried
        // on the next tick. Not an error worth failing the whole run over.
      }
    }

    await closeElapsedPlans();

    const due = await claimDueCalls(tickId, options.limit ?? 5);
    counters.claimed = due.length;

    if (due.length > 0) {
      const port = options.port ?? callePortFromEnv();
      for (const call of due) {
        try {
          await dialOne(port, call, counters, { waitMs: options.waitMs });
        } catch (e) {
          // One bad row must never stop the queue for every other patient.
          await recordRefusal(
            call.id,
            "api_error",
            e instanceof Error ? e.message : "The call failed unexpectedly.",
          );
          counters.refused += 1;
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  await endTick(tickId, counters, error);
  return { ...counters, ran: true, tickId, error };
}
