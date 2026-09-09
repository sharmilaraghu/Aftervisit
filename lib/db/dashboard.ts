/**
 * The read behind Today — one row per patient, ordered by who needs a call back.
 *
 * The console used to answer this across seven queries and four panels, which
 * meant the answer to "who do I ring first?" was assembled by the reader. This
 * assembles it once, here, so the page is a rendering rather than a synthesis.
 *
 * Two rules from `queries.ts` still hold: never `select *` on `scheduled_calls`
 * (its transcript column is TOASTed jsonb), and never aggregate two child
 * tables in one join — hence the separate passes below rather than one clever
 * statement.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { getRoster, getQueue } from "@/lib/db/queries";
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

/** The model's last reading of a patient, whether or not it raised anything. */
interface LatestTriage {
  callId: string;
  verdict: string;
  /** One sentence a clinician reads before anything else. */
  summary: string | null;
  /** The doctor's own escalating conditions that this call touched, in their wording. */
  matchedConcerns: string[];
  quote: string | null;
  at: Date;
}

/**
 * The most recent triage per patient.
 *
 * Not the most recent *escalation*: a call the model read and cleared is still
 * a reading, and a page that only shows what was raised cannot tell "nothing
 * is wrong" from "nobody has listened yet". `distinct on` takes the latest in
 * one pass rather than a subquery per patient.
 */
async function getLatestTriage(): Promise<Map<string, LatestTriage>> {
  const db = getDb();
  const result = await db.execute(sql`
    select distinct on (t.patient_id)
           t.patient_id, t.call_id, t.verdict, t.summary,
           t.matched_concerns, t.quote, t.created_at
    from call_triage t
    order by t.patient_id, t.created_at desc
  `);

  const out = new Map<string, LatestTriage>();
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.patient_id), {
      callId: String(r.call_id),
      verdict: String(r.verdict),
      summary: r.summary ? String(r.summary) : null,
      matchedConcerns: Array.isArray(r.matched_concerns)
        ? (r.matched_concerns as unknown[]).map(String)
        : [],
      quote: r.quote ? String(r.quote) : null,
      at: new Date(String(r.created_at)),
    });
  }
  return out;
}

/** The last time we actually dialled, answered or not. */
interface LastCall {
  callId: string;
  at: Date;
  /** Null when the row finished without a mapped outcome. */
  outcome: string | null;
}

/**
 * The last call placed for each patient.
 *
 * Distinct from the roster's `lastHeard`, which is the last time somebody
 * *answered*. A patient dialled three times into silence has a recent last
 * call and no last heard, and the gap between those two is the thing this
 * product exists to make visible.
 */
async function getLastCalls(): Promise<Map<string, LastCall>> {
  const db = getDb();
  const result = await db.execute(sql`
    select distinct on (c.patient_id)
           c.patient_id, c.id, c.finished_at, c.outcome
    from scheduled_calls c
    where c.finished_at is not null
    order by c.patient_id, c.finished_at desc
  `);

  const out = new Map<string, LastCall>();
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.patient_id), {
      callId: String(r.id),
      at: new Date(String(r.finished_at)),
      outcome: r.outcome ? String(r.outcome) : null,
    });
  }
  return out;
}

/** Everything one line of Today prints. Assembled here, rendered there. */
export interface TodayRow {
  patientId: string;
  name: string;
  age: number;
  phoneE164: string;
  timezone: string;

  planId: string | null;
  planStatus: string | null;
  /** What this patient is being followed up for. */
  reason: string;
  health: PlanHealth;

  /** `severe | escalate | low`, or null when no call has been read yet. */
  severity: string | null;
  /** The model's one-line account of the last call. */
  severitySummary: string | null;
  /** Which of the doctor's own escalation notes the call touched. */
  matchedConcerns: string[];
  /** One line the patient actually said. Evidence, not summary. */
  quote: string | null;

