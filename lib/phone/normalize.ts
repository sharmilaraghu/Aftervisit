/**
 * Phone numbers are refused, never guessed.
 *
 * A follow-up call goes to a patient. Fabricating a country code to make a
 * number "work" means dialling a stranger, so this returns a typed rejection
 * and the UI keeps the patient visible with the reason printed. An unreachable
 * patient is a visible problem; a silently corrected one is an invisible harm.
 */

import { parsePhoneNumberWithError } from "libphonenumber-js";

export type RejectionReason =
  | "empty"
  | "no_country_code"
  | "not_a_number"
  | "too_short"
  | "not_possible";

export type NormalizedPhone =
  | { ok: true; e164: string }
  | { ok: false; reason: RejectionReason; detail: string };

/** Human-readable text for a rejection, for printing next to the patient. */
export const REJECTION_TEXT: Record<RejectionReason, string> = {
  empty: "No number on file.",
  no_country_code:
    "No country code. Aftervisit will not guess one — a guessed code dials a stranger.",
  not_a_number: "Not a phone number.",
  too_short: "Too short to be a phone number.",
  not_possible: "Not a possible number in that country.",
};

export function normalizePhone(raw: string | null | undefined): NormalizedPhone {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty", detail: "" };

  // No default country is passed, deliberately. libphonenumber-js will happily
  // interpret a bare "9876543210" as whatever region you name, which is exactly
  // the guess this module exists to refuse.
  if (!trimmed.startsWith("+")) {
    return {
      ok: false,
      reason: "no_country_code",
      detail: trimmed,
    };
  }

  try {
    const parsed = parsePhoneNumberWithError(trimmed);
    if (!parsed.isPossible()) {
      return { ok: false, reason: "not_possible", detail: trimmed };
    }
    return { ok: true, e164: parsed.number };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason: RejectionReason =
      message === "TOO_SHORT" ? "too_short" : "not_a_number";
    return { ok: false, reason, detail: trimmed };
  }
}

/**
 * Mask for display. This console ends up in a recorded demo video, so a full
 * number on screen is a leak that cannot be taken back.
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  if (e164.length <= 5) return e164;
  return `${e164.slice(0, 3)}${"•".repeat(Math.max(0, e164.length - 5))}${e164.slice(-2)}`;
}

/**
 * The country CALL-E should route the call through.
 *
 * `region` is an input on the recipient — the SDK's own schema calls it the
 * "country or region code used for routing and compliance checks". Aftervisit
 * never sent one, so CALL-E had nothing to resolve a route from: three calls to
 * a `+91` mobile came back `region: null`, SIP 404, and zero seconds of call
 * duration. The number was correct and the account could reach it; the call
 * simply had nowhere to go.
 *
 * Derived from the number rather than asked for, because the number already
 * says it and a second field to keep in sync is a second field to get wrong.
 * Null when the country cannot be determined — CALL-E is then no worse off than
 * it was, and a guessed country is a guessed route.
 */
export function regionForPhone(e164: string): string | null {
  try {
    return parsePhoneNumberWithError(e164).country ?? null;
  } catch {
    return null;
  }
}
