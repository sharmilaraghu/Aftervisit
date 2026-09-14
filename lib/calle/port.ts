/**
 * The only door to CALL-E.
 *
 * Nothing else in this codebase may import `@call-e/calle`. Every refusal rule
 * lives inside `dial()` rather than at the call sites, so no code path — present
 * or future — can skip one by forgetting to.
 *
 * The rules, in order:
 *   1. the assembled script passes the clinical guard
 *   2. the number is E.164
 *   3. this patient consented to automated calls
 *   4. the number passes the deployment lock, when one is configured
 *   5. there is an API key
 *
 * Rule 3 is the one that authorises a call. OpenLine, the sibling project, gates
 * every call behind a human pressing a button per candidate. Care Loop cannot
 * have that gate — its whole premise is that nobody has to press anything — so
 * the human act moved earlier: a clinician records that this patient agreed, and
 * approves their plan. Consent is checked here rather than at the call sites so
 * no future code path can dial a patient who never agreed.
 *
 * Rule 4 used to be rule 3 and used to be mandatory. It answers a different
 * question — not "did this patient agree?" but "may this instance reach the
 * outside world at all?" — and it is the right answer for a console on a public
 * URL with no login. Unset, it does not narrow anything.
 *
 * A refusal is always printed on the call row with its reason. It is never
 * silently skipped, and never quietly turned into a no-op that looks like
 * success.
 *
 * `dial()` returns a tagged outcome and never throws: one unreachable patient
 * must not stop the scheduler working through the rest of the queue.
 */

import { CalleClient, type Call, type JsonObject } from "@call-e/calle";
import { inspectTask, type GuardFinding } from "@/lib/script/guard";
import { readConfig } from "@/lib/config";
import { RECIPIENT_RESULT_SCHEMA } from "@/lib/plan/result-schema";
import { regionForPhone } from "@/lib/phone/normalize";

export interface CallePortConfig {
  apiKey: string;
  locale?: string;
  baseUrl?: string;
  /** The deployment lock: the only numbers dialled. Absent or empty refuses every number. */
  allowlist?: string[];
  /** True only when an operator opened the lock with `*`. Never the default. */
  allowlistOpen?: boolean;
  /** Injectable so the whole suite can run against the fake server. */
  fetch?: (input: Request) => Promise<Response>;
}

export interface DialRequest {
  task: string;
  phone: string;
  resultSchema: JsonObject;
  metadata?: JsonObject;
  /**
   * Business-stable, not a random UUID: `${planId}:o${occurrence}:a${attempt}`.
   * A key regenerated on retry would defeat the deduplication entirely.
   */
  idempotencyKey: string;
  /** Questions already cleared by guard phase 1, so phase 2 can exempt them. */
  approvedQuestions?: string[];
  /** Sentences the clinician actually wrote. */
  clinicianStatements?: string[];
  /** Per-patient BCP 47 locale. Falls back to the port's global locale. */
  locale?: string;
  /**
   * Whether this patient agreed to be called by an automated agent.
   *
   * Required, and deliberately not optional-with-a-default: a call site that
   * forgets to pass it fails to compile rather than dialling someone who never
   * agreed. This is the gate the dial allowlist used to stand in for.
   */
  consentGranted: boolean;
  /**
   * Where CALL-E should post when this call ends.
   *
   * Optional because it is often absent: on a laptop there is no public URL to
   * give, and the reconciler finishes the call on the next tick instead. It is
   * a prompt, never a guarantee — the delivery is unsigned and at-least-once,
   * so the receiver re-fetches through the API before trusting a word of it.
   */
  webhookUrl?: string;
}

export type RefusalReason =
  | "guard_violation"
  | "invalid_phone"
  | "no_consent"
  | "not_allowlisted"
  | "missing_api_key"
  | "api_error";

export type DialOutcome =
  | { ok: true; call: Call }
  | { ok: false; refusal: RefusalReason; detail: string; findings?: GuardFinding[] };

