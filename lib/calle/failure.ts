/**
 * What a failure code means, in words a clinician can act on.
 *
 * A real call came back `480` and the console said "No answer" — which reads as
 * *the patient chose not to pick up*, when what actually happened is that the
 * destination network refused the call before it rang. Those need opposite
 * responses: one is a patient who may be avoiding us, the other is a number
 * that cannot be dialled at all, and no amount of redialling fixes the second.
 *
 * Pure. No IO, no SDK import — the engine depends on this, and the engine has
 * no dependencies.
 *
 * These are SIP response codes as CALL-E passes them through, plus CALL-E's own
 * `no_answer`. It is a third-party vocabulary and an unpublished one: treat an
 * unrecognised code as unknown rather than guessing, which is why
 * `failureReason` returns null instead of inventing a sentence.
 */

/**
 * Codes where the call never reached a person, because the network ended it.
 *
 * Deliberately narrow. `487` and `no_answer` are *not* here: those are calls
 * that rang and nobody picked up, which is the signal this product exists to
 * catch and must never be explained away as a technical fault.
 */
export const NETWORK_REFUSED_CODES = ["404", "480", "486", "502", "503", "603"] as const;

const NETWORK_REFUSED: ReadonlySet<string> = new Set(NETWORK_REFUSED_CODES);

const REASON: Record<string, string> = {
  /* The number does not exist on that network. Redialling cannot help. */
  "404": "That number is not in service. Nothing will get through to it — check it against the patient's record.",
  /* The one seen in production. "Temporarily" is doing real work: it covers a
     handset that is off or out of coverage, and a carrier declining the call. */
  "480":
    "The network could not reach this number — the handset was off, out of coverage, or the carrier refused an automated call. It never rang.",
  "486": "The line was busy.",
  "487": "It rang and nobody picked up before the call timed out.",
  "502": "The carrier rejected the call before it rang.",
  "503": "The carrier was unable to route the call. This is a network fault, not the patient.",
  "603": "The call was declined — either by the person or by a screening service on the line.",
  no_answer: "It rang and nobody picked up.",
};

/** The sentence for a code, or null when we do not recognise it. */
export function failureReason(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON[code] ?? null;
}

/**
 * Whether the destination network ended this call before anyone could speak.
 *
 * The distinction the console turns on: a refused call is a fact about the
 * *number*, an unanswered one is a fact about the *patient*.
 */
export function networkRefused(code: string | null | undefined): boolean {
  return Boolean(code) && NETWORK_REFUSED.has(code as string);
}

/**
 * How to describe a code when there is no room for a sentence.
 *
 * Used beside an outcome badge, where the badge already says the call failed
 * and this says what the network did.
 */
export function failureShort(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "no_answer" || code === "487") return "rang, no answer";
  if (!REASON[code]) return null;
  return code === "404" ? "not in service" : networkRefused(code) ? "network refused" : null;
}
