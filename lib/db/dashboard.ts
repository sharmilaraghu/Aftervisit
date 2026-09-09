/**
 * Reads that only the overview needs.
 *
 * Kept out of `queries.ts` because they answer a different question. The roster
 * asks "what state is each patient in"; these ask "what has this practice been
 * doing today" — a shift summary rather than a clinical judgement.
 *
 * Both rules from `queries.ts` still hold: never `select *` on `scheduled_calls`
 * (its transcript column is TOASTed jsonb), and never aggregate two child tables
 * in one join.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";

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

export interface PatientPhrase {
  patientId: string;
  /** The patient's own words, verbatim. Never a summary of them. */
  text: string;
  at: Date;
  /** True when this phrase is what a rule fired on. */
  flagged: boolean;
}

/**
 * The last thing each patient actually said.
 *
 * This is the column a clinician reads. "Next call" told them when the
 * scheduler would act, which is the machine reporting on itself; a verbatim
 * sentence is the evidence they would have gathered by picking up the phone.
 *
 * Two sources, because a phrase matters whether or not a rule fired on it: the
 * utterance stored on an escalation, and free-text answers extracted from a
 * call. `distinct on` keeps the most recent per patient in one pass.
 */
export async function getLatestPhrases(): Promise<Map<string, PatientPhrase>> {
  const db = getDb();
  const result = await db.execute(sql`
    select distinct on (patient_id) patient_id, text, at, flagged
    from (
      select e.patient_id, e.utterance as text, e.raised_at as at, true as flagged
      from escalations e
      where e.utterance is not null and length(trim(e.utterance)) > 0

      union all

      -- Free text only. value_text also carries the chosen option of an enum
      -- answer, and a cell reading "severe" or "none" is not the patient
      -- speaking, it is our own answer set played back. Anything shorter than
      -- this is a slot value rather than a sentence.
      select c.patient_id, s.value_text as text, c.finished_at as at, false as flagged
      from extracted_slots s
      join scheduled_calls c on c.id = s.call_id
      where s.value_text is not null and length(trim(s.value_text)) > 24
        and c.finished_at is not null
    ) said
    order by patient_id, at desc
  `);

  const out = new Map<string, PatientPhrase>();
  for (const r of result.rows as Record<string, unknown>[]) {
    out.set(String(r.patient_id), {
      patientId: String(r.patient_id),
      text: String(r.text),
      at: new Date(String(r.at)),
      flagged: Boolean(r.flagged),
    });
  }
  return out;
}

export type ActivityKind = "answered" | "no_answer" | "escalation" | "approved";

export interface ActivityItem {
  kind: ActivityKind;
  at: Date;
  patientId: string;
  patientName: string;
  /** One line, already written for a human — no ids, no rule slugs. */
  detail: string;
  href: string;
}

/**
 * The shift log: what the agent actually did, most recent first.
 *
 * Three sources unioned in SQL rather than three round trips merged in TS. It
 * is deliberately a record of *events*, not of state — a doctor coming back
 * after lunch wants to know what happened while they were gone, and the roster
 * above it already says where things stand now.
 */
