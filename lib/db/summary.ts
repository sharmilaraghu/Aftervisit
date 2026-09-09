/**
 * What a doctor should know before they read anything else on this page.
 *
 * The patient file opened with a week band, a grid of answers and a table of
 * calls — every one of them a thing to interpret, and none of them an answer.
 * A clinician arriving cold had to reconstruct "how is she doing?" from three
 * tables. This is that sentence, assembled.
 *
 * **Assembled, never generated.** Every figure here is counted from rows that
 * already exist, so it renders identically with no API key configured, cannot
 * hallucinate, and never speaks as a clinician. The model's own account of each
 * call is quoted alongside it and attributed to the assistant — the product
 * does not put words in a doctor's mouth, and it does not put a clinical
 * judgement in its own.
 *
 * **It crosses plans on purpose.** `extracted_slots` carries a denormalised
 * `patient_id` and `idx_slots_patient_q` exists precisely so answers survive a
 * plan being superseded; `idx_esc_patient`, `idx_triage_patient` and
 * `idx_notes_patient` were all built for reads nothing performed. A second
 * course of treatment used to hide everything the first one learned.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";

export interface PatientSummary {
  /** Courses of treatment, newest first — what they have been followed for. */
  courses: {
    planId: string;
    reason: string;
    status: string;
    closeReason: string | null;
    /** How the clinician said it resolved. Null unless they closed it themselves. */
    closingSummary: string | null;
    startsAt: Date | null;
    closedAt: Date | null;
    calls: number;
    reached: number;
  }[];
  /** Every escalation ever raised for this patient, newest first. */
  escalations: {
    id: string;
    ref: number;
    ruleLabel: string;
    severity: string | null;
    summary: string | null;
    urgent: boolean;
    status: string;
    resolution: string | null;
    resolutionNote: string | null;
    raisedAt: Date;
    callId: string | null;
  }[];
  /** The assistant's account of each finished call, newest first. */
  readings: {
    callId: string;
    verdict: string;
    status: string;
    summary: string | null;
    matchedConcerns: string[];
    createdAt: Date;
  }[];
  /** Every note ever written about this patient, newest first. */
  notes: { id: string; body: string; escalationNote: string | null; createdAt: Date }[];
  totals: {
    calls: number;
    reached: number;
    /** Calls where the patient raised something no question covered. */
    raisedSomething: number;
    openEscalations: number;
  };
}

export async function getPatientSummary(patientId: string): Promise<PatientSummary> {
  const db = getDb();

  const [courses, escalations, readings, notes, totals] = await Promise.all([
    db.execute(sql`
      select p.id, p.reason, p.status, p.close_reason, p.closing_summary,
             p.starts_at, p.closed_at,
             count(c.*) filter (where c.finished_at is not null) as calls,
             count(distinct c.occurrence) filter (
               where c.outcome in ('answered','flagged','unmappable')
             ) as reached
      from follow_up_plans p
      left join scheduled_calls c on c.plan_id = p.id
      where p.patient_id = ${patientId} and p.status <> 'cancelled'
      group by p.id
      order by p.created_at desc
    `),
    db.execute(sql`
      select id, ref, rule_label, severity, summary, urgent, status,
             resolution, resolution_note, raised_at, call_id
      from escalations where patient_id = ${patientId}
      order by raised_at desc limit 20
    `),
    db.execute(sql`
      select call_id, verdict, status, summary, matched_concerns, created_at
      from call_triage where patient_id = ${patientId}
      order by created_at desc limit 20
    `),
    db.execute(sql`
      select id, body, escalation_note, created_at
      from consultation_notes where patient_id = ${patientId}
      order by created_at desc
    `),
    db.execute(sql`
      select
        count(*) filter (where finished_at is not null)                       as calls,
        count(distinct occurrence) filter (
          where outcome in ('answered','flagged','unmappable')
        )                                                                     as reached,
        (select count(*) from extracted_slots s
          where s.patient_id = ${patientId}
            and s.question_id = 'something_else_raised'
            and s.value_bool)                                                 as raised_something,
        (select count(*) from escalations e
          where e.patient_id = ${patientId} and e.status in ('open','acknowledged'))
                                                                              as open_escalations
      from scheduled_calls where patient_id = ${patientId}
    `),
  ]);

  const t = (totals.rows as Record<string, unknown>[])[0] ?? {};

  return {
    courses: (courses.rows as Record<string, unknown>[]).map((r) => ({
      planId: String(r.id),
      reason: String(r.reason),
      status: String(r.status),
      closeReason: r.close_reason ? String(r.close_reason) : null,
      closingSummary: r.closing_summary ? String(r.closing_summary) : null,
      startsAt: r.starts_at ? new Date(String(r.starts_at)) : null,
      closedAt: r.closed_at ? new Date(String(r.closed_at)) : null,
      calls: Number(r.calls),
      reached: Number(r.reached),
    })),
    escalations: (escalations.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      ref: Number(r.ref),
      ruleLabel: String(r.rule_label),
      severity: r.severity ? String(r.severity) : null,
      summary: r.summary ? String(r.summary) : null,
      urgent: Boolean(r.urgent),
      status: String(r.status),
      resolution: r.resolution ? String(r.resolution) : null,
      resolutionNote: r.resolution_note ? String(r.resolution_note) : null,
      raisedAt: new Date(String(r.raised_at)),
      callId: r.call_id ? String(r.call_id) : null,
    })),
    readings: (readings.rows as Record<string, unknown>[]).map((r) => ({
      callId: String(r.call_id),
      verdict: String(r.verdict),
      status: String(r.status),
      summary: r.summary ? String(r.summary) : null,
      matchedConcerns: (r.matched_concerns ?? []) as string[],
      createdAt: new Date(String(r.created_at)),
    })),
    notes: (notes.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      body: String(r.body),
      escalationNote: r.escalation_note ? String(r.escalation_note) : null,
      createdAt: new Date(String(r.created_at)),
    })),
    totals: {
      calls: Number(t.calls ?? 0),
      reached: Number(t.reached ?? 0),
      raisedSomething: Number(t.raised_something ?? 0),
      openEscalations: Number(t.open_escalations ?? 0),
    },
  };
}
