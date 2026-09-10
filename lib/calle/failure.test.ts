import { describe, expect, it } from "vitest";

import { failureReason, failureShort, networkRefused } from "@/lib/calle/failure";

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
