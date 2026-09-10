import { describe, expect, it } from "vitest";

import {
  failureReason,
  failureShort,
  isTransientRefusal,
  networkRefused,
} from "@/lib/calle/failure";

describe("failureReason", () => {
  /* The code that actually came back on a production call. */
  it("explains 480 as a call that never rang", () => {
    const reason = failureReason("480");
    expect(reason).toContain("never rang");
    expect(reason).toContain("carrier refused");
  });

  it("names an unrecognised code as unknown rather than guessing", () => {
    expect(failureReason("799")).toBeNull();
    expect(failureReason(null)).toBeNull();
    expect(failureReason(undefined)).toBeNull();
    expect(failureReason("")).toBeNull();
  });
});

describe("networkRefused", () => {
  /*
   * The distinction the whole change turns on. A refused call is a fact about
   * the number; an unanswered one is a fact about the patient, and it is the
   * signal this product exists to catch — so it must never be folded into a
   * technical fault.
   */
  it("is true only where the network ended the call", () => {
    expect(networkRefused("404")).toBe(true);
    expect(networkRefused("480")).toBe(true);
    expect(networkRefused("603")).toBe(true);
  });

  it("is false for a call that rang and nobody picked up", () => {
    expect(networkRefused("487")).toBe(false);
    expect(networkRefused("no_answer")).toBe(false);
  });

  it("is false for anything it does not recognise", () => {
    expect(networkRefused("799")).toBe(false);
    expect(networkRefused(null)).toBe(false);
  });
});

describe("failureShort", () => {
  it("fits beside a badge", () => {
    expect(failureShort("404")).toBe("not in service");
    expect(failureShort("480")).toBe("network refused");
    expect(failureShort("no_answer")).toBe("rang, no answer");
    expect(failureShort("487")).toBe("rang, no answer");
  });

  it("says nothing rather than something wrong", () => {
    expect(failureShort("799")).toBeNull();
    expect(failureShort(null)).toBeNull();
  });
});

describe("isTransientRefusal", () => {
  /*
   * A one-concurrency account refuses any overlapping dial, and CALL-E's own
   * message says to wait and retry. Treating that as terminal cost a patient a
   * whole day's call in production.
   */
  it("is true for an API error", () => {
    expect(isTransientRefusal("api_error")).toBe(true);
  });

  /* Each of these is a decision already taken. Retrying re-asks a question
     that has been answered no. */
  it("is false for every refusal that is a decision", () => {
    for (const reason of [
      "no_consent",
      "not_allowlisted",
      "guard_violation",
      "invalid_phone",
      "missing_api_key",
    ]) {
      expect(isTransientRefusal(reason)).toBe(false);
    }
  });
});
