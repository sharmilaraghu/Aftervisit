/**
 * Environment, parsed once and in one place.
 *
 * **What authorises a call.** The gate is the patient's recorded consent plus a
 * clinician approving their plan — not an environment variable. A doctor enters
 * a number, records that the patient agreed to automated follow-up, approves the
 * plan, and Care Loop calls that number. Requiring an operator to also paste the
 * number into `CARELOOP_CALL_ALLOWLIST` describes a demo, not a product: no real
 * practice can redeploy to enrol a patient.
 *
 * The allowlist survives as an **optional deployment lock**, because it answers
 * a different question from consent. Consent asks "did this patient agree?";
 * the allowlist asks "is this instance allowed to reach the outside world at
 * all?" — which is the question you want a hard answer to when the console is
 * on a public URL with no login, where anyone who can load the page can enrol a
 * patient. Set `CARELOOP_CALL_ALLOWLIST` to a list of numbers and the scheduler
 * will dial only those. Leave it unset and consent is the only gate.
 *
 * **So: unset is open.** That is a deliberate inversion of how this used to
 * work, and the risk it carries is exactly the public-no-auth deployment above.
 * Set the list there.
 */

export interface CareLoopConfig {
  /** Calls are live whenever CALL-E has a key. There is no separate switch. */
  liveCallsEnabled: boolean;
  /** When non-empty, the only numbers the scheduler may dial. */
  callAllowlist: string[];
  /**
   * True when no list restricts the scheduler, which is the default.
   *
   * Consent is still enforced — `lib/calle/port.ts` refuses to dial a patient
   * who has not agreed, whatever this says.
   */
  allowlistOpen: boolean;
  /** How the agent sounds. The only voice control the API exposes. */
  callLocale: string;
  /** Shared secret guarding POST /api/tick. */
  tickToken: string | null;
  /**
   * Vercel's own cron secret, guarding GET /api/cron/tick.
   *
   * A separate door from `/api/tick` because Vercel's scheduler issues a plain
   * GET and cannot set a custom header — it sends `Authorization: Bearer` with
   * this value instead. Rather than weaken the POST route into accepting GET,
   * which would put a mutation behind a method that is meant to be safe, the
   * two triggers keep their own entrances and call the same `tick()`.
   *
   * Unset means that door is shut, exactly as an unset tick token shuts the
   * other one.
   */
  cronSecret: string | null;
  /**
   * Shared secret guarding POST /api/calle/webhook.
   *
   * CALL-E's webhooks are unsigned, so this is not authentication — a query
   * token only keeps stray traffic out. The receiver re-fetches the call
   * through the authenticated API before believing anything, which is what
   * actually makes the endpoint safe.
   */
  webhookToken: string | null;
  /**
   * Where this instance is reachable from the internet, if it is.
   *
   * Unset on a laptop, and that is the normal case: without a public URL there
   * is nothing to hand CALL-E, so no `webhookUrl` is sent and the reconciler
   * stays the only way a finished call is noticed.
   */
  publicUrl: string | null;
  /**
   * Who the agent says it is calling for, and from where.
   *
   * These are **spoken to the patient** — "this is {practice}'s AI assistant
   * calling on behalf of {clinician}" — and they were hardcoded at the dial
   * site. They are also written into `approved_by` and `resolved_by`, so the
   * audit trail recorded a fixture name for every clinical action.
   *
   * The fixture names remain the defaults, because this is a demo build and a
   * blank practice name in the agent's opening line would be worse than a
   * fictional one.
   */
  practiceName: string;
  clinicianName: string;
}

/** Still accepted, and still means open — now the same as leaving it unset. */
const OPEN = "*";

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): CareLoopConfig {
  const entries = parseAllowlist(env.CARELOOP_CALL_ALLOWLIST);
  const numbers = entries.filter((n) => n !== OPEN);

  return {
    liveCallsEnabled: Boolean(env.CALLE_API_KEY),
    callAllowlist: numbers,
    /* Unset, empty, or an explicit `*` — all mean "no list restricts this
       instance". Only a list of actual numbers narrows it. */
    allowlistOpen: numbers.length === 0,
    callLocale: env.CARELOOP_CALL_LOCALE || "en-US",
    tickToken: env.CARELOOP_TICK_TOKEN || null,
    cronSecret: env.CRON_SECRET || null,
    webhookToken: env.CARELOOP_WEBHOOK_TOKEN || null,
    publicUrl: (env.CARELOOP_PUBLIC_URL || "").replace(/\/+$/, "") || null,
    practiceName: env.CARELOOP_PRACTICE_NAME || "Banyan Family Clinic",
    clinicianName: env.CARELOOP_CLINICIAN_NAME || "Dr Rao",
  };
}
