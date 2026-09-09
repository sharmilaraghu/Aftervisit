/**
 * Storing what a model made of a call.
 *
 * One row per call, enforced by `uniq_triage_call`. That index is not hygiene:
 * `completeCall` is reached by both the waiter and the reconciler, and without
 * it a re-read of a finished call would pay for the model twice and could write
 * two different verdicts for the same conversation.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/ids";
import type { TriageOutcome } from "@/lib/triage/triage";

export interface StoredTriage {
  id: string;
  status: string;
  verdict: string;
  reason: string;
  summary: string | null;
  keyTerms: string[];
  matchedConcerns: string[];
  quote: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  createdAt: Date;
}

/**
 * Write a verdict, once.
 *
 * Returns the existing row's id when one is already there, so a caller can link
 * an escalation to it either way — a reconcile that arrives second still gets a
 * usable id rather than a null it would have to special-case.
 */
export async function saveTriage(input: {
  callId: string;
  patientId: string;
  planId: string;
  outcome: TriageOutcome;
}): Promise<{ id: string; fresh: boolean }> {
  const db = getDb();
  const id = newId("tri");
  const { outcome } = input;

  const inserted = await db.execute(sql`
    insert into call_triage
      (id, call_id, patient_id, plan_id, status, verdict, reason, summary,
       key_terms, matched_concerns, quote, provider, model, raw, error)
    values (${id}, ${input.callId}, ${input.patientId}, ${input.planId},
            ${outcome.status}, ${outcome.answer.verdict}, ${outcome.answer.reason},
            ${outcome.answer.summary || null},
            ${JSON.stringify(outcome.answer.keyTerms)}::jsonb,
            ${JSON.stringify(outcome.answer.matchedConcerns)}::jsonb,
            ${outcome.answer.quote || null}, ${outcome.provider}, ${outcome.model},
            ${outcome.raw === null || outcome.raw === undefined ? null : JSON.stringify(outcome.raw)}::jsonb,
            ${outcome.error})
    on conflict (call_id) do nothing
    returning id
  `);
  if (inserted.rows.length > 0) return { id, fresh: true };

  const existing = await db.execute(sql`
    select id from call_triage where call_id = ${input.callId}
  `);
  return { id: String((existing.rows[0] as Record<string, unknown>).id), fresh: false };
}

/** One call's verdict, for the queue and the call page. */
export async function getTriage(callId: string): Promise<StoredTriage | null> {
  const result = await getDb().execute(sql`
    select id, status, verdict, reason, summary, key_terms, matched_concerns,
           quote, provider, model, error, created_at
    from call_triage where call_id = ${callId}
  `);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  return {
    id: String(r.id),
    status: String(r.status),
    verdict: String(r.verdict),
    reason: String(r.reason),
    summary: r.summary ? String(r.summary) : null,
    keyTerms: (r.key_terms ?? []) as string[],
    matchedConcerns: (r.matched_concerns ?? []) as string[],
    quote: r.quote ? String(r.quote) : null,
    provider: r.provider ? String(r.provider) : null,
    model: r.model ? String(r.model) : null,
    error: r.error ? String(r.error) : null,
    createdAt: new Date(String(r.created_at)),
  };
}
