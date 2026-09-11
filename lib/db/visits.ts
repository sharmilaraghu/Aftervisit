/**
 * Visits: what the front desk booked, and whether the doctor has got to it.
 *
 * A visit is the seam between the two roles. Registration writes one ahead of
 * time; the consult list is every visit still `waiting`; writing the note
 * flips it to `seen` in the same statement that attaches the note, so the two
 * facts cannot disagree. There is no transaction to lean on, so that statement
 * carries its own precondition and returns zero rows when another tab won.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/ids";
import { visits } from "@/lib/db/schema";
import type { ConsentState, VisitKind, VisitStatus } from "@/lib/db/enums";

export interface VisitInput {
  patientId: string;
  kind: VisitKind;
  /** A calendar day, `YYYY-MM-DD`, in the patient's own zone. */
  visitDate: string;
  reportedSymptoms: string;
}

export async function createVisit(input: VisitInput): Promise<string> {
  const db = getDb();
  const id = newId("vis");
  await db.insert(visits).values({
    id,
    patientId: input.patientId,
    kind: input.kind,
    visitDate: input.visitDate,
    reportedSymptoms: input.reportedSymptoms,
  });
  return id;
}

/** One row of the consult list: the visit and enough of the patient to open it. */
export interface WaitingVisit {
  id: string;
  kind: VisitKind;
  visitDate: string;
  reportedSymptoms: string;
  createdAt: Date;
  patientId: string;
  patientName: string;
  age: number;
  /* No phone number. Visits are read for the doctor's screens, which never
     dial; the front desk reads the number from the patient record. */
  timezone: string;
  language: string;
  consent: ConsentState;
}

const VISIT_COLUMNS = sql`
  v.id,
  v.kind,
  v.visit_date::text as "visitDate",
  v.reported_symptoms as "reportedSymptoms",
  v.created_at as "createdAt",
  v.status,
  v.note_id as "noteId",
  pt.id as "patientId",
  pt.name as "patientName",
  pt.age,
  pt.timezone,
  pt.language,
  pt.ai_call_consent as consent
`;

/**
 * Everyone still waiting, oldest booking first.
 *
 * Archived patients drop out here rather than in the UI: a visit for someone
 * who no longer exists is not a visit anyone can take.
 */
export async function getWaitingVisits(): Promise<WaitingVisit[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    select ${VISIT_COLUMNS}
    from visits v
    join patients pt on pt.id = v.patient_id
    where v.status = 'waiting' and pt.archived_at is null
    order by v.visit_date, v.created_at
  `);
  return rows.rows as unknown as WaitingVisit[];
}

/** A visit the doctor has already written up, with the plan it produced. */
export interface SeenVisit extends WaitingVisit {
  planId: string | null;
}

/**
 * The visits booked for `day` that have been seen — the other half of the
 * doctor's day, so the list shows progress rather than only what is left.
 */
export async function getSeenVisitsOn(day: string): Promise<SeenVisit[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    select ${VISIT_COLUMNS},
      (
        select p.id from follow_up_plans p
        where p.note_id = v.note_id
        order by p.created_at desc
        limit 1
      ) as "planId"
    from visits v
    join patients pt on pt.id = v.patient_id
    where v.status = 'seen' and v.visit_date = ${day}::date and pt.archived_at is null
    order by v.seen_at desc
  `);
  return rows.rows as unknown as SeenVisit[];
}

export interface VisitDetail extends WaitingVisit {
  status: VisitStatus;
  noteId: string | null;
  /** The newest plan compiled from this visit's note, once there is one. */
  planId: string | null;
  patientArchived: boolean;
}

export async function getVisit(id: string): Promise<VisitDetail | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    select ${VISIT_COLUMNS},
      pt.archived_at is not null as "patientArchived",
      (
        select p.id from follow_up_plans p
        where p.note_id = v.note_id
        order by p.created_at desc
        limit 1
      ) as "planId"
    from visits v
    join patients pt on pt.id = v.patient_id
    where v.id = ${id}
  `);
  return (rows.rows[0] as unknown as VisitDetail | undefined) ?? null;
}

/**
 * The doctor has written the note: attach it and take the visit off the list.
 *
 * One statement, so `seen` and `note_id` land together or not at all. The
 * note id is read off the plan rather than passed in, which keeps
 * `createPlanFromNote`'s contract untouched. Zero rows back means the visit
 * was no longer `waiting` — another tab got there first — and the caller
 * decides what to do with the draft it just made.
 */
export async function markVisitSeen(visitId: string, planId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute(sql`
    update visits v
    set status = 'seen', seen_at = now(), note_id = p.note_id
    from follow_up_plans p
    where p.id = ${planId} and v.id = ${visitId} and v.status = 'waiting'
    returning v.id
  `);
  return rows.rows.length > 0;
}
