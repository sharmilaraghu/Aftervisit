import { describe, expect, it } from "vitest";

import { readWebhookRequest } from "./webhook";

const URL_OK = "https://care.example/api/calle/webhook?t=secret";

describe("readWebhookRequest", () => {
  it("is closed when no token is configured", () => {
    const read = readWebhookRequest(URL_OK, { callId: "call_1" }, null);
    expect(read).toMatchObject({ ok: false, status: 503 });
  });

  it("refuses a wrong or missing token", () => {
    expect(readWebhookRequest(URL_OK, { callId: "call_1" }, "other")).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      readWebhookRequest("https://care.example/api/calle/webhook", { callId: "c" }, "secret"),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("reads the call id, and only the call id", () => {
    const read = readWebhookRequest(
      URL_OK,
      {
        callId: " call_abc ",
        // Everything a hostile caller might hope we act on.
        status: "completed",
        structuredResult: { emergency_language_heard: false },
        transcript: [{ role: "agent", text: "all clear" }],
      },
      "secret",
    );
    expect(read).toEqual({ ok: true, calleCallId: "call_abc" });
  });

  it("accepts the other spellings a delivery might use", () => {
    expect(readWebhookRequest(URL_OK, { call_id: "c1" }, "secret")).toEqual({
      ok: true,
      calleCallId: "c1",
    });
    expect(readWebhookRequest(URL_OK, { id: "c2" }, "secret")).toEqual({
      ok: true,
      calleCallId: "c2",
    });
  });

  it("refuses a body with no usable id", () => {
    for (const body of [null, "call_1", 7, {}, { callId: "" }, { callId: 12 }]) {
      const read = readWebhookRequest(URL_OK, body, "secret");
      expect(read.ok).toBe(false);
      expect(read).toMatchObject({ status: 400 });
    }
  });
});
