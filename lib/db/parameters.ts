/**
 * A patient's answers across the whole window.
 *
 * The one read that turns `extracted_slots` from a per-call detail into the
 * thing a clinician actually wants: parameters down, days across. Everything the
 * agent has collected has been in the database all along and no screen showed it.
 *
 * What counts as an escalating value comes from the **plan's own rules**, so a
 * cell is never toned by a guess — it is toned by what the doctor said matters.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import type { AnswerType, SlotStatus } from "@/lib/db/enums";
import type { PlanRule } from "@/lib/rules/types";
import type { ParameterReading, ParameterRow } from "@/lib/patients/parameters";

/** Pull each question's escalating values out of the rules the doctor approved. */
function escalationFor(rules: PlanRule[], questionId: string) {
  let escalatingValues: string[] = [];
  let escalatingBool: boolean | null = null;
  let threshold: number | null = null;

  for (const { rule } of rules) {
    if (rule.kind === "enum_in" && rule.questionId === questionId) {
      escalatingValues = [...escalatingValues, ...rule.values];
    }
    if (rule.kind === "boolean_equals" && rule.questionId === questionId) {
      escalatingBool = rule.value;
    }
    if (rule.kind === "scale_at_least" && rule.questionId === questionId) {
      threshold = rule.threshold;
    }
  }
  return { escalatingValues, escalatingBool, threshold };
}

export interface ParameterHistory {
  rows: ParameterRow[];
  /** Occurrence numbers in the window, so every row shares one x-axis. */
  occurrences: number[];
}

export async function getParameterHistory(patientId: string): Promise<ParameterHistory> {
  const db = getDb();

  const planRows = await db.execute(sql`
    select id, rules, duration_days
    from follow_up_plans
    where patient_id = ${patientId} and status <> 'cancelled'
    order by created_at desc
    limit 1
  `);
  const plan = (planRows.rows as Record<string, unknown>[])[0];
  if (!plan) return { rows: [], occurrences: [] };

  const planId = String(plan.id);
  const rules = (plan.rules ?? []) as PlanRule[];

  /*
   * One row per (question, occurrence), including occurrences with no slot yet —
   * a day not answered has to hold its column, or the shared axis stops lining
   * up and the matrix cannot be read downward.
   */
  const result = await db.execute(sql`
    select q.question_id, q.prompt, q.answer_type, q.enum_values, q.ordinal,
           c.occurrence, c.id as call_id,
           s.status, s.value_bool, s.value_number, s.value_text, s.utterance
    from plan_questions q
    cross join (
      select distinct occurrence from scheduled_calls where plan_id = ${planId}
    ) occ
    left join scheduled_calls c
      on c.plan_id = ${planId} and c.occurrence = occ.occurrence and c.attempt = 1
    left join extracted_slots s
      on s.call_id = c.id and s.question_id = q.question_id
    where q.plan_id = ${planId} and q.guard_status = 'approved'
    order by q.ordinal, occ.occurrence
  `);

  const byQuestion = new Map<string, ParameterRow>();
  const occurrences = new Set<number>();

  for (const r of result.rows as Record<string, unknown>[]) {
    const questionId = String(r.question_id);
    occurrences.add(Number(r.occurrence));

    if (!byQuestion.has(questionId)) {
      byQuestion.set(questionId, {
        questionId,
        prompt: String(r.prompt),
        answerType: String(r.answer_type) as AnswerType,
        enumValues: (r.enum_values ?? null) as string[] | null,
        readings: [],
        ...escalationFor(rules, questionId),
      });
    }

    const reading: ParameterReading = {
      occurrence: Number(r.occurrence),
      status: r.status ? (String(r.status) as SlotStatus) : null,
      valueBool: r.value_bool === null || r.value_bool === undefined ? null : Boolean(r.value_bool),
      valueNumber:
        r.value_number === null || r.value_number === undefined ? null : Number(r.value_number),
      valueText: r.value_text ? String(r.value_text) : null,
      utterance: r.utterance ? String(r.utterance) : null,
      callId: r.call_id ? String(r.call_id) : null,
    };
    byQuestion.get(questionId)!.readings.push(reading);
  }

  return {
    rows: [...byQuestion.values()],
    occurrences: [...occurrences].sort((a, b) => a - b),
  };
}

/**
 * The worst signal per patient, for the roster's "What's off" column.
 *
 * One query for the whole roster rather than one per patient — the roster is the
 * hottest read in the application and N+1 there would be felt.
 */
export async function getRosterSignals(): Promise<
  Map<string, { questionId: string; detail: string; kind: string }>
> {
  const db = getDb();
  const out = new Map<string, { questionId: string; detail: string; kind: string }>();

  const result = await db.execute(sql`
    select s.patient_id, s.question_id, s.value_number, s.value_text, s.value_bool,
           s.status, c.occurrence, p.rules, q.answer_type
    from extracted_slots s
    join scheduled_calls c on c.id = s.call_id
    join follow_up_plans p on p.id = c.plan_id and p.status in ('active','paused')
    left join plan_questions q on q.plan_id = p.id and q.question_id = s.question_id
    order by s.patient_id, s.question_id, c.occurrence
  `);

  // Grouped in TS rather than SQL: the signal functions are pure and already
  // tested, and duplicating their logic in a window function would be two
  // definitions of "rising" that could disagree.
  const grouped = new Map<string, ParameterRow>();
  for (const r of result.rows as Record<string, unknown>[]) {
    const patientId = String(r.patient_id);
    const questionId = String(r.question_id);
    const key = `${patientId}::${questionId}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        questionId,
        prompt: "",
        answerType: String(r.answer_type ?? "text") as AnswerType,
        enumValues: null,
        readings: [],
        ...escalationFor((r.rules ?? []) as PlanRule[], questionId),
      });
    }
    grouped.get(key)!.readings.push({
      occurrence: Number(r.occurrence),
      status: String(r.status) as SlotStatus,
      valueBool: r.value_bool === null || r.value_bool === undefined ? null : Boolean(r.value_bool),
      valueNumber:
        r.value_number === null || r.value_number === undefined ? null : Number(r.value_number),
      valueText: r.value_text ? String(r.value_text) : null,
      utterance: null,
      callId: null,
    });
  }

  const { worstSignal } = await import("@/lib/patients/parameters");
  const byPatient = new Map<string, ParameterRow[]>();
  for (const [key, row] of grouped) {
    const patientId = key.split("::")[0];
    byPatient.set(patientId, [...(byPatient.get(patientId) ?? []), row]);
  }

  for (const [patientId, rows] of byPatient) {
    const signal = worstSignal(rows);
    if (signal) {
      out.set(patientId, {
        questionId: signal.questionId,
        detail: signal.detail,
        kind: signal.kind,
      });
    }
  }
  return out;
}
