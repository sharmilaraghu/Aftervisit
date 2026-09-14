/**
 * What a webhook delivery is allowed to tell us.
 *
 * The answer is: one call id, and nothing else. Deliveries are unsigned, so the
 * body is a claim made by an anonymous caller — the receiver looks the id up
 * and re-fetches the call through the authenticated API rather than believing
 * any status, result or transcript the post carries.
 *
 * Kept out of the route so the refusals are testable on zero credentials. The
 * route does the IO; this decides whether there is any IO worth doing.
 */

export type WebhookRead =
  | { ok: true; calleCallId: string }
  | { ok: false; status: 400 | 401 | 503; error: string };

/**
 * `body` is deliberately `unknown`: it arrived over the wire from a caller we
 * cannot authenticate, and typing it as anything else would be a fiction.
 */
export function readWebhookRequest(
  url: string,
  body: unknown,
  token: string | null,
): WebhookRead {
  // Unset means closed, not open — the same stance /api/tick takes.
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: "AFTER_VISIT_WEBHOOK_TOKEN is not set. The webhook endpoint is closed.",
    };
  }

  if (new URL(url).searchParams.get("t") !== token) {
    return { ok: false, status: 401, error: "Bad or missing token." };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "Body was not a JSON object." };
  }

  /* Three spellings because the delivery format is not something we control,
     and a missed id costs a whole call's result. Everything else is dropped. */
  const fields = body as { callId?: unknown; call_id?: unknown; id?: unknown };
  const raw = fields.callId ?? fields.call_id ?? fields.id;
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, status: 400, error: "No call id in the body." };
  }

  return { ok: true, calleCallId: raw.trim() };
}
