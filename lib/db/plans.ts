/**
 * Plans: writing one, reading it back for review, and approving it.
 *
 * Approval is the moment the product's promise becomes concrete — one click and
 * seven dated rows exist. It is also the only place the locked rules and the
 * frozen result schema are stamped, so nothing downstream has to trust that an
 * earlier step remembered to.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId, idempotencyKey } from "@/lib/db/ids";
import { expandPlan } from "@/lib/schedule/expand";
import { buildResultSchema } from "@/lib/plan/result-schema";
import { withLockedRules } from "@/lib/rules/catalog";
import { inspectQuestion } from "@/lib/script/guard";
import { RESERVED_QUESTION_IDS, UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import type { ResolvedPlan } from "@/lib/plan/defaults";
import type { CompileProvider, Provenance } from "@/lib/db/enums";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import type { GuardFinding } from "@/lib/script/guard";

export interface PlanQuestionRow {
  id: string;
  questionId: string;
  ordinal: number;
  prompt: string;
  answerType: "boolean" | "scale_0_10" | "enum" | "text";
  enumValues: string[] | null;
  required: boolean;
  source: Provenance;
  guardStatus: string;
  guardFindings: GuardFinding[] | null;
}

export interface PlanForReview {
  id: string;
  patientId: string;
  patientName: string;
  timezone: string;
  phoneE164: string;
  /** Needed at the approval moment: the doctor must be told whether it was asked. */
  consent: string;
  noteId: string;
  noteBody: string;
  compileStatus: string;
  compileProvider: CompileProvider | null;
  compileModel: string | null;
  compileError: string | null;
  status: string;
  reason: string;
  condition: string | null;
  durationDays: number;
  cadence: string;
  localTime: string;
  timeScale: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  provenance: Record<string, Provenance>;
  redFlagTerms: RedFlagTerm[];
  rules: PlanRule[];
  startsAt: Date | null;
  endsAt: Date | null;
  questions: PlanQuestionRow[];
}

/** Write a note and the plan compiled from it, awaiting the doctor's approval. */
export async function createPlanFromNote(input: {
  patientId: string;
  noteBody: string;
  plan: ResolvedPlan;
  compile: {
    status: "compiled" | "refused";
    provider: CompileProvider | null;
    model: string | null;
    raw: unknown;
    error: string | null;
  };
  rejectedQuestions?: { questionId: string; prompt: string; findings: GuardFinding[] }[];
  timeScale?: number;
}): Promise<string> {
  const db = getDb();
  const noteId = newId("note");
  const planId = newId("pln");

  await db.execute(sql`
    insert into consultation_notes
      (id, patient_id, body, compile_status, compile_provider, compile_model, compile_raw, compile_error)
    values (${noteId}, ${input.patientId}, ${input.noteBody}, ${input.compile.status},
            ${input.compile.provider}, ${input.compile.model},
            ${input.compile.raw === null || input.compile.raw === undefined ? null : JSON.stringify(input.compile.raw)}::jsonb,
            ${input.compile.error})
  `);

  await db.execute(sql`
    insert into follow_up_plans
      (id, patient_id, note_id, status, reason, condition, duration_days, cadence,
       local_time, time_scale, max_attempts, retry_delay_minutes, rules, red_flag_terms,
       provenance, result_schema)
    values (${planId}, ${input.patientId}, ${noteId}, 'awaiting_approval',
            ${input.plan.reason}, ${input.plan.condition}, ${input.plan.durationDays},
            ${input.plan.cadence}, ${input.plan.localTime}, ${input.timeScale ?? 1},
            ${input.plan.maxAttempts}, ${input.plan.retryDelayMinutes},
            ${JSON.stringify(withLockedRules(input.plan.rules))}::jsonb,
            ${JSON.stringify(input.plan.redFlagTerms)}::jsonb,
            ${JSON.stringify(input.plan.provenance)}::jsonb,
            ${JSON.stringify(
              buildResultSchema([
                ...UNIVERSAL_QUESTIONS,
                ...input.plan.questions.filter((q) => !RESERVED_QUESTION_IDS.has(q.questionId)),
              ]),
            )}::jsonb)
  `);

  /*
   * Questions the guard rejected are stored too, marked `rejected`, so the
   * review screen can show the doctor what the model tried to ask and why it
   * was refused. Dropping them silently would hide an attempt to give advice.
   */
  /*
   * The locked questions go on first and are never left to the compiler. They
   * must exist as rows, not just as schema keys: extraction walks this list, so
   * a key present in the schema but absent here is asked on the call, answered
   * by the patient, and then dropped — and losing `reached_patient` that way
   * makes every call fold to `no_answer` however it actually went.
   */
  const all = [
    ...UNIVERSAL_QUESTIONS.map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      answerType: q.answerType,
      enumValues: q.enumValues ?? null,
      source: q.source,
      findings: null as GuardFinding[] | null,
    })),
    ...input.plan.questions
      // A compiler question may not shadow a locked id.
      .filter((q) => !RESERVED_QUESTION_IDS.has(q.questionId))
      .map((q) => ({ ...q, source: "note" as const, findings: null as GuardFinding[] | null })),
    ...(input.rejectedQuestions ?? []).map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      answerType: "text" as const,
      enumValues: null,
      source: "note" as const,
      findings: q.findings,
    })),
  ];

  let ordinal = 0;
  for (const q of all) {
    ordinal += 1;
    const verdict = q.findings ? { ok: false, findings: q.findings } : inspectQuestion(q.prompt);
    await db.execute(sql`
      insert into plan_questions
        (id, plan_id, question_id, ordinal, prompt, answer_type, enum_values, required,
         source, guard_status, guard_findings)
      values (${newId("q")}, ${planId}, ${q.questionId}, ${ordinal}, ${q.prompt},
              ${q.answerType}, ${q.enumValues ? JSON.stringify(q.enumValues) : null}::jsonb,
              true, ${q.source}, ${verdict.ok ? "approved" : "rejected"},
              ${verdict.ok ? null : JSON.stringify(verdict.findings)}::jsonb)
      on conflict (plan_id, question_id) do nothing
    `);
  }

  return planId;
}

