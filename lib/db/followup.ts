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

export interface LatestReading {
  conditionSummary: string | null;
  conditionSummaryAt: Date | null;
  /** The latest call's triage failed, so the summary is older than it. */
  summaryUnavailable: boolean;
  /** The patient's own words the latest triage quoted, if any. */
  quote: string | null;
  quoteCallId: string | null;
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
