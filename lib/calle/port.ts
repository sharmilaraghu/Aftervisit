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
 *   3. the number is on the dial allowlist
 *   4. there is an API key
 *
 * Rule 3 deserves a note. OpenLine, the sibling project, gates every call behind
 * a human pressing a button per candidate. Care Loop cannot have that gate —
 * its whole premise is that nobody has to press anything — so the allowlist IS
 * that gate, moved into code. A number that is not on it is refused with a
 * reason the UI prints. It is never silently skipped, and it is never quietly
 * turned into a no-op that looks like success.
 *
 * `dial()` returns a tagged outcome and never throws: one unreachable patient
 * must not stop the scheduler working through the rest of the queue.
 */

import { CalleClient, type Call, type JsonObject } from "@call-e/calle";
import { inspectTask, type GuardFinding } from "@/lib/script/guard";
import { readConfig } from "@/lib/config";

export interface CallePortConfig {
  apiKey: string;
  locale?: string;
  baseUrl?: string;
  /** The only numbers this port may dial. Empty means: dial nobody. */
  allowlist?: string[];
  /** `CARELOOP_CALL_ALLOWLIST=*`: any number on an approved plan may be dialled. */
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
}

export type RefusalReason =
  | "guard_violation"
  | "invalid_phone"
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
  not_allowlisted:
    "This number is not on the dial allowlist. Care Loop's scheduler dials without anyone pressing a button, so it only calls numbers that were explicitly armed.",
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
       * 3. The allowlist — the gate that replaces the missing human.
       *
       * `allowlistOpen` is an explicit opt-out, never a default: an absent or
       * empty list still refuses everything, so forgetting to configure the
       * allowlist can only ever fail closed.
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
              },
            ],
            resultSchema: request.resultSchema,
            ...(request.metadata ? { metadata: request.metadata } : {}),
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
