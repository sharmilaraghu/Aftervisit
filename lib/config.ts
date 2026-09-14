/**
 * Environment, parsed once and in one place.
 *
 * **What authorises a call.** The gate is the patient's recorded consent plus a
 * clinician approving their plan — not an environment variable. A doctor enters
 * a number, records that the patient agreed to automated follow-up, approves the
 * plan, and AfterVisit calls that number. Requiring an operator to also paste the
 * number into `CARELOOP_CALL_ALLOWLIST` describes a demo, not a product: no real
 * practice can redeploy to enrol a patient.
 *
 * The allowlist is the **deployment lock**, and it answers a different question
 * from consent. Consent asks "did this patient agree?"; the allowlist asks "may
 * this instance reach the outside world at all?" — and on a public URL with no
 * login, where anyone who can load the page can enrol a patient and record
 * consent for them, that answer has to be no until an operator says otherwise.
 *
 * **So: unset is locked.**
 *
 *   unset / empty → no number may be dialled; every call is refused, visibly
 *   a list        → only those numbers
 *   `*`           → any consenting patient — an explicit, deliberate opening
 *
 * It used to be the other way round — unset meant consent was the only gate —
 * which made a fresh clone or a fresh deploy able to ring whoever a stranger
 * typed in. A no-call default is the safe one.
 */

export interface AfterVisitConfig {
  /** Calls are live whenever CALL-E has a key. There is no separate switch. */
  liveCallsEnabled: boolean;
  /** The only numbers the scheduler may dial, unless `*` opened the lock. Empty = none. */
  callAllowlist: string[];
  /**
   * True only when an operator set `CARELOOP_CALL_ALLOWLIST=*`. Never true by
   * default: an unset list locks the instance.
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
  /**
   * The passcode for the judges' instant call at /try.
   *
   * That page rings a typed number with nothing saved, and there is no login —
   * so unset keeps it shut, the same fail-closed stance as the tick token.
   */
  tryPasscode: string | null;
}

/** The one way to open the lock: an explicit `*`. */
const OPEN = "*";

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AfterVisitConfig {
  const entries = parseAllowlist(env.CARELOOP_CALL_ALLOWLIST);
  const numbers = entries.filter((n) => n !== OPEN);

  return {
    liveCallsEnabled: Boolean(env.CALLE_API_KEY),
    callAllowlist: numbers,
    /* Open only when someone wrote `*`. Unset or empty is locked: with no
       numbers listed, nothing matches, and every dial is refused. */
    allowlistOpen: entries.includes(OPEN),
    callLocale: env.CARELOOP_CALL_LOCALE || "en-US",
    tickToken: env.CARELOOP_TICK_TOKEN || null,
    cronSecret: env.CRON_SECRET || null,
    webhookToken: env.CARELOOP_WEBHOOK_TOKEN || null,
    publicUrl: (env.CARELOOP_PUBLIC_URL || "").replace(/\/+$/, "") || null,
    practiceName: env.CARELOOP_PRACTICE_NAME || "Banyan Family Clinic",
    clinicianName: env.CARELOOP_CLINICIAN_NAME || "Dr Rao",
    tryPasscode: env.CARELOOP_TRY_PASSCODE || null,
  };
}
