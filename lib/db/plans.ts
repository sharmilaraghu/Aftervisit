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
import type { AnswerType } from "@/lib/db/enums";
import { expandPlan } from "@/lib/schedule/expand";
import { buildResultSchema } from "@/lib/plan/result-schema";
import { withLockedRules } from "@/lib/rules/catalog";
import { inspectQuestion } from "@/lib/script/guard";
import { questionSlug } from "@/lib/plan/clinician-question";
import { RESERVED_QUESTION_IDS, UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import type { QuestionDraft } from "@/lib/plan/clinician-question";
import type { ResolvedPlan } from "@/lib/plan/defaults";
import type { CompileProvider, Provenance } from "@/lib/db/enums";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import type { GuardFinding, GuardResult } from "@/lib/script/guard";
import { nextOrdinal } from "@/lib/plan/ordinals";

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
  /** Age only — the compiler and the triage model never receive the name. */
  patientAge: number;
  timezone: string;
  /** BCP 47 tag; shown at approval so the doctor knows what the agent will speak. */
  language: string;
  phoneE164: string;
  /** Needed at the approval moment: the doctor must be told whether it was asked. */
  consent: string;
  noteId: string;
  noteBody: string;
  /** What the doctor said to watch for, verbatim. Null when they wrote none. */
  escalationNote: string | null;
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
  /** The doctor's own escalation wording, kept verbatim for the triage model. */
  escalationNote?: string | null;
}): Promise<string> {
  const db = getDb();
  const noteId = newId("note");
  const planId = newId("pln");

  await db.execute(sql`
    insert into consultation_notes
      (id, patient_id, body, escalation_note, compile_status, compile_provider,
       compile_model, compile_raw, compile_error)
    values (${noteId}, ${input.patientId}, ${input.noteBody},
            ${input.escalationNote?.trim() || null}, ${input.compile.status},
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
    select p.*, pt.name as patient_name, pt.age as patient_age, pt.timezone, pt.language, pt.phone_e164,
           pt.ai_call_consent, n.body as note_body, n.escalation_note, n.compile_status, n.compile_provider,
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
    from plan_questions where plan_id = ${planId} order by ordinal, question_id
  `);

  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    patientName: String(r.patient_name),
    patientAge: Number(r.patient_age),
    timezone: String(r.timezone),
    language: String(r.language ?? "en-US"),
    phoneE164: String(r.phone_e164),
    consent: String(r.ai_call_consent),
    noteId: String(r.note_id),
    noteBody: String(r.note_body),
    escalationNote: r.escalation_note ? String(r.escalation_note) : null,
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
  fields: {
    durationDays: number;
    localTime: string;
    timeScale: number;
    cadence: "daily" | "every_other_day" | "weekly";
    maxAttempts: number;
  },
): Promise<boolean> {
  const result = await getDb().execute(sql`
    update follow_up_plans
    set duration_days = ${fields.durationDays},
        local_time = ${fields.localTime},
        time_scale = ${fields.timeScale},
        cadence = ${fields.cadence},
        max_attempts = ${fields.maxAttempts},
        -- Editing a defaulted field makes it the clinician's, not ours. The
        -- review screen's mark must follow who actually chose the value.
        provenance = provenance
          || jsonb_build_object('durationDays', 'clinician', 'localTime', 'clinician',
                                'cadence', 'clinician', 'maxAttempts', 'clinician'),
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
      -- A locked question backs a rule nobody may remove, and losing
      -- reached_patient folds every call to no_answer however it went.
      and source <> 'locked'
      and exists (select 1 from follow_up_plans p where p.id = ${planId} and p.status = 'awaiting_approval')
    returning id
  `);
  return result.rows.length > 0;
}

/** The current order, for translating "up" into "after this row". */
export async function getPlanQuestionOrder(
  planId: string,
): Promise<{ id: string; ordinal: number; source: string }[]> {
  const result = await getDb().execute(sql`
    select id, ordinal, source from plan_questions
    where plan_id = ${planId}
    order by ordinal, question_id
  `);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    ordinal: Number(r.ordinal),
    source: String(r.source),
  }));
}

