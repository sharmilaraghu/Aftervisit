/**
 * The answer grid — one question down, one day across.
 *
 * `lib/patients/parameters.ts` has been able to read this matrix since it was
 * written and nothing ever handed it one. The week band says whether we
 * *reached* the patient; this says what they *said*, which is the question a
 * course of follow-up exists to ask and the one no single call can answer.
 *
 * Two rules from `queries.ts` hold here too: never `select *` on
 * `scheduled_calls`, and keep the joins shallow.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import type { AnswerType, SlotStatus } from "@/lib/db/enums";
import type { ParameterReading, ParameterRow } from "@/lib/patients/parameters";
import {
  OBSERVED_QUESTION_IDS,
  UNSPOKEN_RESULT_KEYS,
  escalatingFor,
} from "@/lib/plan/universal-questions";

/**
 * Machinery, not clinical parameters.
 *
 * `reached_patient` and `consent_given` are how a call works, not what a patient
 * reported, and a grid that opens with two rows of `Y Y Y` buries the row that
 * matters. The observed ids are never spoken at all.
 */
const NOT_A_PARAMETER = new Set<string>([
  "reached_patient",
  "consent_given",
  ...OBSERVED_QUESTION_IDS,
  ...UNSPOKEN_RESULT_KEYS,
]);

/**
 * Every parameter this plan collects, with one reading per scheduled day.
 *
 * Days with no answer are still columns — a gap in the middle of a week is a
 * fact about the follow-up, and a grid that silently closed up would hide the
 * exact thing this product exists to notice.
 */
export async function getParameterGrid(planId: string): Promise<ParameterRow[]> {
  const db = getDb();

  const [questions, slots, occurrences] = await Promise.all([
    db.execute(sql`
      select question_id, prompt, answer_type, enum_values, ordinal
      from plan_questions
      where plan_id = ${planId}
      order by ordinal
    `),
    /*
     * One reading per (question, day). A day can hold three attempts and at most
     * one of them reached anybody, so `distinct on` takes the newest slot for
     * the day rather than letting attempt 3's silence overwrite attempt 1's
     * answer.
     */
    db.execute(sql`
      select distinct on (s.question_id, c.occurrence)
             s.question_id, c.occurrence, s.status,
             s.value_bool, s.value_number, s.value_text, s.utterance, s.call_id
      from extracted_slots s
      join scheduled_calls c on c.id = s.call_id
      where c.plan_id = ${planId}
      order by s.question_id, c.occurrence, s.status = 'answered' desc, c.attempt desc
    `),
    db.execute(sql`
      select distinct occurrence from scheduled_calls
      where plan_id = ${planId} order by occurrence
    `),
  ]);

  const days = (occurrences.rows as Record<string, unknown>[]).map((r) => Number(r.occurrence));

  const byQuestion = new Map<string, Map<number, ParameterReading>>();
  for (const r of slots.rows as Record<string, unknown>[]) {
    const questionId = String(r.question_id);
    if (!byQuestion.has(questionId)) byQuestion.set(questionId, new Map());
    byQuestion.get(questionId)!.set(Number(r.occurrence), {
      occurrence: Number(r.occurrence),
      status: r.status ? (String(r.status) as SlotStatus) : null,
      valueBool: r.value_bool === null || r.value_bool === undefined ? null : Boolean(r.value_bool),
      valueNumber:
        r.value_number === null || r.value_number === undefined ? null : Number(r.value_number),
      valueText: r.value_text ? String(r.value_text) : null,
      utterance: r.utterance ? String(r.utterance) : null,
      callId: r.call_id ? String(r.call_id) : null,
    });
  }

  return (questions.rows as Record<string, unknown>[])
    .filter((q) => !NOT_A_PARAMETER.has(String(q.question_id)))
    .map((q) => {
      const questionId = String(q.question_id);
      const readings = byQuestion.get(questionId) ?? new Map<number, ParameterReading>();

      return {
        questionId,
        prompt: String(q.prompt),
        answerType: String(q.answer_type) as AnswerType,
        enumValues: Array.isArray(q.enum_values) ? (q.enum_values as unknown[]).map(String) : null,
        /*
         * A day the plan scheduled but nothing answered is a `null` status, not
         * a missing column. `cellTone` renders that as untouched stock and
         * `cellTitle` says "not scheduled" — neither claims anything happened.
         */
        readings: days.map(
          (occurrence) =>
            readings.get(occurrence) ?? {
              occurrence,
              status: null,
              valueBool: null,
              valueNumber: null,
              valueText: null,
              utterance: null,
              callId: null,
            },
        ),
        /*
         * Which answers count as escalating comes from the universal question
         * set, where a clinician-visible constant declares it. A compiled
         * question has no opinion and gets none invented for it: deciding that
         * a 7 is worse than a 4 for *this* patient is a clinical judgement, and
         * this file does not make those. The grid still shows the numbers, and
         * `risingSignal` still points at the climb, which is arithmetic.
         */
        ...escalatingFor(questionId),
      };
    })
    .filter((row) => row.readings.some((r) => r.status !== null));
}
