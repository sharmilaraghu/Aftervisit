import { describe, it, expect, vi } from "vitest";
import { callePortFromEnv, createCallePort } from "./port";
import { createFakeCalleFetch } from "./fake-server";

// US fiction-reserved. Nothing in this repo may carry a number that could be real.
const ARMED = "+14155550134";
const NOT_ARMED = "+14155550199";

const SAFE_TASK = [
  "You are an AI assistant calling on behalf of Bridgeview Family Practice.",
  "Say: I'm an AI assistant calling for Dr Rao's team.",
  "If anything sounds urgent, stop asking questions and end the call.",
  "Say: I can't give medical advice, but I'll pass anything on to your care team.",
  "If this is an emergency, tell them to hang up and call emergency services now.",
  "Say: Your care team will call you back about anything I can't answer.",
].join("\n");

const SCHEMA = { type: "object", properties: {} } as const;

const request = (overrides: Record<string, unknown> = {}) => ({
  task: SAFE_TASK,
  phone: ARMED,
  resultSchema: SCHEMA as unknown as Record<string, unknown>,
  idempotencyKey: "plan_1:o1:a1",
  consentGranted: true,
  ...overrides,
});

const port = (fetchImpl: ReturnType<typeof createFakeCalleFetch>, allowlist = [ARMED]) =>
  createCallePort({ apiKey: "test-key", allowlist, fetch: fetchImpl });

describe("createCallePort — the happy path", () => {
  it("dials and returns the call", async () => {
    const fake = createFakeCalleFetch();
    const outcome = await port(fake).dial(request());

    expect(outcome.ok).toBe(true);
    /* Shape, not the literal: the fake now issues a distinct id per created
       call so a scheduler dialling several can be run against a real database. */
    if (outcome.ok) expect(outcome.call.id).toMatch(/^call_fake_[a-z0-9]+_1$/);
  });

  /*
   * Three calls to a valid +91 mobile came back `region: null`, SIP 404 and
   * zero seconds of call duration. The number was right and the account could
   * reach it — the recipient carried no routing country, so the call had
   * nowhere to go. CALL-E's own schema calls `region` the code "used for
   * routing and compliance checks".
   */
  it("sends the routing region, derived from the number", async () => {
    const fake = createFakeCalleFetch();
    await port(fake).dial(request());

    const body = fake.createdCalls()[0] as {
      recipients?: { region?: string; phones?: string[] }[];
    };
    expect(body.recipients?.[0]?.region).toBe("US");
    expect(body.recipients?.[0]?.phones?.[0]).toBe(ARMED);
  });

  it("passes the idempotency key through as a header", async () => {
    const fake = createFakeCalleFetch();
    await port(fake).dial(request({ idempotencyKey: "plan_7:o3:a2" }));

    expect(fake.lastIdempotencyKey()).toBe("plan_7:o3:a2");
  });

  it("sends the task and the phone number CALL-E will actually use", async () => {
    const fake = createFakeCalleFetch();
    await port(fake).dial(request());

    const [body] = fake.createdCalls();
    expect(body.task).toBe(SAFE_TASK);
    expect((body.recipients as Array<{ phones: string[] }>)[0].phones).toEqual([ARMED]);
  });
});

