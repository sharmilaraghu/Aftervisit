/**
 * Plans: writing one from a note, starting it, and reading it back.
 *
 * Starting is the moment the product's promise becomes concrete — the doctor
 * saves the note and dated rows exist. It is also the only place the locked
 * rules and the frozen result schema are stamped, so nothing downstream has to
 * trust that an earlier step remembered to.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId, idempotencyKey } from "@/lib/db/ids";
import { expandPlan } from "@/lib/schedule/expand";
import { buildResultSchema, MAX_TOPICS } from "@/lib/plan/result-schema";
import { withLockedRules } from "@/lib/rules/catalog";
import { inspectQuestion } from "@/lib/script/guard";
import { UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import { DEFAULT_GOAL, type ResolvedPlan, type ScheduleQuotes, type WatchPoint } from "@/lib/plan/defaults";
import type { DroppedTopic } from "@/lib/plan/compile";
import type { CompileProvider, Provenance } from "@/lib/db/enums";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";

export interface PlanForReview {
  id: string;
  patientId: string;
  patientName: string;
  /** Age only — the parser and the triage model never receive the name. */
  patientAge: number;
  timezone: string;
  language: string;
  phoneE164: string;
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
  /** What the calls set out to find out. */
  goal: string;
  /** Days to wait before the first call. */
  startAfterDays: number;
  durationDays: number;
  cadence: string;
  localTime: string;
  timeScale: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  provenance: Record<string, Provenance>;
  /** The note's words behind each schedule value marked "from your note". */
  scheduleQuotes: ScheduleQuotes;
  /** What to find out, each with the note's words for it. */
  watchPoints: WatchPoint[];
  /** What the note asked about that the calls will not follow up, and why. */
  droppedTopics: DroppedTopic[];
  redFlagTerms: RedFlagTerm[];
  rules: PlanRule[];
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Write a note and the follow-up read from it. `startPlan` puts it on the calendar. */
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
  /** What the checks refused from the note, kept so the doctor can see it. */
  droppedTopics?: DroppedTopic[];
  timeScale?: number;
  /** The doctor's own escalation wording, kept verbatim for the triage model. */
  escalationNote?: string | null;
}): Promise<string> {
  const db = getDb();
  const noteId = newId("note");
  const planId = newId("pln");
  const topics = (input.plan.watchPoints ?? []).slice(0, MAX_TOPICS);

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
      (id, patient_id, note_id, status, reason, condition, goal, start_after_days, duration_days, cadence,
       local_time, time_scale, max_attempts, retry_delay_minutes, rules, red_flag_terms,
       provenance, schedule_quotes, watch_points, dropped_topics, result_schema)
    values (${planId}, ${input.patientId}, ${noteId}, 'awaiting_approval',
            ${input.plan.reason}, ${input.plan.condition}, ${input.plan.goal},
            ${input.plan.startAfterDays}, ${input.plan.durationDays}, ${input.plan.cadence}, ${input.plan.localTime},
            ${input.timeScale ?? 1}, ${input.plan.maxAttempts}, ${input.plan.retryDelayMinutes},
            ${JSON.stringify(withLockedRules(input.plan.rules))}::jsonb,
            ${JSON.stringify(input.plan.redFlagTerms)}::jsonb,
            ${JSON.stringify(input.plan.provenance)}::jsonb,
            ${JSON.stringify(input.plan.scheduleQuotes ?? {})}::jsonb,
            ${JSON.stringify(topics)}::jsonb,
            ${JSON.stringify(input.droppedTopics ?? [])}::jsonb,
            ${JSON.stringify(buildResultSchema(topics))}::jsonb)
  `);

  /*
   * The fixed observations go on as rows, by code. They must exist as rows, not
   * just as schema keys: extraction walks this list, so a key present in the
   * schema but absent here is recorded by the agent and then dropped — and
   * losing `reached_patient` that way makes every call fold to `no_answer`.
   */
  let ordinal = 0;
  for (const q of UNIVERSAL_QUESTIONS) {
    ordinal += 1;
    const verdict = inspectQuestion(q.prompt);
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
    goal: r.goal ? String(r.goal) : DEFAULT_GOAL,
    startAfterDays: Number(r.start_after_days ?? 0),
    durationDays: Number(r.duration_days),
    cadence: String(r.cadence),
    localTime: String(r.local_time),
    timeScale: Number(r.time_scale),
    maxAttempts: Number(r.max_attempts),
    retryDelayMinutes: Number(r.retry_delay_minutes),
    provenance: (r.provenance ?? {}) as Record<string, Provenance>,
    scheduleQuotes: (r.schedule_quotes ?? {}) as ScheduleQuotes,
    watchPoints: (r.watch_points ?? []) as WatchPoint[],
    droppedTopics: (r.dropped_topics ?? []) as DroppedTopic[],
    redFlagTerms: (r.red_flag_terms ?? []) as RedFlagTerm[],
    rules: (r.rules ?? []) as PlanRule[],
    startsAt: r.starts_at ? new Date(String(r.starts_at)) : null,
    endsAt: r.ends_at ? new Date(String(r.ends_at)) : null,
  };
}

/**
 * Cancel a plan outright.
 *
 * Distinct from pausing, which expects a human to resume, and from archiving,
 * which retires the whole patient. Pending calls are skipped first so nothing
 * is dialled in the gap before the status flips.
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

export interface StartResult {
  ok: boolean;
  occurrences: number;
  /** When the first call goes out. */
  firstCallAt?: Date;
  reason?: string;
}

/**
 * Start a follow-up, and materialise its calendar.
 *
 * This is the doctor's "press to call": they saved the note and pressed *Save
 * and start follow-up*. Consent and the deployment allowlist still gate every
 * dial inside the port; nothing here widens who can be reached.
 *
 * Occurrences are inserted `on conflict do nothing`, and the plan flip is a
 * conditional update from `awaiting_approval`, so a double submit produces one
 * calendar rather than two.
 */
export async function startPlan(planId: string, by: string): Promise<StartResult> {
  const db = getDb();

  const plan = await getPlanForReview(planId);
  if (!plan) return { ok: false, occurrences: 0, reason: "That follow-up no longer exists." };
  if (plan.status !== "awaiting_approval") {
    return { ok: false, occurrences: 0, reason: "That follow-up has already started." };
  }

  const now = new Date();
  const base = {
    planId,
    patientId: plan.patientId,
    timezone: plan.timezone,
    localTime: plan.localTime,
    durationDays: plan.durationDays,
    cadence: plan.cadence as "daily" | "every_other_day" | "weekly",
    timeScale: plan.timeScale,
    now,
  };

  /*
   * A start after today's call time begins the window tomorrow.
   *
   * The window is counted from its first day, and today's call has already gone,
   * so starting today would quietly spend a day nobody is called on: "follow up
   * for 3 days" saved at 16:00 for a 10:00 call would ring twice, and a one-day
   * follow-up would not ring at all. The doctor asked for a number of days of
   * calls; whichever start gives more of them is the one they meant.
   */
  const onTime = expandPlan({ ...base, startOffsetDays: plan.startAfterDays });
  const dayLater = expandPlan({ ...base, startOffsetDays: plan.startAfterDays + 1 });
  const expansion = dayLater.occurrences.length > onTime.occurrences.length ? dayLater : onTime;

  /*
   * A successor closes its predecessor, in that order.
   *
   * `uniq_live_plan_per_patient` covers ('active','paused'), so flipping this
   * plan first would collide with the plan it is replacing. There are no
   * transactions here to make the pair atomic, so the order is the safety.
   */
  const predecessor = await db.execute(sql`
    select id, version, status from follow_up_plans
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
   * If the flip does not land, the predecessor comes back. Closing it first is
   * forced by the unique index, and without this a start that lost a race —
   * this plan cancelled underneath it, or a second visit for the same patient
   * flipping first — would leave the patient with no follow-up at all. Only
   * calls still ahead are restored; nothing already due is dialled late.
   */
  const restorePredecessor = async () => {
    if (!prior) return;
    await db.execute(sql`
      update follow_up_plans
      set status = ${String(prior.status)}, closed_at = null, close_reason = null, updated_at = now()
      where id = ${String(prior.id)} and status = 'completed' and close_reason = 'superseded'
    `);
    await db.execute(sql`
      update scheduled_calls
      set status = 'scheduled', skip_reason = null, updated_at = now()
      where plan_id = ${String(prior.id)} and status = 'skipped' and skip_reason = 'plan_closed'
        and scheduled_for > now()
    `);
  };

  let flippedRows = 0;
  try {
    const flipped = await db.execute(sql`
      update follow_up_plans
      set status = 'active', approved_at = now(), approved_by = ${by},
          starts_at = ${expansion.startsAt}, ends_at = ${expansion.endsAt},
          version = ${prior ? Number(prior.version ?? 1) + 1 : 1},
          supersedes_plan_id = ${prior ? String(prior.id) : null},
          rules = ${JSON.stringify(withLockedRules(plan.rules))}::jsonb,
          result_schema = ${JSON.stringify(buildResultSchema(plan.watchPoints))}::jsonb,
          updated_at = now()
      where id = ${planId} and status = 'awaiting_approval'
      returning id
    `);
    flippedRows = flipped.rows.length;
  } catch {
    /* 23505 on uniq_live_plan_per_patient: another start for this patient won. */
    flippedRows = 0;
  }

  if (flippedRows === 0) {
    await restorePredecessor();
    return {
      ok: false,
      occurrences: 0,
      reason: "Another follow-up for this patient started at the same moment, so this one was not started.",
    };
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

  return { ok: true, occurrences: inserted, firstCallAt: expansion.occurrences[0]?.scheduledFor };
}

/**
 * Append to the note a doctor already wrote.
 *
 * It appends to `consultation_notes.body` rather than living in a column of its
 * own: the re-read reads the whole body, and topic quotes are grounded against
 * that same text — so a topic anchored only in an amendment stored elsewhere
 * would be refused as ungrounded.
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
 * Fold a re-read note into a running follow-up: the new goal, and any new topics.
 *
 * **Additive on topics, never a rewrite.** A call's findings are stored by
 * position — `topic_1`, `topic_2` — so a topic that moved or vanished would
 * re-label every answer already given. New topics are appended up to the cap;
 * existing ones keep their place. The schedule is left alone: a doctor adding a
 * new symptom is not asking to move tomorrow's call.
 */
export async function updatePlanGoal(
  planId: string,
  plan: Pick<ResolvedPlan, "goal" | "watchPoints" | "provenance">,
): Promise<{ ok: boolean; added: number }> {
  const db = getDb();
  const current = await db.execute(sql`
    select watch_points from follow_up_plans
    where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
  `);
  const row = current.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, added: 0 };

  const topics = [...((row.watch_points ?? []) as WatchPoint[])];
  const seen = new Set(topics.map((t) => t.text.toLowerCase()));
  let added = 0;
  for (const t of plan.watchPoints) {
    if (topics.length >= MAX_TOPICS) break;
    if (seen.has(t.text.toLowerCase())) continue;
    seen.add(t.text.toLowerCase());
    topics.push(t);
    added += 1;
  }

  const result = await db.execute(sql`
    update follow_up_plans
    -- A re-read that fell back to code's default goal keeps the one the note gave.
    set goal = ${plan.provenance.goal === "default" ? sql`coalesce(goal, ${plan.goal})` : plan.goal},
        watch_points = ${JSON.stringify(topics)}::jsonb,
        result_schema = ${JSON.stringify(buildResultSchema(topics))}::jsonb,
        updated_at = now()
    where id = ${planId} and status in ('awaiting_approval', 'active', 'paused')
    returning id
  `);
  return { ok: result.rows.length > 0, added };
}
