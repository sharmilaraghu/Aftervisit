/**
 * The read behind Follow-ups — one row per patient on a plan, by how they are.
 *
 * The doctor's view is condition, not logistics. This read used to return the
 * call ladder — attempts, failure codes, next call, "quiet for" — and the page
 * printed all of it, so the question "how is she?" was answered with a
 * schedule. Those facts still exist on the patient record's Calls panel; they
 * are simply not the doctor's first screen. The one silence that matters —
 * nobody reached — survives here as a status, not as a timetable.
 *
 * No phone number reaches this row, except as `emergencyPhone` on a patient who
 * needs attention now: the doctor must be able to ring them, and nobody else.
 *
 * Two rules from `queries.ts` still hold: never `select *` on `scheduled_calls`
 * (its transcript column is TOASTed jsonb), and never aggregate two child
 * tables in one join — hence the separate passes below.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { getRoster, getQueue } from "@/lib/db/queries";
import {
  clinicalStatus,
  statusReason,
  type ClinicalStatus,
  type StatusInput,
} from "@/lib/triage/status";
import type { PlanHealth } from "@/lib/db/enums";

export interface NextCall {
  planId: string;
  patientId: string;
  /** Null when the plan has nothing left scheduled. */
  scheduledFor: Date | null;
  /** 1-based position of that call in the plan's window. */
  occurrence: number;
  /** Total occurrences in the window, so progress reads "call 3 of 7". */
  total: number;
  done: number;
}

/**
 * Where each active plan has got to, and when it next rings.
 *
 * One query for every plan rather than one per row: a roster of forty patients
 * must not become forty round trips.
 */
export async function getPlanProgress(): Promise<Map<string, NextCall>> {
  const db = getDb();
  const result = await db.execute(sql`
    select c.plan_id,
           max(c.patient_id)                                              as patient_id,
           count(distinct c.occurrence)                                   as total,
           count(distinct c.occurrence) filter (
             where c.status in ('done', 'skipped')
           )                                                              as done,
           min(c.scheduled_for) filter (where c.status = 'scheduled')     as next_at,
           min(c.occurrence)    filter (where c.status = 'scheduled')     as next_occurrence
    from scheduled_calls c
    join follow_up_plans p on p.id = c.plan_id
    where p.status in ('active', 'paused')
      -- Progress through the plan's days; a try is an extra call on top of them.
      and c.kind = 'planned'
    group by c.plan_id
  `);

  const out = new Map<string, NextCall>();
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.plan_id), {
      planId: String(r.plan_id),
      patientId: String(r.patient_id),
      scheduledFor: r.next_at ? new Date(String(r.next_at)) : null,
      occurrence: Number(r.next_occurrence ?? 0),
      total: Number(r.total ?? 0),
      done: Number(r.done ?? 0),
    });
  }
  return out;
}

/** The model's last reading on a plan, whether or not it raised anything. */
interface LatestTriage {
  callId: string;
  /** `ok`, or how the reading failed — a failed one fails closed and says so. */
  status: string;
  verdict: string;
  /** Whether that call reached the patient — a low reading of silence is not "no concerns". */
  reached: boolean;
  matchedConcerns: string[];
  quote: string | null;
}

/**
 * The most recent triage per plan.
 *
 * Per plan, not per patient: a returning patient's new follow-up must not be
 * read through the last episode's verdict. `distinct on` takes the latest in
 * one pass.
 */
async function getLatestTriage(): Promise<Map<string, LatestTriage>> {
  const db = getDb();
  const result = await db.execute(sql`
    select distinct on (t.plan_id)
           t.plan_id, t.call_id, t.status, t.verdict, t.matched_concerns, t.quote,
           coalesce(c.outcome in ('answered', 'flagged', 'unmappable'), false) as reached
    from call_triage t
    left join scheduled_calls c on c.id = t.call_id
    order by t.plan_id, t.created_at desc
  `);

  const out = new Map<string, LatestTriage>();
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.plan_id), {
      callId: String(r.call_id),
      status: String(r.status),
      verdict: String(r.verdict),
      reached: Boolean(r.reached),
      matchedConcerns: Array.isArray(r.matched_concerns)
        ? (r.matched_concerns as unknown[]).map(String)
        : [],
      quote: r.quote ? String(r.quote) : null,
    });
  }
  return out;
}

