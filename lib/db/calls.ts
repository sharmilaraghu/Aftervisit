/**
 * One call, in full.
 *
 * The only read in the application allowed to pull `transcript` — it is TOASTed
 * jsonb and can run to megabytes, so every other query names its columns and
 * leaves it alone.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { MAX_CALL_DELAY_MINUTES } from "@/lib/schedule/store";
import type { StoredTurn } from "@/lib/db/schema";
import type { GuardFinding } from "@/lib/script/guard";

export interface CallSlot {
  questionId: string;
  prompt: string | null;
  status: string;
  valueBool: boolean | null;
  valueNumber: number | null;
  valueText: string | null;
  utterance: string | null;
  utteranceOffsetSeconds: number | null;
}

export interface CallDetail {
  id: string;
  planId: string;
  patientId: string;
  patientName: string;
  timezone: string;
  phoneE164: string;
  occurrence: number;
  attempt: number;
  maxAttempts: number;
  status: string;
  outcome: string | null;
  scheduledFor: Date;
  dialedAt: Date | null;
  finishedAt: Date | null;
  calleCallId: string | null;
  calleStatus: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  refusalReason: string | null;
  refusalDetail: string | null;
  skipReason: string | null;
  /** `planned` for a day of the plan, `try` for an extra call a doctor placed. */
  kind: string;
  resultStatus: string;
  /* CALL-E's own post-call analysis. Displayed as evidence, never used for a
     decision — the rules read slots, not prose. */
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  evidence: string[] | null;
  task: string | null;
  transcript: StoredTurn[] | null;
  transcriptGuardFindings: GuardFinding[] | null;
  slots: CallSlot[];
  escalations: { id: string; ref: number; ruleLabel: string; urgent: boolean; reason: string }[];
}

