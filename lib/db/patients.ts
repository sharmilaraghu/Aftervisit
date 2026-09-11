/**
 * Patient reads and writes.
 *
 * The writes are the first mutations in the codebase, so they set the pattern
 * the scheduler will follow: every one is a single statement whose `WHERE`
 * clause carries the precondition, and the caller decides what to do when zero
 * rows come back. There is no transaction to fall back on.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/ids";
import { patients, type Patient } from "@/lib/db/schema";
import type { ConsentState, DayState } from "@/lib/db/enums";
import { deriveHealth, getWeekBands, calendarDaysBetween } from "@/lib/db/queries";
import type { PlanHealth } from "@/lib/db/enums";

export interface PatientInput {
  name: string;
  age: number;
  /** Already E.164. Callers normalize first; this layer does not guess. */
  phoneE164: string;
  timezone: string;
  /** BCP 47 tag; what the agent speaks on the call. Validated by the form layer. */
  language: string;
  aiCallConsent: ConsentState;
}

export async function getPatient(id: string): Promise<Patient | null> {
  const db = getDb();
  const rows = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface PatientDetail {
  patient: Patient;
  planId: string | null;
  planStatus: string | null;
  /** Why a paused plan is paused. Written at pause time and, until now, never read. */
  pausedReason: string | null;
  /** Every earlier plan for this patient, newest first. A treatment record,
      rather than one mutable plan that forgets what it used to be about. */
  priorPlans: {
    id: string;
    reason: string;
    status: string;
    closeReason: string | null;
    startsAt: Date | null;
    closedAt: Date | null;
  }[];
  reason: string | null;
  condition: string | null;
  localTime: string | null;
  durationDays: number | null;
  maxAttempts: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  due: number;
  contacted: number;
  lastHeard: Date | null;
  quietFor: number | null;
  urgentOpen: number;
  openTotal: number;
  week: DayState[];
  health: PlanHealth | null;
  noteBody: string | null;
  calls: PatientCallRow[];
  quality: CallQuality;
}

/**
 * How well the *agent* is doing, as distinct from how the patient is doing.
 *
 * These are the honest transcript-derived numbers: each is a count of something
 * that either happened or did not, over a window small enough to state plainly.
 * Nothing here is averaged or trended — seven self-reported data points do not
 * support either, and naming one a trend would invite a clinical reading the
 * data cannot carry.
 */
export interface CallQuality {
  /** Answers that could not be mapped, or were never given. */
  unclear: number;
  slots: number;
  /** Calls where CALL-E reported it finished the task it was given. */
  taskCompleted: number;
  taskJudged: number;
  /** Calls where the patient raised something no question covered. */
  raisedSomething: number;
  answered: number;
}

export interface PatientCallRow {
  id: string;
  occurrence: number;
  attempt: number;
  scheduledFor: Date;
  status: string;
  outcome: string | null;
  failureCode: string | null;
  finishedAt: Date | null;
  summary: string | null;
  /**
   * CALL-E's one-line recap in the patient's own words.
   *
   * Extracted on every call and, until now, read nowhere in the application —
   * the single most useful column was missing from the table that lists calls.
   */
  recap: string | null;
  /** What they raised that no question covered, when they raised something. */
  whatElse: string | null;
}

/**
 * One patient, with their current plan and its calls.
 *
 * Note the explicit column list on `scheduled_calls`: `transcript` and
 * `calle_raw` are TOASTed jsonb and a `select *` here would pull the entire
 * call history's payloads to render a summary table.
 */
export async function getPatientDetail(id: string): Promise<PatientDetail | null> {
  const db = getDb();
  const patient = await getPatient(id);
  if (!patient) return null;

  const planRows = await db.execute(sql`
    select p.id, p.status, p.reason, p.condition, p.local_time, p.duration_days,
           p.max_attempts, p.starts_at, p.ends_at, p.paused_reason, n.body as note_body,
      count(c.*) filter (
        where c.attempt = 1 and c.scheduled_for <= now() and c.status <> 'skipped'
      ) as due,
      count(distinct c.occurrence) filter (
        where c.outcome in ('answered','flagged','unmappable')
      ) as contacted,
      max(c.finished_at) filter (
        where c.outcome in ('answered','flagged','unmappable')
      ) as last_heard,
      (select count(*) from escalations e
        where e.plan_id = p.id and e.status in ('open','acknowledged') and e.urgent) as urgent_open,
      (select count(*) from escalations e
        where e.plan_id = p.id and e.status in ('open','acknowledged')) as open_total
    from follow_up_plans p
    join consultation_notes n on n.id = p.note_id
    left join scheduled_calls c on c.plan_id = p.id
    where p.patient_id = ${id} and p.status <> 'cancelled'
    group by p.id, n.body
    order by p.created_at desc
    limit 1
  `);

  const plan = (planRows.rows as Record<string, unknown>[])[0];

  /*
   * Every plan except the one on screen.
   *
   * The detail page used to select a single plan and stop, so a superseded
   * plan's calls vanished from the console entirely — the rows were retained
   * and the result schema was frozen at approval precisely so they would stay
   * readable, and nothing ever read them. A course of treatment is a sequence,
   * and this is the only place it can be seen as one.
   */
  const priorRows = await db.execute(sql`
    select id, reason, status, close_reason, starts_at, closed_at
    from follow_up_plans
    where patient_id = ${id} and status <> 'cancelled'
      and id <> ${plan ? String(plan.id) : ""}
    order by created_at desc
  `);
  const priorPlans = (priorRows.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    reason: String(r.reason ?? "Follow-up"),
    status: String(r.status),
    closeReason: r.close_reason ? String(r.close_reason) : null,
    startsAt: r.starts_at ? new Date(String(r.starts_at)) : null,
    closedAt: r.closed_at ? new Date(String(r.closed_at)) : null,
  }));

  if (!plan) {
    return {
      patient,
      priorPlans,
      planId: null,
      planStatus: null,
      pausedReason: null,
      reason: null,
      condition: null,
      localTime: null,
      durationDays: null,
      maxAttempts: null,
      startsAt: null,
      endsAt: null,
      due: 0,
      contacted: 0,
      lastHeard: null,
      quietFor: null,
      urgentOpen: 0,
      openTotal: 0,
      week: ["none", "none", "none", "none", "none", "none", "none"],
      health: null,
      noteBody: null,
      calls: [],
      quality: {
        slots: 0,
        unclear: 0,
        taskJudged: 0,
        taskCompleted: 0,
        answered: 0,
        raisedSomething: 0,
      },
    };
  }

  const planId = String(plan.id);
  const [bands, callRows, qualityRows] = await Promise.all([
    getWeekBands([planId]),
    db.execute(sql`
      select id, occurrence, attempt, scheduled_for, status, outcome,
             calle_failure_code, finished_at, summary,
             nullif(structured_result ->> 'call_recap', 'unknown')          as recap,
             nullif(structured_result ->> 'what_else', 'unknown')           as what_else
      from scheduled_calls
      where plan_id = ${planId}
      order by occurrence, attempt
    `),
    db.execute(sql`
      select
        (select count(*) from extracted_slots s join scheduled_calls c on c.id = s.call_id
          where c.plan_id = ${planId})                                          as slots,
        (select count(*) from extracted_slots s join scheduled_calls c on c.id = s.call_id
          where c.plan_id = ${planId} and s.status in ('unmappable','missing'))  as unclear,
        (select count(*) from scheduled_calls
          where plan_id = ${planId} and task_completed is not null)              as task_judged,
        (select count(*) from scheduled_calls
          where plan_id = ${planId} and task_completed)                          as task_completed,
        (select count(*) from scheduled_calls
          where plan_id = ${planId}
            and outcome in ('answered','flagged','unmappable'))                  as answered,
        (select count(*) from scheduled_calls
          where plan_id = ${planId}
            and structured_result ->> 'something_else_raised' = 'yes')           as raised
    `),
  ]);

  const q = (qualityRows.rows as Record<string, unknown>[])[0] ?? {};

  const lastHeard = plan.last_heard ? new Date(String(plan.last_heard)) : null;
  const quietFor = lastHeard
    ? calendarDaysBetween(lastHeard, new Date(), patient.timezone)
    : null;
  const urgentOpen = Number(plan.urgent_open);

  return {
    patient,
    planId,
    priorPlans,
    planStatus: String(plan.status),
    pausedReason: plan.paused_reason ? String(plan.paused_reason) : null,
    reason: String(plan.reason),
    condition: plan.condition ? String(plan.condition) : null,
    localTime: String(plan.local_time),
    durationDays: Number(plan.duration_days),
    maxAttempts: Number(plan.max_attempts),
    startsAt: plan.starts_at ? new Date(String(plan.starts_at)) : null,
    endsAt: plan.ends_at ? new Date(String(plan.ends_at)) : null,
    due: Number(plan.due),
    contacted: Number(plan.contacted),
    lastHeard,
    quietFor,
    urgentOpen,
    openTotal: Number(plan.open_total),
    week: bands.get(planId) ?? ["none", "none", "none", "none", "none", "none", "none"],
    health: deriveHealth({
      planStatus: String(plan.status),
      urgentOpen,
      quietFor,
      contacted: Number(plan.contacted),
    }),
    noteBody: plan.note_body ? String(plan.note_body) : null,
    calls: (callRows.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      occurrence: Number(r.occurrence),
      attempt: Number(r.attempt),
      scheduledFor: new Date(String(r.scheduled_for)),
      status: String(r.status),
      outcome: r.outcome ? String(r.outcome) : null,
      failureCode: r.calle_failure_code ? String(r.calle_failure_code) : null,
      finishedAt: r.finished_at ? new Date(String(r.finished_at)) : null,
      summary: r.summary ? String(r.summary) : null,
      recap: r.recap ? String(r.recap) : null,
      whatElse: r.what_else ? String(r.what_else) : null,
    })),
    quality: {
      slots: Number(q.slots ?? 0),
      unclear: Number(q.unclear ?? 0),
      taskJudged: Number(q.task_judged ?? 0),
      taskCompleted: Number(q.task_completed ?? 0),
      answered: Number(q.answered ?? 0),
      raisedSomething: Number(q.raised ?? 0),
    },
  };
}

