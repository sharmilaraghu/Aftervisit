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
import { spokenLanguageName } from "@/lib/patients/languages";
import { extractFindings, extractSlots, foldOutcome, someoneSpoke } from "@/lib/plan/extract";
import { DEFAULT_GOAL, type WatchPoint } from "@/lib/plan/defaults";
import type { TopicSpec } from "@/lib/plan/result-schema";
import { evaluate, unresolvedCall } from "@/lib/rules/engine";
import { triageCall } from "@/lib/triage/triage";
import { saveTriage } from "@/lib/db/triage";
import { inspectTranscript } from "@/lib/script/guard";
import { calendarDaysBetween } from "@/lib/time/clock";
import { newId } from "@/lib/db/ids";
import { readConfig } from "@/lib/config";
import { isTransientRefusal } from "@/lib/calle/failure";
import {
  beginTick,
  claimDueCalls,
  closeElapsedPlans,
  deferCall,
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
  skipStaleCalls,
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
  retired: 0,
  expanded: 0,
  claimed: 0,
  dialed: 0,
  refused: 0,
  deferred: 0,
  finished: 0,
  escalated: 0,
};

/** Everything one call needs, in one read. */
interface CallContext extends DueCall {
  patientName: string;
  phoneE164: string;
  timezone: string;
  /** BCP 47; the per-recipient locale hint and the script's speak-language input. */
  language: string;
  consent: string;
  /** The doctor's own escalation wording, handed to the triage model verbatim. */
  escalationNote: string | null;
  /** Age only. The triage prompt never receives the patient's name. */
  patientAge: number | null;
  reason: string;
  maxAttempts: number;
  rules: PlanRule[];
  redFlagTerms: RedFlagTerm[];
  resultSchema: Record<string, unknown>;
  noteBody: string;
  /** What the calls set out to find out — the calling agent's goal. */
  goal: string;
  /** What to find out, in order. A call's findings are stored by this position. */
  topics: TopicSpec[];
  /** Set up before calls carried a goal: its frozen schema and questions do not fit a goal task. */
  legacy: boolean;
  questions: {
    questionId: string;
    prompt: string;
    answerType: "boolean" | "scale_0_10" | "enum" | "text";
    enumValues: string[] | null;
    required: boolean;
    guardApproved: boolean;
  }[];
}

/**
 * Where CALL-E should post when a call ends, or null when there is nowhere.
 *
 * Both halves are required: a public URL with no token would be an open
 * endpoint, and a token with no public URL has nothing to guard. Built per dial
 * rather than at module load so a deployment can set them without a restart.
 */
function webhookUrl(): string | null {
  const config = readConfig();
  if (!config.publicUrl || !config.webhookToken) return null;
  return `${config.publicUrl}/api/calle/webhook?t=${encodeURIComponent(config.webhookToken)}`;
}

/**
 * Everything one call needs, loaded from its plan.
 *
 * Exported for the webhook receiver, which arrives with a call id and has to
 * rebuild the same context the tick would have had. Extracting it into its own
 * module would have been the tidier-looking move and the wrong one: exactly one
 * function finishes a call, and it should stay next to the loop that calls it.
 */
