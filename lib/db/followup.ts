/**
 * The latest reading of one follow-up, for the doctor's patient view.
 *
 * The condition summary is written by the tick after every call the assistant
 * read cleanly (`lib/schedule/tick.ts`); the newest triage row says whether the
 * latest call could be read at all, so a failed read shows as "unavailable"
 * rather than letting an older summary pass for current.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { extractFindings, type Finding } from "@/lib/plan/extract";
import type { TopicUnit } from "@/lib/plan/result-schema";

export interface LatestReading {
  conditionSummary: string | null;
  conditionSummaryAt: Date | null;
  /** The latest call's triage failed, so the summary is older than it. */
  summaryUnavailable: boolean;
  /** The patient's own words the latest triage quoted, if any. */
  quote: string | null;
  quoteCallId: string | null;
}

/** The latest thing the patient said about one of the note's topics. */
export interface TopicFinding {
  topic: string;
  /** The note's words the topic came from. */
  quote: string;
  value: number | null;
  unit: TopicUnit | null;
  answer: string | null;
  patientWords: string | null;
  clarity: Finding["clarity"];
  callId: string | null;
  at: Date | null;
}

/**
 * The newest answer to each topic, from the calls that actually discussed it.
 *
 * A call that never got to a topic does not blank yesterday's answer: the most
 * recent call where it came up is the one shown, dated, so the doctor can see
 * how old it is.
 */
export async function getTopicFindings(
  planId: string,
  topics: { text: string; quote: string; unit?: TopicUnit | null }[],
): Promise<TopicFinding[]> {
  if (topics.length === 0) return [];
  const rows = await getDb().execute(sql`
    select id, structured_result, finished_at from scheduled_calls
    where plan_id = ${planId} and structured_result is not null
      and outcome in ('answered', 'flagged', 'unmappable')
    order by finished_at desc nulls last
    limit 40
  `);
  const calls = (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    at: r.finished_at ? new Date(String(r.finished_at)) : null,
    findings: extractFindings(
      (r.structured_result ?? null) as Record<string, unknown> | null,
      topics.map((t) => ({ text: t.text, unit: t.unit ?? null })),
    ),
  }));

  return topics.map((t, i) => {
    const hit = calls.find((c) => {
      const f = c.findings[i];
      return f && (f.value !== null || f.answer || f.patientWords) && f.clarity !== "not_discussed";
    });
    const f = hit?.findings[i];
    return {
      topic: t.text,
      quote: t.quote,
      value: f?.value ?? null,
      unit: t.unit ?? null,
      answer: f?.answer ?? null,
      patientWords: f?.patientWords ?? null,
      clarity: f?.clarity ?? null,
      callId: hit?.id ?? null,
      at: hit?.at ?? null,
    };
  });
}

export async function getLatestReading(planId: string): Promise<LatestReading> {
  const rows = await getDb().execute(sql`
    select p.condition_summary, p.condition_summary_at,
           t.status as triage_status, t.quote, t.call_id
    from follow_up_plans p
    left join lateral (
      select status, quote, call_id from call_triage
      where plan_id = p.id order by created_at desc limit 1
    ) t on true
    where p.id = ${planId}
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  if (!r) {
    return { conditionSummary: null, conditionSummaryAt: null, summaryUnavailable: false, quote: null, quoteCallId: null };
  }
  return {
    conditionSummary: r.condition_summary ? String(r.condition_summary) : null,
    conditionSummaryAt: r.condition_summary_at ? new Date(String(r.condition_summary_at)) : null,
    summaryUnavailable: r.triage_status ? String(r.triage_status) !== "ok" : false,
    quote: r.quote ? String(r.quote) : null,
    quoteCallId: r.call_id ? String(r.call_id) : null,
  };
}
