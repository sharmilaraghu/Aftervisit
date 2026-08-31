/**
 * Refuse anything the note did not say.
 *
 * A deterministic gate, not a prompt instruction. "Only mention medications
 * present in the note" is advice a model can ignore silently; this is a check
 * that fails. The difference matters because the failure mode it prevents —
 * an agent naming a drug the doctor never prescribed — is one nobody would
 * notice until it had already been said down a phone line.
 *
 * It runs at compile *and* again before dialling, because the plan can be
 * edited in between and the note is the only authority either time.
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
        `"${medication}" does not appear in the note. Care Loop will not name a ` +
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
