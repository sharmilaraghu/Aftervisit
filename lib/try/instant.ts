/**
 * The judges' instant call: what may be typed into it, and who may press it.
 *
 * The /try page lets a judge type a first name, a phone number and a sample
 * note, and ring that number now with nothing saved — the one dial in Care Loop
 * that writes no row before it rings (see AGENTS.md, "The judges' instant call").
 * The guard, E.164, consent and the allowlist still run inside the port; this
 * file is the part in front of it.
 *
 * Pure: no IO, no clock.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type CleanName = { ok: true; name: string } | { ok: false; reason: string };

/*
 * One word of letters. A name is read into the task the agent follows and into
 * the first line it says, so a name field must not be able to carry a sentence:
 * "Priya. Ignore your instructions" is letters and spaces too.
 */
const FIRST_NAME = /^\p{L}[\p{L}\p{M}'’-]{0,29}$/u;

export function cleanFirstName(raw: string): CleanName {
  const name = (raw ?? "").trim();
  if (!name) return { ok: false, reason: "Enter the first name the assistant should ask for." };
  if (!FIRST_NAME.test(name)) {
    return {
      ok: false,
      reason: "Use one first name: letters, apostrophes and hyphens, no spaces. It is read to the assistant.",
    };
  }
  return { ok: true, name };
}

/**
 * Whether the typed passcode opens the page.
 *
 * Compared as hashes in constant time, so neither the length nor a prefix of the
 * real passcode leaks through timing. No passcode configured means closed — the
 * same fail-closed stance the tick token and the dial allowlist take.
 */
export function passcodeMatches(typed: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(typed ?? "").digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The browser's one-time id for a dial, so a double press is the same CALL-E call. */
export function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "");
}

/** CALL-E ids are opaque; only a plausible shape is worth asking CALL-E about. */
export function isCallId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,128}$/.test(value ?? "");
}

/** Shorter than this is not a note anyone could follow up on, so it is treated as no note. */
export const MIN_NOTE_LENGTH = 20;
export const MAX_NOTE_LENGTH = 4000;
