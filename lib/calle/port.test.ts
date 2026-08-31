import { describe, it, expect, vi } from "vitest";
import { createCallePort } from "./port";
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
  ...overrides,
});

const port = (fetchImpl: ReturnType<typeof createFakeCalleFetch>, allowlist = [ARMED]) =>
  createCallePort({ apiKey: "test-key", allowlist, fetch: fetchImpl });

describe("createCallePort — the happy path", () => {
  it("dials and returns the call", async () => {
    const fake = createFakeCalleFetch();
    const outcome = await port(fake).dial(request());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.call.id).toBe("call_fake_1");
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

describe("createCallePort — the allowlist opt-out", () => {
  /*
   * The gate exists because there is no auth: with a login, "a clinician
   * approved this plan" would itself authorise the dial. Opening it is an
   * explicit act, never a default — an empty list still refuses everything, so
   * forgetting to configure the allowlist can only fail closed.
   */
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

  it("still refuses everything when the list is merely empty", async () => {
    const fetchSpy = vi.fn();
    const outcome = await createCallePort({
      apiKey: "test-key",
      allowlist: [],
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

  it("surfaces an unanswered call as a failed attempt with a failure code", async () => {
    // The retry ladder is driven by this, so it has to come through faithfully.
    const fake = createFakeCalleFetch({ outcome: "no_answer" });
    const call = await port(fake).fetchCall("call_abc");

    expect(call.status).toBe("failed");
    expect(call.recipients[0].attempts[0].failureCode).toBe("no_answer");
    expect(call.recipients[0].structuredResult).toBeNull();
  });

  it("returns the structured result on a completed call", async () => {
    const fake = createFakeCalleFetch({
      structuredResult: { reached_patient: "yes", adherence: "no" },
    });
    const call = await port(fake).fetchCall("call_abc");

    expect(call.recipients[0].structuredResult).toMatchObject({ adherence: "no" });
  });
});