export async function getPlanForReview(planId: string): Promise<PlanForReview | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    select p.*, pt.name as patient_name, pt.timezone, pt.phone_e164,
           pt.ai_call_consent, n.body as note_body, n.compile_status, n.compile_provider,
           n.compile_model, n.compile_error
    from follow_up_plans p
    join patients pt on pt.id = p.patient_id
    join consultation_notes n on n.id = p.note_id
    where p.id = ${planId}
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  if (!r) return null;

  const qs = await db.execute(sql`
    select id, question_id, ordinal, prompt, answer_type, enum_values, required,
           source, guard_status, guard_findings
    from plan_questions where plan_id = ${planId} order by ordinal
  `);

  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    patientName: String(r.patient_name),
    timezone: String(r.timezone),
    phoneE164: String(r.phone_e164),
    consent: String(r.ai_call_consent),
    noteId: String(r.note_id),
    noteBody: String(r.note_body),
    compileStatus: String(r.compile_status),
    compileProvider: (r.compile_provider ?? null) as CompileProvider | null,
    compileModel: r.compile_model ? String(r.compile_model) : null,
    compileError: r.compile_error ? String(r.compile_error) : null,
    status: String(r.status),
    reason: String(r.reason),
    condition: r.condition ? String(r.condition) : null,
    durationDays: Number(r.duration_days),
    cadence: String(r.cadence),
    localTime: String(r.local_time),
    timeScale: Number(r.time_scale),
    maxAttempts: Number(r.max_attempts),
    retryDelayMinutes: Number(r.retry_delay_minutes),
    provenance: (r.provenance ?? {}) as Record<string, Provenance>,
    redFlagTerms: (r.red_flag_terms ?? []) as RedFlagTerm[],
    rules: (r.rules ?? []) as PlanRule[],
    startsAt: r.starts_at ? new Date(String(r.starts_at)) : null,
    endsAt: r.ends_at ? new Date(String(r.ends_at)) : null,
    questions: (qs.rows as Record<string, unknown>[]).map((q) => ({
      id: String(q.id),
      questionId: String(q.question_id),
      ordinal: Number(q.ordinal),
      prompt: String(q.prompt),
      answerType: String(q.answer_type) as PlanQuestionRow["answerType"],
      enumValues: (q.enum_values ?? null) as string[] | null,
      required: Boolean(q.required),
      source: String(q.source) as Provenance,
      guardStatus: String(q.guard_status),
      guardFindings: (q.guard_findings ?? null) as GuardFinding[] | null,
    })),
  };
}

/** Edit a plan before approval. Rejected questions can never be edited into approval by accident. */
export async function updatePlanDraft(
  planId: string,
  fields: { durationDays: number; localTime: string; timeScale: number },
): Promise<boolean> {
  const result = await getDb().execute(sql`
    update follow_up_plans
    set duration_days = ${fields.durationDays},
        local_time = ${fields.localTime},
        time_scale = ${fields.timeScale},
        -- Editing a defaulted field makes it the clinician's, not ours. The
        -- review screen's mark must follow who actually chose the value.
        provenance = provenance
          || jsonb_build_object('durationDays', 'clinician', 'localTime', 'clinician'),
        updated_at = now()
    where id = ${planId} and status = 'awaiting_approval'
    returning id
  `);
  return result.rows.length > 0;
}

export async function deleteQuestion(planId: string, questionId: string): Promise<boolean> {
  const result = await getDb().execute(sql`
    delete from plan_questions
    where plan_id = ${planId} and id = ${questionId}
      and exists (select 1 from follow_up_plans p where p.id = ${planId} and p.status = 'awaiting_approval')
    returning id
  `);
  return result.rows.length > 0;
}

/**
 * Save an edited rule set.
 *
 * Allowed on a plan that is awaiting approval **and** on a running one — the
 * "after observation" case, where day three reveals the threshold was wrong.
 *
 * Forward-only, and deliberately so: this does not re-evaluate finished calls.
 * Retroactive escalation would reopen escalations a clinician has already acted
 * on and rewrite a history they made decisions against. The UI says as much.
 */
