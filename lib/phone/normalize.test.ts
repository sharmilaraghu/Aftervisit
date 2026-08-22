import { describe, it, expect } from "vitest";
import { normalizePhone, maskPhone } from "./normalize";

// Every number here is US fiction-reserved 555-01xx. India publishes no
// reserved range, so a plausible +91 number in a test file would probably be
// someone's real phone.
const FICTION = "+14155550134";

describe("normalizePhone — accepts only what it can be sure of", () => {
  it("accepts a well-formed E.164 number", () => {
    const result = normalizePhone(FICTION);
    expect(result).toEqual({ ok: true, e164: FICTION });
  });

  it("tolerates spaces and punctuation around a valid number", () => {
    const result = normalizePhone("  +1 (415) 555-0134  ");
    expect(result).toEqual({ ok: true, e164: FICTION });
  });

  it("refuses an empty value rather than returning a placeholder", () => {
    expect(normalizePhone("")).toMatchObject({ ok: false, reason: "empty" });
    expect(normalizePhone(null)).toMatchObject({ ok: false, reason: "empty" });
    expect(normalizePhone(undefined)).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("normalizePhone — never guesses a country", () => {
  it("refuses a bare national number instead of assuming a region", () => {
    const result = normalizePhone("4155550134");
    expect(result).toMatchObject({ ok: false, reason: "no_country_code" });
  });

  it("refuses a ten-digit number that would be valid in several countries", () => {
    // The whole point: this is a real number somewhere. Picking a country for it
    // means dialling a stranger.
    const result = normalizePhone("9876543210");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_country_code");
  });

  it("keeps the original text on a rejection so a human can see what was entered", () => {
    const result = normalizePhone("4155550134");
    if (result.ok) throw new Error("expected a rejection");
    expect(result.detail).toBe("4155550134");
  });

  it("refuses text that is not a number at all", () => {
    const result = normalizePhone("+call me at the clinic");
    expect(result.ok).toBe(false);
  });

  it("refuses an impossible number", () => {
    const result = normalizePhone("+1 1");
    expect(result.ok).toBe(false);
  });
});

describe("maskPhone — this UI ends up in a published video", () => {
  it("hides the middle digits", () => {
    const masked = maskPhone(FICTION);
    expect(masked).not.toContain("5550134");
    expect(masked.startsWith("+14")).toBe(true);
    expect(masked.endsWith("34")).toBe(true);
  });

  it("renders an em dash when there is no number", () => {
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("")).toBe("—");
  });
});
