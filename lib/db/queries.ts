/**
 * The console's reads.
 *
 * Two rules hold across everything here:
 *
 *   1. **Never `select *` on `scheduled_calls`.** Its `transcript` and
 *      `calle_raw` columns are TOASTed jsonb and can run to megabytes. Every
 *      read outside the single-call page names its columns.
 *   2. **Never aggregate two child tables in one join.** Joining both
 *      `scheduled_calls` and `escalations` onto a plan multiplies the rows —
 *      one open escalation against seven calls counts as seven. Escalation
 *      counts come from correlated subqueries, deliberately.
 *
 * Everything the roster shows beyond identity is derived here, because none of
 * it is a column: a stored `on_track` goes stale the moment a patient falls
 * quiet, which is the exact failure the product exists to catch.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import type { DayState, PlanHealth } from "@/lib/db/enums";

/** Outcomes that mean a human actually spoke to us. `unmappable` counts: they answered. */
const REACHED = sql`c.outcome in ('answered','flagged','unmappable')`;

export interface RosterRow {
  /** Null when the patient has no plan yet — which is a state the roster must show. */
  planId: string | null;
  patientId: string;
  name: string;
  age: number;
  phoneE164: string;
  timezone: string;
  reason: string;
  planStatus: string | null;
  /** Occurrences whose first attempt has come due. Retries are excluded — see below. */
  due: number;
  contacted: number;
  lastHeard: Date | null;
  /** Calendar days in the patient's own zone, not elapsed hours. */
  quietFor: number | null;
  urgentOpen: number;
  openTotal: number;
  week: DayState[];
  health: PlanHealth;
}

/** Silence for this many days is drift. Injected into the pure health function, never read from a clock there. */
export const DRIFT_THRESHOLD_DAYS = 3;

/**
 * Plan health, derived. Pure: everything it needs is already on the row.
 *
 * Precedence matters and matches the roster's sort — an escalated patient is
 * escalated even if they are also quiet, because the clinician has one action
 * to take and it is the escalation.
 */
export function deriveHealth(row: {
  planStatus: string | null;
  urgentOpen: number;
  quietFor: number | null;
  /** Occurrences where a human actually spoke to us. */
  contacted: number;
}): PlanHealth {
  /*
   * A patient nobody has written a plan for is the quietest patient this system
   * can hold, and the product exists to catch exactly that. It is a first-class
   * state on the roster, not an absence that filters the row out.
   */
  if (row.planStatus === null) return "needs_plan";
  if (row.urgentOpen > 0) return "escalated";
  /*
   * Checked before `completed`, deliberately. A finished plan that never
   * reached anyone is not a finished follow-up — it is the silence this whole
   * product is built to notice, and it used to render as a quiet grey badge.
   */
  if ((row.planStatus === "completed" || row.planStatus === "cancelled") && row.contacted === 0) {
    return "never_reached";
  }
  if (row.planStatus === "paused") return "paused";
  if (row.planStatus === "awaiting_approval") return "awaiting_approval";
  if (row.planStatus === "completed") return "completed";
  if (row.quietFor !== null && row.quietFor >= DRIFT_THRESHOLD_DAYS) return "drifting";
  return "on_track";
}

/**
 * The roster, in two queries: one aggregate over plans, one fold over
 * occurrences. Two round trips rather than one, because folding the week band
 * in the same statement would require the very join that inflates the counts.
 */
export async function getRoster(): Promise<RosterRow[]> {
  const db = getDb();

  const aggregate = await db.execute(sql`
    select
      p.id                                as plan_id,
      pt.id                               as patient_id,
      pt.name,
      pt.age,
      pt.phone_e164,
      pt.timezone,
      coalesce(p.reason, 'No plan yet')   as reason,
      p.status                            as plan_status,
      count(*) filter (
        where c.attempt = 1 and c.scheduled_for <= now() and c.status <> 'skipped'
      )                                   as due,
      count(distinct c.occurrence) filter (where ${REACHED}) as contacted,
      max(c.finished_at) filter (where ${REACHED})           as last_heard,
      (
        select count(*) from escalations e
        where e.plan_id = p.id and e.status in ('open','acknowledged') and e.urgent
      )                                   as urgent_open,
      (
        select count(*) from escalations e
        where e.plan_id = p.id and e.status in ('open','acknowledged')
      )                                   as open_total
    from patients pt
    /*
     * Exactly one plan per patient — the current one.
     *
     * A plain left join returns a row per plan, so a patient with a finished
     * plan and a fresh one appears on the roster twice. The roster is a list of
     * people, not of plans: a lateral picking the newest non-cancelled plan
     * keeps it one row each, and a patient with none still gets their row with
     * a null plan.
     */
    left join lateral (
      select fp.* from follow_up_plans fp
      where fp.patient_id = pt.id and fp.status <> 'cancelled'
      order by fp.created_at desc
      limit 1
    ) p on true
    left join scheduled_calls c on c.plan_id = p.id
    where pt.archived_at is null
    group by p.id, pt.id, pt.name, pt.age, pt.phone_e164, pt.timezone, p.reason, p.status
  `);

  const rows = aggregate.rows as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const bands = await getWeekBands(
    rows.map((r) => r.plan_id).filter((id): id is string => Boolean(id)).map(String),
  );

  return rows.map((r) => {
    const lastHeard = r.last_heard ? new Date(String(r.last_heard)) : null;
    const quietFor = lastHeard
      ? calendarDaysBetween(lastHeard, new Date(), String(r.timezone))
      : null;
    const base = {
      planStatus: r.plan_status ? String(r.plan_status) : null,
      urgentOpen: Number(r.urgent_open),
      quietFor,
      contacted: Number(r.contacted),
    };
    return {
      planId: r.plan_id ? String(r.plan_id) : null,
      patientId: String(r.patient_id),
      name: String(r.name),
      age: Number(r.age),
      phoneE164: String(r.phone_e164),
      timezone: String(r.timezone),
      reason: String(r.reason),
      planStatus: base.planStatus,
      due: Number(r.due),
      contacted: Number(r.contacted),
      lastHeard,
      quietFor,
      urgentOpen: base.urgentOpen,
      openTotal: Number(r.open_total),
      week: (r.plan_id ? bands.get(String(r.plan_id)) : undefined) ?? emptyWeek(),
      health: deriveHealth(base),
    };
  });
}