export async function updatePlanRules(planId: string, rules: PlanRule[]): Promise<boolean> {
  const result = await getDb().execute(sql`
    update follow_up_plans
    set rules = ${JSON.stringify(withLockedRules(rules))}::jsonb, updated_at = now()
    where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
    returning id
  `);
  return result.rows.length > 0;
}

/**
 * Cancel a plan outright.
 *
 * Distinct from pausing, which expects a human to resume, and from archiving,
 * which retires the whole patient. This is for a plan that should not have been
 * approved — wrong cadence, wrong questions, wrong patient. Pending calls are
 * skipped first so nothing is dialled in the gap before the status flips.
 *
 * The rows stay. They record calls that actually happened to a person, and the
 * console does not delete its own audit trail.
 */
export async function cancelPlan(planId: string, by: string): Promise<boolean> {
  const db = getDb();

  await db.execute(sql`
    update scheduled_calls
    set status = 'skipped', skip_reason = 'plan_closed', updated_at = now()
    where plan_id = ${planId} and status in ('scheduled', 'claimed')
  `);

  const result = await db.execute(sql`
    update follow_up_plans
    set status = 'cancelled', closed_at = now(), close_reason = 'clinician_closed',
        resumed_by = ${by}, updated_at = now()
    where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
    returning id
  `);
  return result.rows.length > 0;
}

export interface ApproveResult {
  ok: boolean;
  occurrences: number;
  reason?: string;
}

/**
 * Approve a plan, and materialise its calendar.
 *
 * Occurrences are inserted `on conflict do nothing`, so a double-clicked
 * Approve produces one set of rows rather than two. The plan flip is itself a
 * conditional update from `awaiting_approval`, which is what makes the second
 * click a no-op instead of a second calendar.
 */
export async function approvePlan(planId: string, by: string): Promise<ApproveResult> {
  const db = getDb();

  const plan = await getPlanForReview(planId);
  if (!plan) return { ok: false, occurrences: 0, reason: "That plan no longer exists." };
  if (plan.status !== "awaiting_approval") {
    return { ok: false, occurrences: 0, reason: "That plan has already been approved." };
  }

  const approved = plan.questions.filter((q) => q.guardStatus === "approved");
  if (approved.length === 0) {
    return {
      ok: false,
      occurrences: 0,
      reason:
        "No question on this plan passed the clinical guard. Care Loop will not " +
        "place a call with nothing safe to ask.",
    };
  }

  const now = new Date();
  const expansion = expandPlan({
    planId,
    patientId: plan.patientId,
    timezone: plan.timezone,
    localTime: plan.localTime,
    durationDays: plan.durationDays,
    cadence: plan.cadence as "daily" | "every_other_day" | "weekly",
    timeScale: plan.timeScale,
    now,
  });

  /*
   * A plan that would schedule nothing must not approve.
   *
   * Every occurrence lands in the past when the window is short and its local
   * time has already gone — approving at 20:33:31 for a 20:33 call, say. The
   * expansion is right to skip them, but returning success with an empty
   * calendar tells the doctor the follow-up has started when nothing will ever
   * ring. Refuse, and say which time to move.
   */
  if (expansion.occurrences.length === 0) {
    return {
      ok: false,
      occurrences: 0,
      reason:
        `Every call in this plan would land in the past — ${plan.localTime} ` +
        `${plan.timezone} has already gone today, and the window is only ` +
        `${plan.durationDays} day${plan.durationDays === 1 ? "" : "s"} long. ` +
        "Set a later local time, or lengthen the window, then approve.",
    };
  }

  /*
   * The flip first, conditionally. If a second click loses this race it gets
   * zero rows and stops — before writing a duplicate calendar.
   */
  const flipped = await db.execute(sql`
    update follow_up_plans
    set status = 'active', approved_at = now(), approved_by = ${by},
        starts_at = ${expansion.startsAt}, ends_at = ${expansion.endsAt},
        rules = ${JSON.stringify(withLockedRules(plan.rules))}::jsonb,
        result_schema = ${JSON.stringify(
          buildResultSchema(
            approved.map((q) => ({
              questionId: q.questionId,
              prompt: q.prompt,
              answerType: q.answerType,
              enumValues: q.enumValues,
            })),
          ),
        )}::jsonb,
        updated_at = now()
    where id = ${planId} and status = 'awaiting_approval'
    returning id
  `);

  if (flipped.rows.length === 0) {
    return { ok: false, occurrences: 0, reason: "That plan has already been approved." };
  }

  let inserted = 0;
  for (const occurrence of expansion.occurrences) {
    const result = await db.execute(sql`
      insert into scheduled_calls
        (id, plan_id, patient_id, occurrence, attempt, idempotency_key, scheduled_for)
      values (${newId("sc")}, ${planId}, ${plan.patientId}, ${occurrence.occurrence}, 1,
              ${idempotencyKey(planId, occurrence.occurrence, 1)}, ${occurrence.scheduledFor})
      on conflict (plan_id, occurrence, attempt) do nothing
      returning id
    `);
    inserted += result.rows.length;
  }

  return { ok: true, occurrences: inserted };
}
