/**
 * An in-process fake of the CALL-E Developer API.
 *
 * `CalleClient` accepts a `fetch` implementation, so the whole SDK can be
 * exercised without a network, an API key, or a real phone call. This is what
 * makes Care Loop's test suite runnable by anyone who clones the repo with no
 * credentials at all.
 *
 * It fakes the HTTP API rather than the port, so responses use the wire format
 * (snake_case) and the SDK's own mapping layer is under test rather than
 * bypassed.
 *
 * Note the `outcome: "no_answer"` mode. Care Loop's retry ladder is driven by
 * real CALL-E failure codes, so the tests need a faithful unanswered call —
 * a completed call with an empty transcript would test the wrong thing.
 */

export type FakeOutcome = "completed" | "no_answer" | "failed";

export interface FakeCalleOptions {
  /** Structured result returned on a completed call. */
  structuredResult?: Record<string, unknown> | null;
  /** Transcript turns to return on the recipient's attempt. */
  transcriptTurns?: Array<{
    offset_seconds: number;
    speaker: "bot" | "user" | "unknown";
    text: string;
  }>;
  /** How the call ends. Defaults to `completed`. */
  outcome?: FakeOutcome;
  /** Make the API reject the create request outright. */
  failWith?: { status: number; code: string; message?: string };
  /** Post-summary confidence. */
  confidence?: { score: number; label: "low" | "medium" | "high" };
}

export interface FakeCalleFetch {
  (input: Request): Promise<Response>;
  /** Idempotency key seen on the most recent create request. */
  lastIdempotencyKey(): string | null;
  /** Bodies of every create request received. */
  createdCalls(): Array<Record<string, unknown>>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function createFakeCalleFetch(options: FakeCalleOptions = {}): FakeCalleFetch {
  const {
    structuredResult = {
      reached_patient: "yes",
      consent_given: "yes",
      requests_clinician: "no",
      emergency_language_heard: "no",
      call_recap: "Patient answered all questions.",
    },
    transcriptTurns = [
      { offset_seconds: 0, speaker: "bot" as const, text: "Hello, is this Asha?" },
      { offset_seconds: 3, speaker: "user" as const, text: "Yes, speaking." },
    ],
    outcome = "completed",
    failWith,
    confidence = { score: 0.92, label: "high" as const },
  } = options;

  let lastIdempotencyKey: string | null = null;
  const createdCalls: Array<Record<string, unknown>> = [];

  const reached = outcome === "completed";
  const failureCode =
    outcome === "no_answer" ? "no_answer" : outcome === "failed" ? "call_failed" : null;

  const buildCallTask = (id: string, task: string, phone: string) => ({
    id,
    object: "call_task",
    status: reached ? "completed" : "failed",
    task,
    recipients: [
      {
        id: "rcp_fake_1",
        phones: [phone],
        locale: null,
        region: null,
        status: reached ? "completed" : "failed",
        // An unanswered call has no structured result. That null is meaningful:
        // Care Loop treats it as "one unmappable slot per question", not as a
        // call that asked nothing.
        structured_result: reached ? structuredResult : null,
        summary: reached ? "Fake recipient summary." : null,
        attempts: [
          {
            id: "att_fake_1",
            phone,
            status: reached ? "completed" : "failed",
            started_at: "2026-08-16T10:00:00Z",
            completed_at: "2026-08-16T10:02:00Z",
            summary: reached ? "Fake attempt summary." : null,
            transcript_turns: reached ? transcriptTurns : [],
            provider_call_id: "provider_fake_1",
            failure_code: failureCode,
            failure_message:
              outcome === "no_answer"
                ? "The recipient did not answer."
                : outcome === "failed"
                  ? "The call could not be completed."
                  : null,
          },
        ],
      },
    ],
    structured_result: reached ? structuredResult : null,
    summary: reached ? "Fake call summary." : null,
    task_completed: reached,
    completion_confidence: reached ? confidence : null,
    evidence: reached ? ["The patient confirmed they are taking the medication."] : [],
    metadata: {},
    failure_code: failureCode,
    failure_message: null,
    created_at: "2026-08-16T10:00:00Z",
    completed_at: "2026-08-16T10:02:00Z",
  });

  const fake = (async (input: Request): Promise<Response> => {
    const url = new URL(input.url);
    const { pathname } = url;

    if (input.method === "POST" && pathname === "/v1/calls") {
      if (failWith) {
        return json(
          {
            error: {
              code: failWith.code,
              message: failWith.message ?? `Fake failure: ${failWith.code}`,
              details: {},
            },
          },
          failWith.status,
        );
      }

      lastIdempotencyKey = input.headers.get("Idempotency-Key");
      const body = (await input.json()) as Record<string, unknown>;
      createdCalls.push(body);

      const phone =
        (body.recipients as Array<{ phones?: string[] }> | undefined)?.[0]?.phones?.[0] ??
        (body.recipient as { phones?: string[] } | undefined)?.phones?.[0] ??
        // Fiction-reserved fallback. Even an unreachable placeholder stays in
        // the 555-01xx range, so no literal in this repo can be someone's line.
        "+14155550100";

      return json(buildCallTask("call_fake_1", String(body.task ?? ""), phone), 201);
    }

    const getCall = pathname.match(/^\/v1\/calls\/([^/]+)$/);
    if (input.method === "GET" && getCall) {
      return json(buildCallTask(getCall[1], "Fake task", "+14155550134"));
    }

    const listEvents = pathname.match(/^\/v1\/calls\/([^/]+)\/events$/);
    if (input.method === "GET" && listEvents) {
      return json({ object: "list", data: [], next_cursor: null });
    }

    return json(
      { error: { code: "not_found", message: `No fake route for ${pathname}`, details: {} } },
      404,
    );
  }) as FakeCalleFetch;

  fake.lastIdempotencyKey = () => lastIdempotencyKey;
  fake.createdCalls = () => createdCalls;

  return fake;
}