export async function loadContext(call: DueCall): Promise<CallContext | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    select pt.name, pt.age, pt.phone_e164, pt.timezone, pt.language, pt.ai_call_consent,
           p.max_attempts, p.reason, p.rules, p.red_flag_terms, p.result_schema,
           p.goal, p.watch_points,
           n.body as note_body, n.escalation_note
    from follow_up_plans p
    join patients pt on pt.id = p.patient_id
    join consultation_notes n on n.id = p.note_id
    where p.id = ${call.planId}
  `);
  const row = (rows.rows as Record<string, unknown>[])[0];
  if (!row) return null;

  const qs = await db.execute(sql`
    select question_id, prompt, answer_type, enum_values, required, guard_status
    from plan_questions where plan_id = ${call.planId} order by ordinal, question_id
  `);

  return {
    ...call,
    patientName: String(row.name),
    phoneE164: String(row.phone_e164),
    timezone: String(row.timezone),
    language: String(row.language ?? "en-US"),
    consent: String(row.ai_call_consent),
    escalationNote: row.escalation_note ? String(row.escalation_note) : null,
    patientAge: row.age === null || row.age === undefined ? null : Number(row.age),
    reason: String(row.reason ?? "Follow-up"),
    maxAttempts: Number(row.max_attempts),
    rules: (row.rules ?? []) as PlanRule[],
    redFlagTerms: (row.red_flag_terms ?? []) as RedFlagTerm[],
    resultSchema: (row.result_schema ?? {}) as Record<string, unknown>,
    noteBody: String(row.note_body),
    goal: row.goal ? String(row.goal) : DEFAULT_GOAL,
    topics: ((row.watch_points ?? []) as WatchPoint[]).map((w) => ({ text: w.text, unit: w.unit ?? null })),
    legacy: !row.goal,
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
/**
 * What CALL-E's per-recipient result says picked up.
 *
 * Null when the request predates `recipientResultSchema`, when CALL-E could not
 * produce a schema-valid recipient result, or when it genuinely could not tell.
 * Recorded, never branched on: it is context for a clinician reading the row,
 * and the retry decision stays on transcript evidence.
 */
function answeredBy(call: Call): string | null {
  const raw = call.recipients?.[0]?.structuredResult as Record<string, unknown> | null | undefined;
  const value = raw?.answered_by;
  return typeof value === "string" && value.length > 0 ? value : null;
}

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

/**
 * The terminal attempt's failure code, kept for support and shown on the row.
 *
 * Diagnostic only. Nothing branches on it: CALL-E publishes no enum for these,
 * and the docs are explicit that retry, reporting and analytics must not read a
 * particular string. Ours came back `"603"` the one time it mattered.
 */
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
export async function completeCall(
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
  /* The same reading the floor uses, so the folded outcome and the escalation agree. */
  const findings = extractFindings(structured, ctx.topics);
  const anyUnmappable = unresolvedCall(slots, findings);

  const { attemptsMade, allNoAnswer, networkRefusedAll } = await occurrenceAttempts(
    ctx.planId,
    ctx.occurrence,
  );

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
    findings,
    rules: ctx.rules,
    // Without this, an unanswered call's `missing` slots would fire the
    // unmappable rule on every question of a call nobody picked up.
    reached,
    noAnswerExhausted: allNoAnswer && attemptsMade >= ctx.maxAttempts,
    /* Changes what the escalation says, never whether it fires. */
    networkRefusedAll,
    attemptsMade,
    now: new Date(),
  });

  /*
   * Decided here, before anything can pause the plan.
   *
   * `scheduleRetry` only inserts while the plan is `active`, and the escalation
   * loop below pauses on an urgent hit — so deciding the retry after it meant an
   * urgent escalation silently voided the remaining attempts of an occurrence
   * already in flight. That is not a policy anyone chose; it was statement
   * order. A real declined call lost both its retries to it.
   *
   * The trigger is evidence, never a failure string. CALL-E's `failure_code`
   * has no published enum — the one real call came back `"603"` while this code
   * looked for `"no_answer"` — and the docs say plainly not to branch retry
   * logic on it. "Nobody spoke" is a fact we derive from the transcript and the
   * answered slots, and it is the actual condition a retry is for.
   */
  const shouldRetry = !reached && ctx.attempt < ctx.maxAttempts;

  const outcome = foldOutcome({
    reached,
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
    answeredBy: answeredBy(call),
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

  /*
   * The model's read of the call. This is the reading a clinician gets.
   *
   * It runs here, after `finishCall` returned `won`, and that placement is the
   * whole concurrency story: the latch already guarantees exactly one worker
   * gets this far per call, so triage happens at most once with no new locking
   * and no double model spend. It also runs after the slots are written, so the
   * prompt can carry the typed answers and the escalation can point at a slot.
   *
   * Never throws — `triageCall` returns a fail-closed verdict instead, because
   * one unreadable call must not abandon the rest of the queue.
   */
  const triage = await triageCall({
    escalationNote: ctx.escalationNote,
    noteBody: ctx.noteBody,
    patientAge: ctx.patientAge,
    reason: ctx.reason,
    goal: ctx.goal,
    findings,
    transcript,
    slots: slots.map((s) => ({
      questionId: s.questionId,
      status: s.status,
      value: s.valueText ?? (s.valueBool === null ? null : String(s.valueBool)),
    })),
    platform: {
      summary: call.summary ?? null,
      taskCompleted: call.taskCompleted ?? null,
      confidence: (call.completionConfidence ?? null) as never,
      evidence: (call.evidence ?? null) as string[] | null,
    },
    ruleHits: evaluation.hits.map((h) => ({ ruleLabel: h.ruleLabel, urgent: h.urgent })),
    /* The doctor's own vocabulary, read in context rather than substring-matched. */
    redFlagTerms: ctx.redFlagTerms.map((t) => t.term),
    quietForDays,
  });

  const stored = await saveTriage({
    callId: ctx.id,
    patientId: ctx.patientId,
    planId: ctx.planId,
    outcome: triage,
  });

  /*
   * How the patient is doing, kept on the plan for the doctor's view — but only
   * from a reading that actually happened. A fail-closed triage has nothing to
   * say about the patient, and overwriting yesterday's words with nothing would
   * leave the doctor less informed by an outage than by no call at all.
   */
  if (stored.fresh && triage.status === "ok" && triage.answer.summary) {
    await db.execute(sql`
      update follow_up_plans
      set condition_summary = ${triage.answer.summary},
          condition_summary_at = now(),
          condition_summary_call_id = ${ctx.id},
          updated_at = now()
      where id = ${ctx.planId}
    `);
  }

  /*
   * One call, one row.
   *
   * A call used to raise one escalation per rule hit *and* one for triage: the
   * real declined call of 5 September produced three, two of which said the
   * same thing in worse words, and the pause reason a clinician read
   * ("Answer could not be mapped") described a conversation that never
   * happened. A clinician takes one action per call, so a call is one row and
   * everything it tripped is listed on it.
   *
   * Nothing is raised for a call where the floor found nothing and the model
   * read it as `low` — a queue entry recording that a call was fine is how a
   * queue stops being read.
   */
  const floorHits = evaluation.hits.map((h) => ({
    ruleId: h.ruleId,
    label: h.ruleLabel,
    urgent: h.urgent,
  }));
  const triageSpoke = triage.status === "ok" && triage.answer.verdict !== "low";
  const severe = triage.status === "ok" && triage.answer.verdict === "severe";

  if (stored.fresh && (floorHits.length > 0 || triage.answer.verdict !== "low")) {
    /*
     * The headline is what a doctor reads first, so it is the most concrete
     * thing available. A floor hit names an actual condition — "Patient asked
     * for a clinician", "Every attempt went unanswered" — which beats "Read by
     * the assistant" every time; the model's severity and its summary are
     * already on the row beside it. The assistant only takes the headline when
     * the floor found nothing and the model alone thought this was worth a
     * clinician's time.
     */
    const headline = evaluation.hits.find((h) => h.urgent) ?? evaluation.hits[0] ?? null;

    const ruleId = headline?.ruleId ?? (triage.status === "ok" ? "llm_triage" : "triage_unavailable");
    const ruleLabel =
      headline?.ruleLabel ?? (triage.status === "ok" ? "Read by the assistant" : "Could not be read");

    const escalationId = await raiseEscalation({
      patientId: ctx.patientId,
      planId: ctx.planId,
      callId: ctx.id,
      /* Points at the answer that caused it, when one did — which is what
         makes `slot_id` a deep link rather than a column nothing writes. */
      slotId: headline?.questionId ? (slotIds.get(headline.questionId) ?? null) : null,
      ruleId,
      ruleLabel,
      /*
       * Only a `severe` verdict from a model that actually ran may pause a
       * plan, and so may an urgent floor hit. A provider outage escalating as
       * urgent would pause every plan on the roster — an outage of the workflow
       * the product exists to run, caused by the mechanism meant to protect it.
       */
      urgent: evaluation.shouldPause || severe,
      /* The model's prose when it ran; the rule's sentence when it did not. */
      reason: triageSpoke ? triage.answer.reason : (headline?.reason ?? triage.answer.reason),
      utterance: triage.answer.quote || headline?.utterance || null,
      dedupeKey: `${ctx.planId}:call:${ctx.id}`,
      severity: triage.answer.verdict,
      summary: triage.answer.summary || null,
      triageId: stored.id,
      floorHits,
    });

    if (escalationId) {
      counters.escalated += 1;
      if (evaluation.shouldPause || severe) {
        await pausePlan(ctx.planId, ruleLabel, escalationId);
      }
      /* The week band showed this day as answered; a flagged day is the truth. */
      await db.execute(sql`
        update scheduled_calls set outcome = 'flagged', updated_at = now()
        where id = ${ctx.id} and outcome not in ('flagged', 'refused', 'no_answer')
      `);
    }
  }

  // Decided above, before the escalation loop could pause the plan out from
  // under it. A call somebody answered is finished, whatever it contained.
  if (shouldRetry) {
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

  /*
   * A plan set up before goal-based calls has a frozen schema with no topics
   * and questions the goal task would list as "never read out". Dialling it
   * would ask nothing the doctor wrote and then read every answer as unmappable.
   * Refused, visibly, rather than half-run.
   */
  if (ctx.legacy) {
    await recordRefusal(
      ctx.id,
      "guard_violation",
      "This follow-up was set up before calls were given a goal from the note. Start a new follow-up from a consultation note.",
    );
    counters.refused += 1;
    return;
  }

  const script = assembleTask({
    patientName: ctx.patientName,
    /* Spoken to the patient. Configurable, with the fixtures as defaults. */
    practiceName: readConfig().practiceName,
    clinicianName: readConfig().clinicianName,
    questions: ctx.questions,
    goal: ctx.goal,
    topics: ctx.topics,
    speakLanguage: spokenLanguageName(ctx.language),
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
    locale: ctx.language,
    /* Enrolment consent is what authorises the call. `unknown` is not
       agreement — the port refuses anything that is not an explicit grant. */
    consentGranted: ctx.consent === "granted",
    /* Only when this instance actually has a public address. Sent as a prompt,
       not a dependency: the reconciler finishes the call either way. */
    ...(webhookUrl() ? { webhookUrl: webhookUrl() as string } : {}),
  });

  if (!outcome.ok) {
    /*
     * A hiccup goes back in the queue; a decision is final.
     *
     * CALL-E rejects any dial that would exceed the account's concurrency
     * limit — one, on a shared line, counting the dashboard — and its own
     * message says to wait and retry. That was being recorded as a terminal
     * refusal, and since no retry is ever scheduled for a refusal, a patient
     * lost that day's call because somebody had the dashboard open.
     *
     * Bounded by `skipStaleCalls`, which runs before every claim: the row
     * keeps its original `scheduled_for`, so ninety minutes past due it is
     * retired `too_late` rather than deferring forever. No attempt is spent —
     * nothing about the patient failed.
     */
    const detail = `${REFUSAL_TEXT[outcome.refusal]} ${outcome.detail}`;

    if (isTransientRefusal(outcome.refusal) && (await deferCall(ctx.id, detail))) {
      counters.deferred += 1;
      return;
    }

    await recordRefusal(ctx.id, outcome.refusal, detail);
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

    /* Before claiming, never after: a call too late to place must be retired
       rather than dialled at whatever hour this tick happened to run. */
    counters.retired = await skipStaleCalls();

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
