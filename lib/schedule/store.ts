/**
 * The scheduler's writes.
 *
 * **There are no transactions.** The Neon HTTP driver gives one implicit
 * transaction per statement, so every mutation here is a single conditional
 * `UPDATE … RETURNING` or an `INSERT … ON CONFLICT DO NOTHING RETURNING`, and
 * the caller's contract is always the same: *zero rows means someone else got
 * there first — stop, do not proceed.*
 *
 * That pattern replaces every lock this code would otherwise need. Read it once
 * and the rest of the scheduler follows: nothing here is safe because of when
 * it runs, only because of what its `WHERE` clause says.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId, idempotencyKey } from "@/lib/db/ids";
import type { CallOutcome, ResultStatus, TickTrigger } from "@/lib/db/enums";
import type { StoredTurn } from "@/lib/db/schema";

export interface DueCall {
  id: string;
  planId: string;
  patientId: string;
  occurrence: number;
  attempt: number;
  idempotencyKey: string;
  scheduledFor: Date;
}

/**
 * Claim a batch of calls that are due.
 *
 * Safe without a transaction because the outer `WHERE` re-checks
 * `status = 'scheduled'` at write time, under the row lock the sub-select took.
 * Two ticks running concurrently therefore get **disjoint** sets: a row claimed
 * by one simply fails the other's predicate. `SKIP LOCKED` turns contention
 * into "you get different rows" rather than "you wait".
 *
 * The joins are load-bearing beyond filtering: because pausing a plan or
 * archiving a patient makes rows fail this query, neither action needs to write
 * to `scheduled_calls` at all. One column flips and the dialer stops.
 */