/**
 * Move one question, in one statement.
 *
 * The caller says where the question should land ("after this row"), not what
 * number it should take; `nextOrdinal` turns that into a value strictly between
 * two neighbours. Nothing is renumbered, so there is no multi-row phase that a
 * driver without transactions could half-apply — one statement, one row, one
 * lock, and every intermediate state of the table is a valid total order.
 *
 * The failure worth naming is two tabs dropping a question in the same gap.
 * The second write violates `uniq_q_ordinal` and surfaces as a refusal the
 * doctor can act on, never a silent retry that lands somewhere they did not
 * choose.
 */
export async function moveQuestion(
  planId: string,
  questionId: string,
  afterQuestionId: string | null,
): Promise<{ moved: boolean; reason?: string }> {
  const db = getDb();

  const current = await db.execute(sql`
    select id, ordinal, source from plan_questions
    where plan_id = ${planId}
    order by ordinal, question_id
  `);
  const rows = (current.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    ordinal: Number(r.ordinal),
    source: String(r.source),
  }));

  const target = nextOrdinal(rows, afterQuestionId);
  if (!target.ok) {
    return {
      moved: false,
      reason:
        target.reason === "exhausted"
          ? "There is no room left between these two questions. Reload the plan and try again."
          : "The order changed while you were editing. Reload the plan.",
    };
  }

  try {
    const result = await db.execute(sql`
      update plan_questions
      set ordinal = ${target.ordinal}, updated_at = now()
      where id = ${questionId} and plan_id = ${planId}
        -- The locked questions open the call; moving one changes who the agent
        -- has established it is talking to before it asks anything.
        and source <> 'locked'
        and exists (
          select 1 from follow_up_plans p
          where p.id = ${planId} and p.status = 'awaiting_approval'
        )
      returning id
    `);
    return { moved: result.rows.length > 0 };
  } catch (error) {
    /* 23505: another tab took this gap first. */
    if (String(error).includes("23505")) {
      return { moved: false, reason: "The order changed while you were editing. Reload the plan." };
    }
    throw error;
  }
}

/**
 * What happened to a question a clinician wrote.
 *
 * `saved` is whether a row moved; `guard` is phase 1's verdict on the text as it
 * was stored. Both matter: a refused question is still written — marked
 * `rejected`, with its findings — so the review screen can show what was
 * refused and why. It is never silently dropped, and it never becomes askable.
 */
export interface QuestionWriteResult {
  saved: boolean;
  guard: GuardResult;
}

/**
 * Rewrite a question's spoken wording.
 *
 * The guard runs *here*, on the way to the row, for the same reason it runs
 * inside `port.dial()`: a phase-1 verdict recomputed by a caller is a verdict a
 * caller can forget to compute. `guard_findings` is overwritten either way, so a
 * question edited out of a refusal loses the findings that no longer apply.
 *
 * Locked questions are excluded in SQL. Their wording is what the locked rules
 * were written against, and `source` would flip to `clinician` underneath them.
 */
export async function updateQuestionPrompt(
  planId: string,
  questionId: string,
  prompt: string,
): Promise<QuestionWriteResult> {
  const guard = inspectQuestion(prompt);

  const result = await getDb().execute(sql`
    update plan_questions
    set prompt = ${prompt},
        guard_status = ${guard.ok ? "approved" : "rejected"},
        guard_findings = ${guard.ok ? null : JSON.stringify(guard.findings)}::jsonb,
        -- Wording the doctor wrote is the doctor's, whatever the model or the
        -- defaults put there first.
        source = 'clinician',
        updated_at = now()
    where plan_id = ${planId} and id = ${questionId}
      and source <> 'locked'
      and exists (select 1 from follow_up_plans p where p.id = ${planId} and p.status = 'awaiting_approval')
    returning id
  `);

  return { saved: result.rows.length > 0, guard };
}