describe("createCallePort — consent is what authorises a call", () => {
  /*
   * The clinical gate, and the one that replaced a mandatory allowlist. A
   * patient who never agreed must not be dialled from any machine, however
   * permissively that machine is configured.
   */
  it("refuses a patient who has not consented, even with the gate wide open", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [],
      allowlistOpen: true,
      fetch: fetchSpy as never,
    }).dial(request({ consentGranted: false }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toBe("no_consent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses without consent even when the number is on the allowlist", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy as never,
    }).dial(request({ consentGranted: false }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("no_consent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createCallePort — the deployment lock, closed by default", () => {
  /*
   * Consent authorises a call for a patient; this answers a different question
   * — may this *instance* reach the outside world at all — which needs a hard
   * "no" on a public URL with no login until an operator opens it.
   */
  it("refuses when built from an environment with a key but no allowlist", async () => {
    // The refusal comes before any request, so this cannot dial.
    const outcome = await callePortFromEnv({
      CALLE_API_KEY: "test-key",
    } as unknown as NodeJS.ProcessEnv).dial(request({ phone: NOT_ARMED }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("not_allowlisted");
  });

  it("dials any number when the gate is explicitly open", async () => {
    const fake = createFakeCalleFetch();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [],
      allowlistOpen: true,
      fetch: fake,
    }).dial(request({ phone: NOT_ARMED }));

    expect(outcome.ok).toBe(true);
  });

  it("refuses a number outside the list", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy as never,
    }).dial(request({ phone: NOT_ARMED }));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toBe("not_allowlisted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still enforces the guard and E.164 when the gate is open", async () => {
    const fetchSpy = vi.fn();
    const port = createCallePort({
      apiKey: "test-key",
      allowlist: [],
      allowlistOpen: true,
      fetch: fetchSpy as never,
    });

    const badPhone = await port.dial(request({ phone: "12345", allowlistOpen: undefined }));
    expect(badPhone.ok).toBe(false);
    if (!badPhone.ok) expect(badPhone.refusal).toBe("invalid_phone");

    const badTask = await port.dial(request({ task: "Say: don't worry, that's normal." }));
    expect(badTask.ok).toBe(false);
    if (!badTask.ok) expect(badTask.refusal).toBe("guard_violation");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createCallePort — refuses rather than dialling", () => {
  it("refuses a script that fails the guard, without calling the API", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy,
    }).dial(request({ task: `${SAFE_TASK}\nSay: don't worry, that's normal.` }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal).toBe("guard_violation");
      expect(outcome.findings?.length).toBeGreaterThan(0);
    }
    // The guard runs BEFORE any network call. This is the assertion that matters.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a script that is missing a required safety clause", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy,
    }).dial(request({ task: "Ask: how are you feeling today?" }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("guard_violation");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a number that is not E.164, without calling the API", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy,
    }).dial(request({ phone: "4155550134" }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("invalid_phone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a number that is not on the allowlist", async () => {
    // This is the gate that replaces the human pressing "call" per patient.
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy,
    }).dial(request({ phone: NOT_ARMED }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("not_allowlisted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dials nobody when the allowlist is empty", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [],
      fetch: fetchSpy,
    }).dial(request());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("not_allowlisted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an absent allowlist as empty rather than as permission", async () => {
    // A missing config must fail closed. This is the difference between a safe
    // default and an outage that dials strangers.
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({ apiKey: "test-key", fetch: fetchSpy }).dial(
      request(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("not_allowlisted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses when there is no API key", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "",
      allowlist: [ARMED],
      fetch: fetchSpy,
    }).dial(request());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("missing_api_key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns an API rejection into a refusal instead of throwing", async () => {
    // One bad row must not stop the scheduler working through the queue.
    const fake = createFakeCalleFetch({
      failWith: { status: 402, code: "insufficient_credits" },
    });
    const outcome = await port(fake).dial(request());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal).toBe("api_error");
  });
});

describe("createCallePort — reading a call back", () => {
  it("fetches a call by the id we persisted", async () => {
    const fake = createFakeCalleFetch();
    const call = await port(fake).fetchCall("call_abc");

    expect(call.id).toBe("call_abc");
  });

  /*
   * The code comes through, and nothing may depend on what it says.
   *
   * CALL-E publishes no enum for `failure_code`, and its docs say not to branch
   * retry, reporting or analytics on a particular string. The one real call
   * returned "603" while this codebase looked for "no_answer", and the retry
   * ladder silently never ran. So this asserts the field is carried faithfully
   * and is opaque — not that it holds any particular value.
   */
  it("carries the failure code through opaquely, without promising a vocabulary", async () => {
    const fake = createFakeCalleFetch({ outcome: "no_answer" });
    const call = await port(fake).fetchCall("call_abc");

    expect(call.status).toBe("failed");
    const code = call.recipients[0].attempts[0].failureCode;
    expect(code).toBeTruthy();
    expect(code).not.toBe("no_answer");
  });

  it("returns the structured result on a completed call", async () => {
    const fake = createFakeCalleFetch({
      structuredResult: { reached_patient: "yes", adherence: "no" },
    });
    const call = await port(fake).fetchCall("call_abc");

    expect(call.structuredResult).toMatchObject({ adherence: "no" });
  });

  /*
   * Two schemas, two results, deliberately not the same object. The task-level
   * one carries the answers; the per-recipient one carries who picked up, which
   * is the only documented way to tell a person from an answerphone.
   */
  it("returns who answered on the recipient, separately from the answers", async () => {
    const fake = createFakeCalleFetch({
      structuredResult: { reached_patient: "yes", adherence: "no" },
    });
    const call = await port(fake).fetchCall("call_abc");

    expect(call.recipients[0].structuredResult).toMatchObject({ answered_by: "human" });
  });
});
