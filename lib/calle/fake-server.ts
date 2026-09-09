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
  let created = 0;
  /* Per-instance, so two runs against the same database do not collide on
     `uniq_calle_call_id`. A counter alone restarts at 1 on the second run and
     every call it creates is refused as a duplicate. */
  const run = Math.random().toString(36).slice(2, 8);

  const reached = outcome === "completed";
  /*
   * A deliberately unhelpful vocabulary.
   *
   * This used to return the literal `"no_answer"`, and production code branched
   * its retry ladder on that exact string — so the suite proved the fake agreed
   * with the code and nothing else. The one real call came back `"603"`, a raw
   * SIP decline, and the ladder never fired. CALL-E publishes no enum for this
   * field and its docs say not to branch on it, so the fake now says so out
   * loud: anything reading these strings for a decision will be wrong.
   */
  const failureCode = outcome === "no_answer" ? "603" : outcome === "failed" ? "486" : null;
  const failureMessage =
    outcome === "no_answer"
      ? "calling task status=DECLINED (Hangup by: user)"
      : outcome === "failed"
        ? "calling task status=BUSY"
        : null;

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
        /*
         * The per-recipient result: who or what picked up.
         *
         * This is what `recipientResultSchema` produces, and it is the only
         * documented way to tell a person from an answerphone — CALL-E exposes
         * no built-in answered-by field.
         */
        structured_result: { answered_by: reached ? "human" : "unknown" },
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
            failure_message: failureMessage,
          },
        ],
      },
    ],
    /*
     * A call nobody answered still comes back with a result object.
     *
     * The real declined call returned every key `unknown` except
     * `requests_clinician`, which the agent honestly recorded as `no` — and
     * that single answered slot was enough to make a silent call read as
     * reached. The fake reproduces that shape so nothing can quietly go back to
     * assuming silence means a null result. `failed` still yields a true null,
     * which is the separate case of CALL-E producing no schema-valid result.
     */
    structured_result: reached
      ? structuredResult
      : outcome === "failed"
        ? null
        : {
            reached_patient: "unknown",
            consent_given: "unknown",
            requests_clinician: "no",
            emergency_language_heard: "unknown",
            call_recap: "unknown",
          },
    summary: reached ? "Fake call summary." : null,
    task_completed: reached,
    completion_confidence: reached ? confidence : null,
    evidence: reached ? ["The patient confirmed they are taking the medication."] : [],
    metadata: {},
    failure_code: failureCode,
    failure_message: failureMessage,
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

      /*
       * A distinct id per created call.
       *
       * It was a constant, which is fine for one call and wrong for a
       * scheduler: `uniq_calle_call_id` refuses the second row, so a tick
       * dialling three patients offline recorded one call and refused the rest
       * with an api_error nobody could act on.
       */
      created += 1;
      return json(
        buildCallTask(`call_fake_${run}_${created}`, String(body.task ?? ""), phone),
        201,
      );
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