/**
 * Add a question the doctor wrote themselves.
 *
 * The slug is derived from the existing ones and the insert still carries
 * `on conflict do nothing`, so two tabs racing produce one question rather than
 * a collision. `ordinal` continues the plan's own sequence, so a new question is
 * asked last rather than landing in the middle of a numbering nobody edited.
 */
export async function addQuestion(
  planId: string,
  draft: QuestionDraft,
): Promise<QuestionWriteResult> {
  const db = getDb();
  const guard = inspectQuestion(draft.prompt);

  const existing = await db.execute(sql`
    select question_id from plan_questions where plan_id = ${planId}
  `);
  const slug = questionSlug(
    draft.prompt,
    (existing.rows as Record<string, unknown>[]).map((r) => String(r.question_id)),
  );

  const result = await db.execute(sql`
    insert into plan_questions
      (id, plan_id, question_id, ordinal, prompt, answer_type, enum_values, required,
       source, guard_status, guard_findings)
    select ${newId("q")}, ${planId}, ${slug},
           (select coalesce(max(ordinal), 0) + 1 from plan_questions where plan_id = ${planId}),
           ${draft.prompt}, ${draft.answerType},
           ${draft.enumValues ? JSON.stringify(draft.enumValues) : null}::jsonb, true,
           'clinician', ${guard.ok ? "approved" : "rejected"},
           ${guard.ok ? null : JSON.stringify(guard.findings)}::jsonb
    from follow_up_plans p
    where p.id = ${planId} and p.status = 'awaiting_approval'
    on conflict (plan_id, question_id) do nothing
    returning id
  `);

  return { saved: result.rows.length > 0, guard };
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
   * A successor closes its predecessor, in that order.
   *
   * `uniq_live_plan_per_patient` covers ('active','paused'), so flipping this
   * plan first would collide with the plan it is replacing. Closing first means
   * the worst case is a moment with no live plan — recoverable, and visible —
   * rather than an error the doctor cannot act on. There are no transactions
   * here to make the pair atomic, so the order is the safety.
   */
  const predecessor = await db.execute(sql`
    select id, version from follow_up_plans
    where patient_id = ${plan.patientId} and id <> ${planId}
      and status in ('active', 'paused')
    order by created_at desc limit 1
  `);
  const prior = predecessor.rows[0] as Record<string, unknown> | undefined;

  if (prior) {
    await db.execute(sql`
      update scheduled_calls
      set status = 'skipped', skip_reason = 'plan_closed', updated_at = now()
      where plan_id = ${String(prior.id)} and status in ('scheduled', 'claimed')
    `);
    await db.execute(sql`
      update follow_up_plans
      set status = 'completed', closed_at = now(), close_reason = 'superseded',
          resumed_by = ${by}, updated_at = now()
      where id = ${String(prior.id)} and status in ('active', 'paused')
    `);
  }

  /*
   * The flip first, conditionally. If a second click loses this race it gets
   * zero rows and stops — before writing a duplicate calendar.
   */
  const flipped = await db.execute(sql`
    update follow_up_plans
    set status = 'active', approved_at = now(), approved_by = ${by},
        starts_at = ${expansion.startsAt}, ends_at = ${expansion.endsAt},
        version = ${prior ? Number(prior.version ?? 1) + 1 : 1},
        supersedes_plan_id = ${prior ? String(prior.id) : null},
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

/**
 * Append to the note a doctor already wrote.
 *
 * It appends to `consultation_notes.body` rather than living in a column of its
 * own, and that is not a shortcut. `assertGrounded` runs again at *dial* time
 * against `body`: a medication named only in an amendment stored elsewhere
 * would make every subsequent call refuse as ungrounded. The note the compiler
 * reads and the note the dialer grounds against have to be the same text.
 *
 * Only while the plan is awaiting approval, and that is enforced in the SQL
 * rather than in the caller.
 *
 * **A running plan may be amended.** The patient came back with something new
 * and the follow-up that is already dialling them is the right place to put it:
 * one call a day covering everything, rather than two agents phoning the same
 * person. What must not change is a question calls have already been placed
 * against — so a live amendment is strictly additive, enforced in
 * `mergeCompiledQuestions` rather than trusted to the caller.
 */
export async function amendNote(
  planId: string,
  addition: string,
): Promise<{ ok: boolean; body: string; escalationNote: string | null }> {
  const trimmed = addition.trim();
  if (!trimmed) return { ok: false, body: "", escalationNote: null };

  const result = await getDb().execute(sql`
    update consultation_notes n
    set body = n.body || E'\n\n' || ${trimmed},
        amended_at = now()
    from follow_up_plans p
    where p.note_id = n.id
      and p.id = ${planId}
      -- A running plan may be amended too, but only additively:
      -- mergeCompiledQuestions refuses to rewrite a question once calls
      -- have been placed against it.
      and p.status in ('awaiting_approval', 'active', 'paused')
    returning n.body, n.escalation_note
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, body: "", escalationNote: null };
  return {
    ok: true,
    body: String(row.body),
    escalationNote: row.escalation_note ? String(row.escalation_note) : null,
  };
}