export async function getActivity(limit = 8): Promise<ActivityItem[]> {
  const db = getDb();
  const result = await db.execute(sql`
    (
      select case when c.outcome in ('answered','flagged','unmappable')
                  then 'answered' else 'no_answer' end                as kind,
             c.finished_at                                            as at,
             c.patient_id, pt.name as patient_name,
             c.id                                                     as ref,
             c.outcome                                                as extra
      from scheduled_calls c
      join patients pt on pt.id = c.patient_id
      where c.finished_at is not null
      order by c.finished_at desc
      limit ${limit}
    )
    union all
    (
      select 'escalation' as kind, e.raised_at as at,
             e.patient_id, pt.name as patient_name,
             e.plan_id as ref, e.rule_label as extra
      from escalations e
      join patients pt on pt.id = e.patient_id
      order by e.raised_at desc
      limit ${limit}
    )
    union all
    (
      select 'approved' as kind, p.approved_at as at,
             p.patient_id, pt.name as patient_name,
             p.id as ref, p.reason as extra
      from follow_up_plans p
      join patients pt on pt.id = p.patient_id
      where p.approved_at is not null
      order by p.approved_at desc
      limit ${limit}
    )
    order by at desc
    limit ${limit}
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => {
    const kind = String(r.kind) as ActivityKind;
    const name = String(r.patient_name);
    const extra = String(r.extra ?? "");
    return {
      kind,
      at: new Date(String(r.at)),
      patientId: String(r.patient_id),
      patientName: name,
      detail:
        kind === "answered"
          ? `Call completed with ${name}`
          : kind === "no_answer"
            ? `No answer from ${name}`
            : kind === "escalation"
              ? `Escalation raised for ${name} — ${extra.toLowerCase()}`
              : `Plan approved for ${name}`,
      href:
        kind === "answered" || kind === "no_answer"
          ? `/calls/${String(r.ref)}`
          : kind === "approved"
            ? `/plans/${String(r.ref)}`
            : `/patients/${String(r.patient_id)}`,
    };
  });
}

/** Calls that reached a human in the last seven days, and how many were tried. */
export async function getWeekSummary(): Promise<{ reached: number; attempted: number }> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      count(*) filter (where outcome in ('answered','flagged','unmappable')) as reached,
      count(*)                                                              as attempted
    from scheduled_calls
    where finished_at is not null and finished_at > now() - interval '7 days'
  `);
  const r = (result.rows as Record<string, unknown>[])[0] ?? {};
  return { reached: Number(r.reached ?? 0), attempted: Number(r.attempted ?? 0) };
}

/**
 * The practice's last fourteen days, one column per day.
 *
 * This is the only aggregate on the console that a table cannot say. Fourteen
 * rows of "answered 4, flagged 1, no answer 0" is a list a doctor has to read
 * and difference in their head; the same fourteen columns show, at a glance,
 * the shape that matters — a band that was green all week and turned amber on
 * Monday means something broke on Monday, and that is a systemic fact about the
 * practice rather than about any one patient.
 *
 * Deliberately outcomes, not a rate. A percentage hides how many calls it is a
 * percentage of, and a single unanswered call out of one reads as 0%.
 *
 * `date_trunc` in the *server's* zone, not each patient's: this is one practice
 * looking at its own working days, and fourteen columns cannot be in fourteen
 * timezones at once. The per-patient views are the ones that owe a patient their
 * own clock.
 */
export interface DayColumn {
  day: string;
  answered: number;
  flagged: number;
  missed: number;
}

export async function getFortnight(): Promise<DayColumn[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      to_char(date_trunc('day', finished_at), 'YYYY-MM-DD') as day,
      count(*) filter (where outcome = 'answered')                     as answered,
      count(*) filter (where outcome = 'flagged')                      as flagged,
      count(*) filter (where outcome in ('no_answer','refused','unmappable')) as missed
    from scheduled_calls
    where finished_at is not null
      and finished_at > date_trunc('day', now()) - interval '13 days'
    group by 1
    order by 1
  `);
  const byDay = new Map<string, DayColumn>();
  for (const r of result.rows as Record<string, unknown>[]) {
    byDay.set(String(r.day), {
      day: String(r.day),
      answered: Number(r.answered ?? 0),
      flagged: Number(r.flagged ?? 0),
      missed: Number(r.missed ?? 0),
    });
  }

  /* Every one of the fourteen days is emitted, including the empty ones. A
     chart that silently drops a day with no calls closes the gap it should be
     showing — a quiet Sunday and a Sunday the scheduler never ran look
     identical once the column is missing. */
  const out: DayColumn[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(byDay.get(key) ?? { day: key, answered: 0, flagged: 0, missed: 0 });
  }
  return out;
}