export async function claimDueCalls(tickId: string, limit = 5): Promise<DueCall[]> {
  const result = await getDb().execute(sql`
    update scheduled_calls sc
    set status = 'claimed', claimed_at = now(), claimed_by = ${tickId}, updated_at = now()
    from (
      select c.id
      from scheduled_calls c
      join follow_up_plans p on p.id = c.plan_id
      join patients pt on pt.id = c.patient_id
      where c.status = 'scheduled'
        and c.scheduled_for <= now()
        and p.status = 'active'
        and pt.archived_at is null
      order by c.scheduled_for
      limit ${limit}
      for update of c skip locked
    ) due
    where sc.id = due.id and sc.status = 'scheduled'
    returning sc.id, sc.plan_id, sc.patient_id, sc.occurrence, sc.attempt,
              sc.idempotency_key, sc.scheduled_for
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    planId: String(r.plan_id),
    patientId: String(r.patient_id),
    occurrence: Number(r.occurrence),
    attempt: Number(r.attempt),
    idempotencyKey: String(r.idempotency_key),
    scheduledFor: new Date(String(r.scheduled_for)),
  }));
}

/** Record the script we are about to send, before we send it. */
export async function recordTask(callId: string, task: string): Promise<void> {
  await getDb().execute(sql`
    update scheduled_calls set task = ${task}, updated_at = now() where id = ${callId}
  `);
}

/**
 * Persist CALL-E's id the instant `create()` returns.
 *
 * There is no endpoint that lists calls, so an id we fail to store is a result
 * we can never read back. `calle_call_id is null` makes this write-once at the
 * row level; the unique index makes it write-once globally.
 */
export async function recordDialed(callId: string, calleCallId: string): Promise<boolean> {
  const result = await getDb().execute(sql`
    update scheduled_calls
    set calle_call_id = ${calleCallId}, status = 'dialing', dialed_at = now(), updated_at = now()
    where id = ${callId} and calle_call_id is null
    returning id
  `);
  return result.rows.length > 0;
}

/** A refused dial is a visible row with a reason. Never a silent skip. */
export async function recordRefusal(
  callId: string,
  reason: string,
  detail: string,
): Promise<void> {
  await getDb().execute(sql`
    update scheduled_calls
    set status = 'refused', refusal_reason = ${reason}, refusal_detail = ${detail},
        outcome = 'refused', finished_at = now(), updated_at = now()
    where id = ${callId} and status in ('claimed', 'dialing')
  `);
}

export interface FinishInput {
  callId: string;
  status: "completed" | "failed";
  calleStatus: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  resultStatus: ResultStatus;
  structuredResult: unknown;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: unknown;
  evidence: string[] | null;
  transcript: StoredTurn[] | null;
  calleRaw: unknown;
  outcome: CallOutcome;
}

/**
 * Finish a call — the latch the whole post-call pipeline hangs off.
 *
 * The `after()` waiter and the reconciler race here as a matter of course, and
 * both are correct to try. **Zero rows means the other one already finished it**,
 * and the caller must then not extract slots, not evaluate rules, and not
 * schedule a retry. One statement does the work a transaction would otherwise
 * have to wrap around the entire pipeline.
 *
 * `outcome` is written here, in the same statement as `status`, so the two can
 * never disagree.
 */
export async function finishCall(input: FinishInput): Promise<boolean> {
  const result = await getDb().execute(sql`
    update scheduled_calls
    set status = ${input.status},
        calle_status = ${input.calleStatus},
        calle_failure_code = ${input.failureCode},
        calle_failure_message = ${input.failureMessage},
        result_status = ${input.resultStatus},
        structured_result = ${input.structuredResult === null ? null : JSON.stringify(input.structuredResult)}::jsonb,
        summary = ${input.summary},
        task_completed = ${input.taskCompleted},
        completion_confidence = ${input.completionConfidence === null ? null : JSON.stringify(input.completionConfidence)}::jsonb,
        evidence = ${input.evidence === null ? null : JSON.stringify(input.evidence)}::jsonb,
        transcript = ${input.transcript === null ? null : JSON.stringify(input.transcript)}::jsonb,
        calle_raw = ${input.calleRaw === null ? null : JSON.stringify(input.calleRaw)}::jsonb,
        outcome = ${input.outcome},
        finished_at = now(),
        updated_at = now()
    where id = ${input.callId}
      and status in ('claimed', 'dialing')
      and finished_at is null
    returning id
  `);
  return result.rows.length > 0;
}

/**
 * Create the next attempt, lazily.
 *
 * Idempotent behind `uniq_call_slot`: two ticks racing to schedule the same
 * retry both run this, exactly one gets a row, and the other knows not to dial.
 *
 * Note the absence of an `ends_at` check. That asymmetry is deliberate and is
 * the other half of "seven days is calendar-anchored": a retry **may** spill
 * past the window's end, because it belongs to a day inside it. Only a new
 * occurrence may not.
 */
export async function scheduleRetry(
  planId: string,
  occurrence: number,
  attempt: number,
  retryOfCallId: string,
): Promise<string | null> {
  const id = newId("sc");
  const result = await getDb().execute(sql`
    insert into scheduled_calls
      (id, plan_id, patient_id, occurrence, attempt, idempotency_key, scheduled_for, retry_of_call_id)
    select ${id}, p.id, p.patient_id, ${occurrence}, ${attempt},
           ${idempotencyKey(planId, occurrence, attempt)},
           now() + make_interval(mins => p.retry_delay_minutes::float / p.time_scale),
           ${retryOfCallId}
    from follow_up_plans p
    where p.id = ${planId} and p.status = 'active' and ${attempt} <= p.max_attempts
    on conflict (plan_id, occurrence, attempt) do nothing
    returning id
  `);
  return result.rows.length > 0 ? id : null;
}

/** How many attempts this occurrence has had, and whether every one went unanswered. */
export async function occurrenceAttempts(
  planId: string,
  occurrence: number,
): Promise<{ attemptsMade: number; allNoAnswer: boolean; maxAttempts: number }> {
  const result = await getDb().execute(sql`
    select
      count(c.*) filter (where c.finished_at is not null)                    as made,
      count(c.*) filter (where c.calle_failure_code = 'no_answer')           as no_answer,
      max(p.max_attempts)                                                    as max_attempts
    from scheduled_calls c
    join follow_up_plans p on p.id = c.plan_id
    where c.plan_id = ${planId} and c.occurrence = ${occurrence}
  `);

  const row = (result.rows as Record<string, unknown>[])[0] ?? {};
  const made = Number(row.made ?? 0);
  const noAnswer = Number(row.no_answer ?? 0);
  return {
    attemptsMade: made,
    allNoAnswer: made > 0 && made === noAnswer,
    maxAttempts: Number(row.max_attempts ?? 3),
  };
}

/**
 * Raise an escalation, idempotently.
 *
 * `dedupeKey` is what makes re-evaluating a finished call free. A reconcile that
 * re-reads a call re-runs the pure engine and re-raises everything it finds;
 * this turns the second raise into a no-op returning zero rows, so the plan is
 * not paused twice and nobody is notified twice.
 */
export async function raiseEscalation(input: {
  patientId: string;
  planId: string;
  callId: string | null;
  slotId: string | null;
  ruleId: string;
  ruleLabel: string;
  urgent: boolean;
  reason: string;
  utterance: string | null;
  dedupeKey: string;
}): Promise<string | null> {
  const id = newId("esc");
  const result = await getDb().execute(sql`
    insert into escalations
      (id, patient_id, plan_id, call_id, slot_id, rule_id, rule_label, urgent, reason, utterance, dedupe_key)
    values (${id}, ${input.patientId}, ${input.planId}, ${input.callId}, ${input.slotId},
            ${input.ruleId}, ${input.ruleLabel}, ${input.urgent}, ${input.reason},
            ${input.utterance}, ${input.dedupeKey})
    on conflict (dedupe_key) do nothing
    returning id
  `);
  return result.rows.length > 0 ? id : null;
}

/**
 * Pause a plan. Only urgent escalations call this.
 *
 * `status = 'active'` means it can happen at most once per active period, so
 * two urgent escalations raised from one call cannot double-pause.
 */
export async function pausePlan(
  planId: string,
  reason: string,
  escalationId: string,
): Promise<boolean> {
  const paused = await getDb().execute(sql`
    update follow_up_plans
    set status = 'paused', paused_at = now(), paused_reason = ${reason},
        paused_by_escalation_id = ${escalationId}, updated_at = now()
    where id = ${planId} and status = 'active'
    returning id
  `);

  if (paused.rows.length === 0) return false;

  /*
   * Stamped separately, and deliberately not atomic with the pause — there is
   * no transaction to make it so. The worst case is a paused plan whose owning
   * escalation is unmarked, which the queue renders as "paused, see queue"
   * rather than a deep link. A degraded link beats a lie about atomicity.
   */
  await getDb().execute(sql`
    update escalations set paused_plan = true where id = ${escalationId}
  `);
  return true;
}

/**
 * Resume a paused plan.
 *
 * The backlog is skipped *first*. A plan paused for two days has two days of
 * due rows waiting, and flipping the status before clearing them would dial the
 * patient three times in a row the moment a clinician clicked resume.
 */
export async function resumePlan(planId: string, by: string): Promise<boolean> {
  await getDb().execute(sql`
    update scheduled_calls
    set status = 'skipped', skip_reason = 'plan_paused', updated_at = now()
    where plan_id = ${planId} and status = 'scheduled' and scheduled_for < now()
  `);

  const result = await getDb().execute(sql`
    update follow_up_plans
    set status = 'active', resumed_at = now(), resumed_by = ${by},
        paused_at = null, paused_reason = null, paused_by_escalation_id = null,
        updated_at = now()
    where id = ${planId} and status = 'paused'
    returning id
  `);
  return result.rows.length > 0;
}

export async function closePlan(planId: string, reason: string, by: string): Promise<boolean> {
  const result = await getDb().execute(sql`
    update follow_up_plans
    set status = 'completed', closed_at = now(), close_reason = ${reason},
        resumed_by = ${by}, updated_at = now()
    where id = ${planId} and status in ('active', 'paused')
    returning id
  `);
  return result.rows.length > 0;
}

export async function resolveEscalation(
  escalationId: string,
  resolution: string,
  by: string,
): Promise<{ planId: string; pausedPlan: boolean } | null> {
  const result = await getDb().execute(sql`
    update escalations
    set status = 'resolved', resolved_at = now(), resolved_by = ${by}, resolution = ${resolution}
    where id = ${escalationId} and status in ('open', 'acknowledged')
    returning plan_id, paused_plan
  `);
  const row = (result.rows as Record<string, unknown>[])[0];
  return row ? { planId: String(row.plan_id), pausedPlan: Boolean(row.paused_plan) } : null;
}

/**
 * Close plans whose window has elapsed.
 *
 * The `not exists` clause is the other half of the retry asymmetry: a retry
 * that spilled past `ends_at` keeps its plan open until it lands. Duration
 * expiring is the only non-human way a plan ends — a clear call never ends one.
 */
export async function closeElapsedPlans(): Promise<number> {
  const result = await getDb().execute(sql`
    update follow_up_plans p
    set status = 'completed', closed_at = now(), close_reason = 'duration_elapsed',
        updated_at = now()
    where p.status = 'active'
      and p.ends_at <= now()
      and not exists (
        select 1 from scheduled_calls c
        where c.plan_id = p.id and c.status in ('scheduled', 'claimed', 'dialing')
      )
    returning p.id
  `);
  return result.rows.length;
}

/**
 * Calls whose waiter gave up — the request that dialled them could not stay
 * open for the length of a phone call.
 *
 * These are not failures. Most are simply still ringing, which is why the
 * caller re-fetches and only finishes them once CALL-E reports a terminal
 * state.
 */
export async function findAbandonedCalls(olderThanSeconds = 45): Promise<
  { id: string; calleCallId: string | null; planId: string; patientId: string; occurrence: number; attempt: number }[]
> {
  const result = await getDb().execute(sql`
    select id, calle_call_id, plan_id, patient_id, occurrence, attempt
    from scheduled_calls
    where status in ('claimed', 'dialing')
      and claimed_at < now() - make_interval(secs => ${olderThanSeconds})
    limit 20
  `);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    calleCallId: r.calle_call_id ? String(r.calle_call_id) : null,
    planId: String(r.plan_id),
    patientId: String(r.patient_id),
    occurrence: Number(r.occurrence),
    attempt: Number(r.attempt),
  }));
}

// ---------------------------------------------------------------------------
// The tick's own bookkeeping
// ---------------------------------------------------------------------------

export interface TickCounters {
  claimed: number;
  dialed: number;
  refused: number;
  finished: number;
  escalated: number;
  expanded: number;
}

/**
 * Take the tick lease.
 *
 * Not load-bearing for correctness — `claimDueCalls` is already safe against
 * concurrency. This exists because three trigger sources (a page load, a cron
 * POST, a client poller) can fire inside the same second, and one no-op beats a
 * thundering herd. Do not remove the row-level claim guard on the assumption
 * that this protects it.
 */
export async function beginTick(trigger: TickTrigger): Promise<string | null> {
  const db = getDb();

  await db.execute(sql`
    update tick_runs set finished_at = now(), error = 'stale'
    where finished_at is null and started_at < now() - interval '90 seconds'
  `);

  const id = newId("tick");
  const result = await db.execute(sql`
    insert into tick_runs (id, trigger, lease) values (${id}, ${trigger}, 'global')
    on conflict do nothing
    returning id
  `);
  return result.rows.length > 0 ? id : null;
}

export async function endTick(
  tickId: string,
  counters: TickCounters,
  error?: string,
): Promise<void> {
  await getDb().execute(sql`
    update tick_runs
    set finished_at = now(), expanded = ${counters.expanded}, claimed = ${counters.claimed},
        dialed = ${counters.dialed}, refused = ${counters.refused},
        finished = ${counters.finished}, escalated = ${counters.escalated},
        error = ${error ?? null}
    where id = ${tickId}
  `);
}