/**
 * Seven cells per plan, folded from stored `outcome`.
 *
 * The CASE order is a priority order: a flag anywhere in a day's attempts wins
 * the cell, because that is the thing a clinician must not scroll past.
 */
export async function getWeekBands(planIds: string[]): Promise<Map<string, DayState[]>> {
  const out = new Map<string, DayState[]>();
  if (planIds.length === 0) return out;

  const db = getDb();
  const result = await db.execute(sql`
    select c.plan_id, c.occurrence,
      case
        when bool_or(c.outcome = 'flagged')                         then 'flagged'
        when bool_or(c.outcome in ('answered','unmappable'))        then 'answered'
        when bool_or(c.status = 'skipped')                          then 'held'
        when bool_or(c.status in ('scheduled','claimed','dialing')) then 'scheduled'
        else 'missed'
      end as day_state
    from scheduled_calls c
    where c.plan_id in (${sql.join(
      planIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    group by c.plan_id, c.occurrence
  `);

  for (const row of result.rows as Record<string, unknown>[]) {
    const planId = String(row.plan_id);
    const week = out.get(planId) ?? emptyWeek();
    const index = Number(row.occurrence) - 1;
    if (index >= 0 && index < 7) week[index] = String(row.day_state) as DayState;
    out.set(planId, week);
  }
  return out;
}

export interface QueueRow {
  id: string;
  ref: number;
  patientId: string;
  patientName: string;
  phoneE164: string;
  /** Timestamps are shown in the patient's zone, not the server's. */
  timezone: string;
  planId: string;
  callId: string | null;
  ruleId: string;
  ruleLabel: string;
  urgent: boolean;
  reason: string;
  utterance: string | null;
  raisedAt: Date;
  pausedPlan: boolean;
}

/** The queue's only query, ordered exactly as it renders so `idx_queue` serves it. */
export async function getQueue(): Promise<QueueRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select e.id, e.ref, e.patient_id, pt.name as patient_name, pt.phone_e164,
           pt.timezone, e.plan_id, e.call_id, e.rule_id, e.rule_label, e.urgent,
           e.reason, e.utterance, e.raised_at, e.paused_plan
    from escalations e
    join patients pt on pt.id = e.patient_id
    where e.status in ('open','acknowledged')
    order by e.urgent desc, e.raised_at desc
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    ref: Number(r.ref),
    patientId: String(r.patient_id),
    patientName: String(r.patient_name),
    phoneE164: String(r.phone_e164),
    timezone: String(r.timezone),
    planId: String(r.plan_id),
    callId: r.call_id ? String(r.call_id) : null,
    ruleId: String(r.rule_id),
    ruleLabel: String(r.rule_label),
    urgent: Boolean(r.urgent),
    reason: String(r.reason),
    utterance: r.utterance ? String(r.utterance) : null,
    raisedAt: new Date(String(r.raised_at)),
    pausedPlan: Boolean(r.paused_plan),
  }));
}

function emptyWeek(): DayState[] {
  return ["none", "none", "none", "none", "none", "none", "none"];
}

/**
 * Whole calendar days between two instants, counted in the patient's zone.
 *
 * "Quiet for one day" has to mean "we did not hear from them yesterday", which
 * is a date-boundary question and not a duration one. Measuring in elapsed
 * hours reports 0 for a call that happened at 23:50 last night.
 */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const a = Date.parse(`${day(from)}T00:00:00Z`);
  const b = Date.parse(`${day(to)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Contact rate across the practice. Returns null when nothing is due yet, never 0. */
export function contactRate(rows: RosterRow[]): number | null {
  const due = rows.reduce((sum, r) => sum + r.due, 0);
  if (due === 0) return null;
  const contacted = rows.reduce((sum, r) => sum + r.contacted, 0);
  return contacted / due;
}
