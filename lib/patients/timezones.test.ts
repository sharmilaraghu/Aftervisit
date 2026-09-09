import { describe, expect, it } from "vitest";

import { isValidTimezone, zoneForNumber } from "@/lib/patients/timezones";

/*
 * The subscriber digits are zeros because no country allocates a number that
 * begins with one. `zoneForNumber` matches on the dial code alone, so zeros
 * exercise it exactly as well as plausible digits would — and a plausible
 * number in a committed file belongs to somebody. The two exceptions are ranges
 * their regulators reserve for fiction: Ofcom's 07700 900xxx and US 555-01xx.
 */

describe("zoneForNumber", () => {
  /*
   * The bug this exists for: the form shipped `Europe/London` pre-selected, so
   * a +91 patient could be enrolled into London without anyone choosing. That
   * is not cosmetic — it is every call landing at the wrong hour for the life
   * of the plan.
   */
  it("reads the country from the number", () => {
    expect(zoneForNumber("+910000000000")).toBe("Asia/Kolkata");
    expect(zoneForNumber("+447700900123")).toBe("Europe/London");
    expect(zoneForNumber("+610000000000")).toBe("Australia/Sydney");
  });

  it("prefers the longer dial code, so +353 is not read as +3", () => {
    expect(zoneForNumber("+3530000000000")).toBe("Europe/Dublin");
  });

  /* A country spanning several zones gets nothing rather than a coin-flip. */
  it("refuses to guess where a country has more than one zone", () => {
    expect(zoneForNumber("+14155550100")).toBeNull();
  });

  it("refuses anything that is not in E.164 form", () => {
    expect(zoneForNumber("0000000000")).toBeNull();
    expect(zoneForNumber("")).toBeNull();
  });

  it("still validates a real zone", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});