  /** Set only while an escalation is open or acknowledged — what the actions act on. */
  escalationId: string | null;
  escalationStatus: string | null;
  /** Which floor rule raised it, when one did. */
  ruleLabel: string | null;
  pausedPlan: boolean;

  lastCallId: string | null;
  lastCallAt: Date | null;
  lastCallOutcome: string | null;
  /** Calendar days since anyone last answered, in the patient's own zone. */
  quietFor: number | null;

  nextCallAt: Date | null;
}

/*
 * Who to ring back first.
 *
 * Severity leads, because that is the question the page asks. Underneath it,
 * a patient nothing has been said about yet is ranked by the state of their
 * plan rather than dropped to the bottom: never reached and needs-a-plan are
 * silences, and a silence nobody has looked at outranks a call the model has
 * already cleared.
 */
const SEVERITY_RANK: Record<string, number> = { severe: 0, escalate: 2, low: 5 };
const HEALTH_RANK: Record<PlanHealth, number> = {
  escalated: 1,
  never_reached: 3,
  drifting: 3,
  needs_plan: 4,
  awaiting_approval: 4,
  paused: 4,
  on_track: 6,
  completed: 7,
};

/**
 * Every patient, ordered by who needs a call back now.
 *
 * Every patient, not every escalation — a patient nobody has managed to reach
 * has no escalation to their name and is exactly who this page must not lose.
 */
export async function getToday(): Promise<TodayRow[]> {
  const [roster, queue, triage, lastCalls, progress] = await Promise.all([
    getRoster(),
    getQueue(),
    getLatestTriage(),
    getLastCalls(),
    getPlanProgress(),
  ]);

  /* The newest open escalation per patient. `getQueue` already returns them in
     the order the queue reads, so the first one seen is the one that matters. */
  const open = new Map<string, (typeof queue)[number]>();
  for (const q of queue) if (!open.has(q.patientId)) open.set(q.patientId, q);

  const rows: TodayRow[] = roster.map((p) => {
    const t = triage.get(p.patientId);
    const e = open.get(p.patientId);
    const last = lastCalls.get(p.patientId);
    const next = p.planId ? progress.get(p.planId) : undefined;

    return {
      patientId: p.patientId,
      name: p.name,
      age: p.age,
      phoneE164: p.phoneE164,
      timezone: p.timezone,

      planId: p.planId,
      planStatus: p.planStatus,
      reason: p.reason,
      health: p.health,

      /* The escalation's copy wins when there is one: it is the verdict that
         actually routed this patient to a human, and the triage row may have
         moved on since. */
      severity: e?.severity ?? t?.verdict ?? null,
      severitySummary: e?.summary ?? t?.summary ?? null,
      matchedConcerns: t?.matchedConcerns ?? [],
      quote: e?.utterance ?? t?.quote ?? null,

      escalationId: e?.id ?? null,
      escalationStatus: e?.status ?? null,
      ruleLabel: e?.ruleLabel ?? null,
      pausedPlan: e?.pausedPlan ?? false,

      lastCallId: last?.callId ?? e?.callId ?? t?.callId ?? null,
      lastCallAt: last?.at ?? null,
      lastCallOutcome: last?.outcome ?? null,
      quietFor: p.quietFor,

      nextCallAt: next?.scheduledFor ?? null,
    };
  });

  return rows.sort((a, b) => {
    const ra = a.severity ? SEVERITY_RANK[a.severity] ?? 5 : HEALTH_RANK[a.health];
    const rb = b.severity ? SEVERITY_RANK[b.severity] ?? 5 : HEALTH_RANK[b.health];
    if (ra !== rb) return ra - rb;
    /* Longest silence first inside a band, then by name so the order is total
       and a re-render never reshuffles two equal rows under the cursor. */
    const qa = a.quietFor ?? -1;
    const qb = b.quietFor ?? -1;
    if (qa !== qb) return qb - qa;
    return a.name.localeCompare(b.name) || a.patientId.localeCompare(b.patientId);
  });
}
