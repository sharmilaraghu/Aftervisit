/**
 * Refuse anything the note did not say.
 *
 * A deterministic gate, not a prompt instruction. "Only mention medications
 * present in the note" is advice a model can ignore silently; this is a check
 * that fails. The difference matters because the failure mode it prevents —
 * an agent naming a drug the doctor never prescribed — is one nobody would
 * notice until it had already been said down a phone line.
 *
 * It runs at compile time, against the note and the doctor's escalation
 * wording. It does not run again before dialling — that is the guard's job,
 * inside `dial()`. This comment used to claim a dial-time re-check that no
 * code performed; a safety claim a reader can check has to be true.
 *
 * Pure.
 */

export interface GroundingViolation {
  kind: "medication" | "red_flag_term";
  value: string;
  reason: string;
}

export interface GroundingResult {
  ok: boolean;
  violations: GroundingViolation[];
}

/**
 * Normalise for comparison: lowercase, and strip anything that is not a letter,
 * digit or space. "Metformin 500mg BD" and "metformin" then share a stem, while
 * punctuation and dose forms stop causing false refusals.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a term is present in the note.
 *
 * Word-boundary aware: "amlodipine" must not be found inside a longer unrelated
 * word, but a multi-word term matches as a phrase. A drug name written with its
 * dose in the note ("metformin 500mg") still grounds a plan that says
 * "metformin", because the stem is what is compared.
 */
export function mentionedIn(note: string, term: string): boolean {
  const haystack = ` ${normalize(note)} `;
  const needle = normalize(term);
  if (!needle) return false;
  return haystack.includes(` ${needle} `) || haystack.includes(` ${needle}`);
}

/**
 * The note's own words inside a quote that is not quite verbatim.
 *
 * A model asked to quote the note frames the words it quotes — "Watch for any
 * discharge from the wound" for a note reading "Watch for fever, any discharge
 * from the wound". The framing is the model's; the phrase inside it is the
 * doctor's. This returns the whole quote when the note contains it, otherwise
 * the longest run of the quote's words the note does contain — provided that
 * run is at least three words and most of the quote. Anything less is not
 * grounded, and returns null.
 *
 * Used for question anchors only. Schedule quotes stay exact: a partial match
 * there could turn "for a week" into a weekly cadence.
 */
export function groundedPhrase(note: string, quote: string): string | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (mentionedIn(note, quote)) return quote.trim();

  const floor = Math.max(3, Math.ceil(words.length * 0.6));
  for (let len = words.length - 1; len >= floor; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const run = words.slice(start, start + len);
      /* A run of filler ("any of the") is in every note; it anchors nothing. */
      if (!run.some((w) => !FILLER.has(w.toLowerCase().replace(/[^a-z]/g, "")))) continue;
      const phrase = run.join(" ");
      if (mentionedIn(note, phrase)) return phrase;
    }
  }
  return null;
}

const FILLER = new Set([
  "a", "an", "the", "of", "to", "and", "or", "for", "any", "in", "on", "at", "is",
  "are", "if", "it", "with", "from", "as", "by", "be", "that", "this", "she", "he",
  "they", "her", "his", "their", "whether", "ask", "watch", "check", "has", "have",
]);

export interface GroundingInput {
  noteBody: string;
  /** Medications the plan intends to name on the call. */
  medications: string[];
  /**
   * Red-flag terms the *compiler* added from the note. Terms from the condition
   * catalog are not grounded against the note — they are clinical defaults the
   * product ships, and requiring the doctor to restate them would delete the
   * safety net every time they wrote a short note.
   */
  compilerAddedTerms: string[];
}

export function assertGrounded(input: GroundingInput): GroundingResult {
  const violations: GroundingViolation[] = [];

  for (const medication of input.medications) {
    if (mentionedIn(input.noteBody, medication)) continue;
    violations.push({
      kind: "medication",
      value: medication,
      reason:
        `"${medication}" does not appear in the note. AfterVisit will not name a ` +
        "medication the doctor did not write down.",
    });
  }

  for (const term of input.compilerAddedTerms) {
    if (mentionedIn(input.noteBody, term)) continue;
    violations.push({
      kind: "red_flag_term",
      value: term,
      reason:
        `"${term}" was added as a red-flag term but does not appear in the note. ` +
        "A term the doctor did not write is not theirs to escalate on.",
    });
  }

  return { ok: violations.length === 0, violations };
}