export async function getCall(callId: string): Promise<CallDetail | null> {
  const db = getDb();

  const rows = await db.execute(sql`
    select c.*, pt.name as patient_name, pt.timezone, pt.phone_e164, p.max_attempts
    from scheduled_calls c
    join patients pt on pt.id = c.patient_id
    join follow_up_plans p on p.id = c.plan_id
    where c.id = ${callId}
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  if (!r) return null;

  const [slotRows, escRows] = await Promise.all([
    db.execute(sql`
      select s.question_id, s.status, s.value_bool, s.value_number, s.value_text,
             s.utterance, s.utterance_offset_seconds, q.prompt
      from extracted_slots s
      left join plan_questions q
        on q.plan_id = ${String(r.plan_id)} and q.question_id = s.question_id
      where s.call_id = ${callId}
      order by q.ordinal nulls last, s.question_id
    `),
    db.execute(sql`
      select id, ref, rule_label, urgent, reason from escalations
      where call_id = ${callId} order by raised_at
    `),
  ]);

  return {
    id: String(r.id),
    planId: String(r.plan_id),
    patientId: String(r.patient_id),
    patientName: String(r.patient_name),
    timezone: String(r.timezone),
    phoneE164: String(r.phone_e164),
    occurrence: Number(r.occurrence),
    attempt: Number(r.attempt),
    maxAttempts: Number(r.max_attempts),
    status: String(r.status),
    outcome: r.outcome ? String(r.outcome) : null,
    scheduledFor: new Date(String(r.scheduled_for)),
    dialedAt: r.dialed_at ? new Date(String(r.dialed_at)) : null,
    finishedAt: r.finished_at ? new Date(String(r.finished_at)) : null,
    calleCallId: r.calle_call_id ? String(r.calle_call_id) : null,
    calleStatus: r.calle_status ? String(r.calle_status) : null,
    failureCode: r.calle_failure_code ? String(r.calle_failure_code) : null,
    failureMessage: r.calle_failure_message ? String(r.calle_failure_message) : null,
    refusalReason: r.refusal_reason ? String(r.refusal_reason) : null,
    refusalDetail: r.refusal_detail ? String(r.refusal_detail) : null,
    skipReason: r.skip_reason ? String(r.skip_reason) : null,
    kind: String(r.kind ?? "planned"),
    resultStatus: String(r.result_status),
    summary: r.summary ? String(r.summary) : null,
    taskCompleted: r.task_completed === null || r.task_completed === undefined
      ? null
      : Boolean(r.task_completed),
    completionConfidence: (r.completion_confidence ?? null) as
      | { score: number; label: string }
      | null,
    evidence: (r.evidence ?? null) as string[] | null,
    task: r.task ? String(r.task) : null,
    transcript: (r.transcript ?? null) as StoredTurn[] | null,
    transcriptGuardFindings: (r.transcript_guard_findings ?? null) as GuardFinding[] | null,
    slots: (slotRows.rows as Record<string, unknown>[]).map((s) => ({
      questionId: String(s.question_id),
      prompt: s.prompt ? String(s.prompt) : null,
      status: String(s.status),
      valueBool: s.value_bool === null ? null : Boolean(s.value_bool),
      valueNumber: s.value_number === null ? null : Number(s.value_number),
      valueText: s.value_text ? String(s.value_text) : null,
      utterance: s.utterance ? String(s.utterance) : null,
      utteranceOffsetSeconds: s.utterance_offset_seconds === null ? null : Number(s.utterance_offset_seconds),
    })),
    escalations: (escRows.rows as Record<string, unknown>[]).map((e) => ({
      id: String(e.id),
      ref: Number(e.ref),
      ruleLabel: String(e.rule_label),
      urgent: Boolean(e.urgent),
      reason: String(e.reason),
    })),
  };
}

export interface DashboardStats {
  patients: number;
  activePlans: number;
  dueToday: number;
  contacted: number;
  due: number;
  openEscalations: number;
  urgentEscalations: number;
  callsMade: number;
  /**
   * Calls that are due and still undialled, inside the window a tick would
   * claim them in.
   *
   * The half of "is the scheduler alive?" that says whether it matters. A
   * console with nothing overdue does not care when the last tick ran; one with
   * calls waiting and no recent tick is a practice whose patients are not being
   * phoned, and that must not look like a quiet day.
   */
  overdueCalls: number;
  lastTick: { at: Date; trigger: string; dialed: number } | null;
  /**
   * Whole minutes since the last finished tick, or null if none ever ran.
   *
   * Derived here rather than in a component: a clock read during render is
   * impure and produces a different answer every time React happens to
   * re-render.
   */
  minutesSinceTick: number | null;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDb();
  const rows = await db.execute(sql`
    select
      (select count(*) from patients where archived_at is null)                        as patients,
      (select count(*) from follow_up_plans where status = 'active')                   as active_plans,
      (select count(*) from scheduled_calls
        where status = 'scheduled' and scheduled_for <= now() + interval '1 day')      as due_today,
      (select count(distinct (plan_id, occurrence)) from scheduled_calls
        where outcome in ('answered','flagged','unmappable')
          and kind = 'planned')                                                        as contacted,
      (select count(*) from scheduled_calls
        where attempt = 1 and scheduled_for <= now() and status <> 'skipped'
          and kind = 'planned')                                                        as due,
      (select count(*) from escalations where status in ('open','acknowledged'))       as open_esc,
      (select count(*) from escalations
        where status in ('open','acknowledged') and urgent)                            as urgent_esc,
      (select count(*) from scheduled_calls where finished_at is not null)             as calls_made,
      -- The same predicate claimDueCalls uses, deliberately. A row this query
      -- counts but a tick would not claim is a false alarm: a paused plan's
      -- calls are not waiting on the scheduler, they are waiting on a
      -- clinician, and past the delay window a tick retires the row rather
      -- than dialling it.
      (select count(*)
        from scheduled_calls c
        join follow_up_plans p on p.id = c.plan_id
        join patients pt on pt.id = c.patient_id
        where c.status = 'scheduled'
          and c.scheduled_for <= now()
          and c.scheduled_for >= now() - make_interval(mins => ${MAX_CALL_DELAY_MINUTES}::int)
          and p.status = 'active'
          and pt.archived_at is null)                                                  as overdue
  `);
  const r = (rows.rows as Record<string, unknown>[])[0] ?? {};

  const tick = await db.execute(sql`
    select started_at, trigger, dialed from tick_runs
    where finished_at is not null order by started_at desc limit 1
  `);
  const t = (tick.rows as Record<string, unknown>[])[0];

  return {
    patients: Number(r.patients ?? 0),
    activePlans: Number(r.active_plans ?? 0),
    dueToday: Number(r.due_today ?? 0),
    contacted: Number(r.contacted ?? 0),
    due: Number(r.due ?? 0),
    openEscalations: Number(r.open_esc ?? 0),
    urgentEscalations: Number(r.urgent_esc ?? 0),
    callsMade: Number(r.calls_made ?? 0),
    overdueCalls: Number(r.overdue ?? 0),
    lastTick: t
      ? { at: new Date(String(t.started_at)), trigger: String(t.trigger), dialed: Number(t.dialed) }
      : null,
    minutesSinceTick: t
      ? Math.max(0, Math.floor((Date.now() - new Date(String(t.started_at)).getTime()) / 60_000))
      : null,
  };
}
