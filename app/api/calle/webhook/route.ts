/**
 * CALL-E's door, for the moment a call ends.
 *
 * Without this, a finished call is only noticed when some later tick happens to
 * poll for it — so a patient could say something urgent and the escalation
 * would wait for the next page load. This closes that gap.
 *
 * **Nothing in the request body is believed.** Webhook deliveries are unsigned,
 * so anyone who learns the URL can post anything to it. The receiver takes one
 * field — the call id — and then re-fetches the whole call through the
 * authenticated API, which is CALL-E's own guidance and the only thing that
 * makes an unsigned notification safe to act on. The token in the query string
 * is not authentication either; it only keeps stray traffic out of the handler.
 *
 * **It never answers 4xx for an unknown call.** Delivery is at-least-once, and
 * a sender that sees an error retries — so refusing an id we do not recognise
 * would buy a retry storm and nothing else. Unknown is `200 { ignored }`.
 *
 * **Duplicate deliveries are already free.** `completeCall` ignores a call that
 * is not terminal, `finishCall` is a single conditional update that only one
 * caller wins, and slots, escalations and triage all land behind unique
 * indexes. Five deliveries of the same call finish it once.
 */

import { readConfig } from "@/lib/config";
import { callePortFromEnv } from "@/lib/calle/port";
import { findCallByCalleId } from "@/lib/schedule/store";
import { readWebhookRequest } from "@/lib/calle/webhook";
import { completeCall, loadContext } from "@/lib/schedule/tick";
import type { TickCounters } from "@/lib/schedule/store";

export const dynamic = "force-dynamic";

const EMPTY: TickCounters = {
  retired: 0,
  claimed: 0,
  dialed: 0,
  refused: 0,
  finished: 0,
  escalated: 0,
  expanded: 0,
};

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* Not JSON at all. `readWebhookRequest` turns that into the same 400 a
       body with no id gets, so the token is still checked first. */
  }

  const read = readWebhookRequest(request.url, body, readConfig().webhookToken);
  if (!read.ok) return Response.json({ error: read.error }, { status: read.status });
  const { calleCallId } = read;

  const row = await findCallByCalleId(calleCallId);
  if (!row) return Response.json({ ignored: true, reason: "unknown call" });

  const ctx = await loadContext({
    ...row,
    idempotencyKey: "",
    scheduledFor: new Date(),
  });
  if (!ctx) return Response.json({ ignored: true, reason: "plan no longer exists" });

  const counters: TickCounters = { ...EMPTY };
  try {
    const call = await callePortFromEnv().fetchCall(calleCallId);
    await completeCall(ctx, call, counters);
  } catch (error) {
    /*
     * A call CALL-E cannot describe yet is not a failure of ours. Say so with a
     * 200: the reconciler picks it up on the next tick, and a 500 here would
     * only ask an at-least-once sender to try the same thing again.
     */
    return Response.json({
      ignored: true,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return Response.json({ ok: true, finished: counters.finished, escalated: counters.escalated });
}

export async function GET() {
  return Response.json(
    { error: "POST only. This is CALL-E's callback, not a page." },
    { status: 405 },
  );
}