/** Thrown when the partial unique index on `phone_e164` rejects a duplicate. */
export class DuplicatePhoneError extends Error {
  constructor() {
    super("duplicate phone");
    this.name = "DuplicatePhoneError";
  }
}

/**
 * Whether a thrown error is *this* unique index firing.
 *
 * Drizzle wraps the driver error, so the outer object carries neither `code`
 * nor `constraint` — the real `NeonDbError` with `23505` sits one level down on
 * `cause`. Checking only the top level silently classifies every duplicate as
 * an unknown failure, which is how a "this number already exists" message turns
 * into a 500.
 *
 * The constraint name is matched too, not just the code: a future index on this
 * table must not surface as a phone-number error.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === "23505" && e.constraint === constraint) return true;
    current = e.cause;
  }
  return false;
}

export async function createPatient(input: PatientInput): Promise<string> {
  const db = getDb();
  const id = newId("pat");
  try {
    await db.insert(patients).values({
      id,
      name: input.name,
      age: input.age,
      phoneE164: input.phoneE164,
      timezone: input.timezone,
      language: input.language,
      aiCallConsent: input.aiCallConsent,
      aiCallConsentAt: input.aiCallConsent === "unknown" ? null : new Date(),
      aiCallConsentSource: input.aiCallConsent === "unknown" ? null : "registration",
    });
  } catch (error) {
    // The partial unique index is what stops a double-submitted form creating
    // two patients on one number — and then two plans phoning one human.
    if (isUniqueViolation(error, "uniq_patients_phone")) throw new DuplicatePhoneError();
    throw error;
  }
  return id;
}

export async function updatePatient(id: string, input: PatientInput): Promise<boolean> {
  const db = getDb();
  const existing = await getPatient(id);
  if (!existing) return false;

  /*
   * Consent timestamps only move when the answer itself moves. Re-saving an
   * unchanged form must not make a six-week-old consent look like it was given
   * today — the date is evidence, not a modification stamp.
   */
  const consentChanged = existing.aiCallConsent !== input.aiCallConsent;

  try {
    const rows = await db
      .update(patients)
      .set({
        name: input.name,
        age: input.age,
        phoneE164: input.phoneE164,
        timezone: input.timezone,
        language: input.language,
        aiCallConsent: input.aiCallConsent,
        ...(consentChanged
          ? {
              aiCallConsentAt: input.aiCallConsent === "unknown" ? null : new Date(),
              aiCallConsentSource: input.aiCallConsent === "unknown" ? null : "registration",
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(patients.id, id), isNull(patients.archivedAt)))
      .returning({ id: patients.id });
    return rows.length > 0;
  } catch (error) {
    if (isUniqueViolation(error, "uniq_patients_phone")) throw new DuplicatePhoneError();
    throw error;
  }
}

/**
 * Stop every call that has not been placed yet.
 *
 * The emergency brake. A clinician who realises the agent is about to phone
 * someone it should not needs one control that takes effect immediately, and
 * this is it: pending calls are skipped and the plan is paused, so nothing new
 * is scheduled either.
 *
 * `claimed` rows are skipped as well as `scheduled` ones. A call that has been
 * claimed but not yet dialled is exactly the one you are trying to catch, and
 * the tick re-checks the plan's status before it dials anyway.
 *
 * A call already in flight cannot be recalled — CALL-E has no cancel endpoint,
 * and the phone is already ringing. The UI says so rather than implying
 * otherwise.
 */
export async function stopCalls(patientId: string): Promise<{ stopped: number; paused: boolean }> {
  const db = getDb();

  const stopped = await db.execute(sql`
    update scheduled_calls
    set status = 'skipped', skip_reason = 'plan_paused', updated_at = now()
    where patient_id = ${patientId} and status in ('scheduled', 'claimed')
    returning id
  `);

  const paused = await db.execute(sql`
    update follow_up_plans
    set status = 'paused', paused_at = now(),
        paused_reason = 'Stopped by a clinician', updated_at = now()
    where patient_id = ${patientId} and status = 'active'
    returning id
  `);

  return { stopped: stopped.rows.length, paused: paused.rows.length > 0 };
}

/**
 * Delete a patient and everything about them, permanently.
 *
 * Distinct from archiving, which keeps the record and only stops the dialer.
 * This is for a record that should never have existed — a test entry, a typo, a
 * duplicate — and it removes the call history too, which is exactly why it is
 * not the default and why the UI spells out what is lost.
 *
 * Children first, in foreign-key order: every reference to `patients` is
 * `restrict`, so the parent row cannot go until nothing points at it. There are
 * no transactions, so each statement is idempotent and a retry after a partial
 * failure simply continues.
 */
export async function deletePatient(patientId: string): Promise<{ deleted: boolean }> {
  const db = getDb();

  await db.execute(sql`delete from extracted_slots where patient_id = ${patientId}`);
  await db.execute(sql`delete from escalations where patient_id = ${patientId}`);
  await db.execute(sql`delete from scheduled_calls where patient_id = ${patientId}`);
  await db.execute(sql`
    delete from plan_questions
    where plan_id in (select id from follow_up_plans where patient_id = ${patientId})
  `);
  await db.execute(sql`delete from follow_up_plans where patient_id = ${patientId}`);
  // Visits point at notes, so they go before the notes do.
  await db.execute(sql`delete from visits where patient_id = ${patientId}`);
  await db.execute(sql`delete from consultation_notes where patient_id = ${patientId}`);

  const gone = await db.execute(sql`
    delete from patients where id = ${patientId} returning id
  `);
  return { deleted: gone.rows.length > 0 };
}

export interface ArchiveResult {
  archived: boolean;
  callsSkipped: number;
  plansClosed: number;
}