/**
 * Fold a fresh compile into the questions already on a plan.
 *
 * Merging on `question_id`, with one rule per case, and the cases exist because
 * a recompile arrives *after* a doctor has already edited and reordered:
 *
 *   new slug          → inserted, appended last, guard run on the way in
 *   source clinician  → never touched. Their wording outranks the model's
 *   source note       → the prompt may be rewritten by the newer compile
 *   locked / default  → never touched; that set is code-owned
 *   gone from the new compile → kept. Deleting is the doctor's act, not ours
 *
 * **A recompile never writes an ordinal except to append.** That single
 * invariant is what makes reordering and re-parsing compose: no code path here
 * can move a question the doctor placed, so their order survives every
 * amendment by construction rather than by care.
 *
 * The `where source = 'note'` on the update is what enforces the clinician rule
 * in the database instead of relying on this function remembering it.
 */
export async function mergeCompiledQuestions(
  planId: string,
  questions: { questionId: string; prompt: string; answerType: string; enumValues?: string[] | null }[],
): Promise<{ added: number; rewritten: number }> {
  const db = getDb();
  let added = 0;
  let rewritten = 0;

  for (const q of questions) {
    if (RESERVED_QUESTION_IDS.has(q.questionId)) continue;
    const guard = inspectQuestion(q.prompt);

    const inserted = await db.execute(sql`
      insert into plan_questions
        (id, plan_id, question_id, ordinal, prompt, answer_type, enum_values, required,
         source, guard_status, guard_findings, last_compile_at, added_at)
      select ${newId("q")}, ${planId}, ${q.questionId},
             (select coalesce(max(ordinal), 0) + 1 from plan_questions where plan_id = ${planId}),
             ${q.prompt}, ${q.answerType},
             ${q.enumValues ? JSON.stringify(q.enumValues) : null}::jsonb, true,
             'note', ${guard.ok ? "approved" : "rejected"},
             ${guard.ok ? null : JSON.stringify(guard.findings)}::jsonb, now(),
             -- Stamped only when the plan was already running, so a call from
             -- day 2 can be read knowing which questions did not exist yet.
             (case when p.status = 'awaiting_approval' then null else now() end)
      from follow_up_plans p
      where p.id = ${planId} and p.status in ('awaiting_approval', 'active', 'paused')
      on conflict (plan_id, question_id) do nothing
      returning id
    `);

    if (inserted.rows.length > 0) {
      added += 1;
      continue;
    }

    const updated = await db.execute(sql`
      update plan_questions
      set prompt = ${q.prompt},
          guard_status = ${guard.ok ? "approved" : "rejected"},
          guard_findings = ${guard.ok ? null : JSON.stringify(guard.findings)}::jsonb,
          last_compile_at = now(),
          updated_at = now()
      where plan_id = ${planId} and question_id = ${q.questionId}
        -- The doctor's own wording is never overwritten by a later compile.
        and source = 'note'
        and exists (
          select 1 from follow_up_plans p
          where p.id = ${planId} and p.status = 'awaiting_approval'
        )
      returning id
    `);
    if (updated.rows.length > 0) rewritten += 1;
  }

  return { added, rewritten };
}