interface PlanFacts {
  conditionSummary: string | null;
  conditionSummaryAt: Date | null;
  /** Completed because the window ran out, and no closing note written. */
  finishedUnclosed: boolean;
}

async function getPlanFacts(planIds: string[]): Promise<Map<string, PlanFacts>> {
  const out = new Map<string, PlanFacts>();
  if (planIds.length === 0) return out;
  const result = await getDb().execute(sql`
    select id, condition_summary, condition_summary_at,
           (status = 'completed' and close_reason = 'duration_elapsed'
            and closing_summary is null) as finished_unclosed
    from follow_up_plans
    where id in (${sql.join(
      planIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.id), {
      conditionSummary: r.condition_summary ? String(r.condition_summary) : null,
      conditionSummaryAt: r.condition_summary_at ? new Date(String(r.condition_summary_at)) : null,
      finishedUnclosed: Boolean(r.finished_unclosed),
    });
  }
  return out;
}

/** Everything one line of Follow-ups prints. Assembled here, rendered there. */
export interface TodayRow {
  patientId: string;
  name: string;
  age: number;
  /** For dating the condition summary in the patient's own zone. */
  timezone: string;

  planId: string;
  planStatus: string | null;
  /** What this patient is being followed up for. */
  reason: string;
  health: PlanHealth;

  status: ClinicalStatus;
  /** Why, as a fact about the patient — never a schedule line. */
  statusReason: string;

  /** How they are doing, from the last call triage could read. */
  conditionSummary: string | null;
  conditionSummaryAt: Date | null;
  /** The latest call could not be read. The summary above is older than it. */
  summaryUnavailable: boolean;
  /** Which of the doctor's own escalation notes the last call touched. */
  matchedConcerns: string[];
  /** One line the patient actually said. Evidence, not summary. */
  quote: string | null;

  /** Set only while an escalation is open or acknowledged — what the actions act on. */
  escalationId: string | null;
  escalationStatus: string | null;
  pausedPlan: boolean;

  /** The call to read, when there is one. */
  lastCallId: string | null;
  /**
   * The patient's number, only while they need attention: the doctor must be
   * able to ring a patient in trouble, and this view prints no number for
   * anyone else. It is a `tel:` target, never displayed text.
   */
  emergencyPhone: string | null;
}

/* Who the doctor should look at first. */
const STATUS_RANK: Record<ClinicalStatus, number> = {
  needs_attention: 0,
  finished: 1,
  no_word_yet: 2,
  no_concerns: 3,
};

export interface Today {
  rows: TodayRow[];
  /**
   * Escalations a clinician settled today. A count, not a list: it is there so
   * a cleared board reads as work done rather than as an empty screen.
   */
  clearedToday: number;
}

export async function getToday(): Promise<Today> {
  const db = getDb();
  const [roster, queue, triage, cleared] = await Promise.all([
    getRoster(),
    getQueue(),
    getLatestTriage(),
    db.execute(sql`
      select count(*) as n from escalations
      where status = 'resolved' and resolved_at >= date_trunc('day', now())
    `),
  ]);

  /* A patient with no plan has nothing to follow up yet — they are on
     Consults, waiting for a note. */
  const onPlan = roster.filter((p): p is typeof p & { planId: string } => p.planId !== null);
  const facts = await getPlanFacts(onPlan.map((p) => p.planId));

  /* The newest open escalation per patient. `getQueue` already returns them in
     the order the queue reads, so the first one seen is the one that matters. */
  const open = new Map<string, (typeof queue)[number]>();
  for (const q of queue) if (!open.has(q.patientId)) open.set(q.patientId, q);

  const rows: TodayRow[] = onPlan.map((p) => {
    const t = triage.get(p.planId);
    const e = open.get(p.patientId);
    const f = facts.get(p.planId);

    const input: StatusInput = {
      planStatus: p.planStatus,
      health: p.health,
      escalationOpen: Boolean(e),
      escalationLabel: e?.ruleLabel ?? null,
      latestVerdict: t?.verdict ?? null,
      latestReached: t?.reached ?? false,
      finishedUnclosed: f?.finishedUnclosed ?? false,
      quietFor: p.quietFor,
    };
    const status = clinicalStatus(input);

    return {
      patientId: p.patientId,
      name: p.name,
      age: p.age,
      timezone: p.timezone,

      planId: p.planId,
      planStatus: p.planStatus,
      reason: p.reason,
      health: p.health,

      status,
      statusReason: statusReason(input, status),

      conditionSummary: f?.conditionSummary ?? null,
      conditionSummaryAt: f?.conditionSummaryAt ?? null,
      summaryUnavailable: t ? t.status !== "ok" : false,
      matchedConcerns: t?.matchedConcerns ?? [],
      /* The escalation's words win when there is one: it is what actually
         routed this patient to a human. */
      quote: e?.utterance ?? t?.quote ?? null,

      escalationId: e?.id ?? null,
      escalationStatus: e?.status ?? null,
      pausedPlan: e?.pausedPlan ?? false,

      lastCallId: e?.callId ?? t?.callId ?? null,
      emergencyPhone: status === "needs_attention" ? p.phoneE164 : null,
    };
  });

  /*
   * A closed file leaves the board. A plan that finished and is still
   * unclosed stays — "close or restart" is the doctor's to decide — and so
   * does anything that needs attention, finished or not.
   */
  const live = rows.filter(
    (r) =>
      r.status === "needs_attention" ||
      r.status === "finished" ||
      !["completed", "cancelled"].includes(r.planStatus ?? ""),
  );

  /*
   * Within a status, the most urgent first: a plan an urgent finding paused,
   * then any open escalation, then a silence. Alphabetical put a patient not
   * heard from in four days above one who could not keep water down.
   */
  live.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Number(b.pausedPlan) - Number(a.pausedPlan) ||
      Number(Boolean(b.escalationId)) - Number(Boolean(a.escalationId)) ||
      a.name.localeCompare(b.name) ||
      a.patientId.localeCompare(b.patientId),
  );

  return {
    rows: live,
    clearedToday: Number((cleared.rows as Record<string, unknown>[])[0]?.n ?? 0),
  };
}

export interface ClosedCourse {
  planId: string;
  patientId: string;
  name: string;
  age: number;
  timezone: string;
  reason: string;
  closedAt: Date;
  /** How it resolved, in the doctor's words. Only closed files with one are listed. */
  closingSummary: string;
}

/**
 * Follow-ups the doctor closed in the last week, for the foot of Follow-ups.
 *
 * A closed file still leaves the board above. This is only so the page can
 * answer "what did we finish this week?" without opening every patient. A
 * patient already on a new follow-up is on the board, so they are not repeated.
 */
export async function getRecentlyClosed(days = 7): Promise<ClosedCourse[]> {
  const result = await getDb().execute(sql`
    select p.id as plan_id, pt.id as patient_id, pt.name, pt.age, pt.timezone,
           coalesce(p.reason, 'Follow-up') as reason, p.closed_at, p.closing_summary
    from follow_up_plans p
    join patients pt on pt.id = p.patient_id
    where p.status = 'completed'
      and p.closing_summary is not null
      and p.closed_at >= now() - make_interval(days => ${days}::int)
      and pt.archived_at is null
      and not exists (
        select 1 from follow_up_plans live
        where live.patient_id = p.patient_id
          and live.status in ('active', 'paused', 'awaiting_approval')
      )
    order by p.closed_at desc
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => ({
    planId: String(r.plan_id),
    patientId: String(r.patient_id),
    name: String(r.name),
    age: Number(r.age),
    timezone: String(r.timezone),
    reason: String(r.reason),
    closedAt: new Date(String(r.closed_at)),
    closingSummary: String(r.closing_summary),
  }));
}