export interface CallePort {
  dial(request: DialRequest): Promise<DialOutcome>;
  fetchCall(callId: string): Promise<Call>;
  waitForCall(callId: string, options?: { timeoutMs?: number; intervalMs?: number }): Promise<Call>;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Human-readable text for a refusal, for printing on the call row. */
export const REFUSAL_TEXT: Record<RefusalReason, string> = {
  guard_violation: "The script did not pass the clinical guard, so nothing was dialled.",
  invalid_phone: "The number is not in E.164 form. Care Loop will not guess one.",
  no_consent:
    "This patient has not agreed to automated follow-up calls. Care Loop dials without anyone pressing a button, so consent recorded at enrolment is what authorises the call.",
  not_allowlisted:
    "This number is not on this instance's dial allowlist. Set CARELOOP_CALL_ALLOWLIST to the numbers it may call, or to * to allow any consenting patient. Unset, nothing is dialled.",
  missing_api_key: "No CALL-E API key is configured, so nothing can be dialled.",
  api_error: "CALL-E rejected the request.",
};

export function createCallePort(config: CallePortConfig): CallePort {
  const client = () =>
    new CalleClient({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });

  return {
    async dial(request: DialRequest): Promise<DialOutcome> {
      // 1. The guard. Fourth and last inspection of this text — not redundant:
      //    it is what makes it impossible for a new call site to dial something
      //    nothing has checked.
      const guard = inspectTask(request.task, {
        approvedQuestions: request.approvedQuestions,
        clinicianStatements: request.clinicianStatements,
      });
      if (!guard.ok) {
        return {
          ok: false,
          refusal: "guard_violation",
          detail: guard.findings.map((f) => `${f.category}: ${f.match || "missing"}`).join("; "),
          findings: guard.findings,
        };
      }

      // 2. E.164. Produced upstream by lib/phone/normalize.ts, re-checked here.
      if (!E164.test(request.phone)) {
        return {
          ok: false,
          refusal: "invalid_phone",
          detail: REFUSAL_TEXT.invalid_phone,
        };
      }

      /*
       * 3. Consent — what actually authorises this call.
       *
       * Checked before the deployment lock because it is the clinical gate: a
       * patient who never agreed must not be dialled even from a machine whose
       * allowlist would happily permit it.
       */
      if (!request.consentGranted) {
        return {
          ok: false,
          refusal: "no_consent",
          detail: REFUSAL_TEXT.no_consent,
        };
      }

      /*
       * 4. The deployment lock. Closed unless an operator lists this number
       *    or opens it with `*` — so a fresh clone or deploy dials nobody.
       */
      const allowlist = config.allowlist ?? [];
      if (!config.allowlistOpen && !allowlist.includes(request.phone)) {
        return {
          ok: false,
          refusal: "not_allowlisted",
          detail: REFUSAL_TEXT.not_allowlisted,
        };
      }

      if (!config.apiKey) {
        return {
          ok: false,
          refusal: "missing_api_key",
          detail: REFUSAL_TEXT.missing_api_key,
        };
      }

      const region = regionForPhone(request.phone);

      try {
        const call = await client().calls.create(
          {
            task: request.task,
            recipients: [
              {
                phones: [request.phone],
                // Per-patient language wins; the env-level locale is the fallback.
                ...((request.locale ?? config.locale)
                  ? { locale: request.locale ?? config.locale }
                  : {}),
                /*
                 * The country to route through, derived from the number itself.
                 *
                 * Omitting this is not a missing hint, it is a missing route.
                 * CALL-E's schema calls `region` the code "used for routing and
                 * compliance checks"; without one it resolved nothing, and three
                 * calls to a valid +91 mobile came back region null, SIP 404 and
                 * zero seconds of call duration. The same number dialled from
                 * CALL-E's dashboard, which supplies a region, connected.
                 *
                 * Derived here rather than taken from the caller so that no
                 * dial site can forget it — the same reason the guard, the
                 * E.164 check and the consent gate all live inside `dial()`.
                 */
                ...(region ? { region } : {}),
              },
            ],
            resultSchema: request.resultSchema,
            /* Who picked up. CALL-E has no built-in answered-by field; the
               documented way to get one is exactly this. */
            recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
            ...(request.metadata ? { metadata: request.metadata } : {}),
            ...(request.webhookUrl ? { webhookUrl: request.webhookUrl } : {}),
          },
          { idempotencyKey: request.idempotencyKey },
        );
        return { ok: true, call };
      } catch (error) {
        // A failed create is a refusal, not an exception: the scheduler has more
        // rows to work through and one bad call must not stop the queue.
        return {
          ok: false,
          refusal: "api_error",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async fetchCall(callId: string): Promise<Call> {
      return client().calls.get(callId);
    },

    async waitForCall(callId, options = {}): Promise<Call> {
      return client().calls.waitForResult(callId, {
        // A follow-up call runs longer than the SDK's default patience.
        timeoutMs: options.timeoutMs ?? 10 * 60_000,
        intervalMs: options.intervalMs ?? 4_000,
      });
    },
  };
}

export function callePortFromEnv(env: NodeJS.ProcessEnv = process.env): CallePort {
  const config = readConfig(env);
  return createCallePort({
    apiKey: env.CALLE_API_KEY ?? "",
    locale: config.callLocale,
    allowlist: config.callAllowlist,
    allowlistOpen: config.allowlistOpen,
    ...(env.CALLE_BASE_URL ? { baseUrl: env.CALLE_BASE_URL } : {}),
  });
}