/**
 * Re-freeze the result schema after questions were added to a running plan.
 *
 * The schema is frozen at approval and `loadContext` sends that frozen copy to
 * CALL-E, so a question added afterwards would be asked on the call and its
 * answer discarded — the key would not be in the contract, and `extractSlots`
 * would record it `missing` forever.
 *
 * Additive and safe: calls already placed were extracted against the older
 * schema and their slots are already written. Only guard-approved questions go
 * in, exactly as at approval — a refused question must never reach a patient.
 */
export async function refreezeResultSchema(planId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute(sql`
    select question_id, prompt, answer_type, enum_values
    from plan_questions
    where plan_id = ${planId} and guard_status = 'approved'
    order by ordinal, question_id
  `);

  const questions = (rows.rows as Record<string, unknown>[]).map((r) => ({
    questionId: String(r.question_id),
    prompt: String(r.prompt),
    answerType: String(r.answer_type) as AnswerType,
    enumValues: (r.enum_values ?? null) as string[] | null,
  }));
  if (questions.length === 0) return false;

  const result = await db.execute(sql`
    update follow_up_plans
    set result_schema = ${JSON.stringify(buildResultSchema(questions))}::jsonb,
        updated_at = now()
    where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
    returning id
  `);
  return result.rows.length > 0;
}

/**
 * Take the newer compile's plan-level values, except where the doctor set them.
 *
 * `provenance` already records who chose each field, and it is the same map the
 * review screen reads to print "Defaulted" and "You set this". Honouring it here
 * is what stops an amendment quietly undoing a cadence a doctor typed.
 */
export async function mergeCompiledPlan(
  planId: string,
  plan: ResolvedPlan,
): Promise<boolean> {
  const db = getDb();
  const current = await db.execute(sql`
    select provenance, red_flag_terms from follow_up_plans
    where id = ${planId} and status = 'awaiting_approval'
  `);
  const row = current.rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;

  const was = (row.provenance ?? {}) as Record<string, Provenance>;

  /*
   * A word the doctor typed survives a recompile.
   *
   * Taking the new compile's list wholesale would delete every term they added
   * by hand — the compiler never proposes those, so they would vanish on the
   * next amendment with no trace and nothing to undo.
   */
  const existing = (row.red_flag_terms ?? []) as RedFlagTerm[];
  const theirs = existing.filter((t) => t.source === "clinician");
  const seen = new Set(theirs.map((t) => t.term.toLowerCase()));
  const terms = [
    ...theirs,
    ...plan.redFlagTerms.filter((t) => !seen.has(t.term.toLowerCase())),
  ];
  const mine = (field: string) => was[field] === "clinician";

  const merged: Record<string, Provenance> = { ...was };
  for (const [field, source] of Object.entries(plan.provenance)) {
    if (!mine(field)) merged[field] = source;
  }

  const result = await db.execute(sql`
    update follow_up_plans
    set reason = ${mine("reason") ? sql`reason` : plan.reason},
        condition = ${mine("condition") ? sql`condition` : plan.condition},
        duration_days = ${mine("durationDays") ? sql`duration_days` : plan.durationDays},
        cadence = ${mine("cadence") ? sql`cadence` : plan.cadence},
        local_time = ${mine("localTime") ? sql`local_time` : plan.localTime},
        red_flag_terms = ${JSON.stringify(terms)}::jsonb,
        provenance = ${JSON.stringify(merged)}::jsonb,
        updated_at = now()
    where id = ${planId} and status = 'awaiting_approval'
    returning id
  `);
  return result.rows.length > 0;
}
