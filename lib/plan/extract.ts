/**
 * Turn CALL-E's structured result into typed slots.
 *
 * A pure mapping layer, and deliberately **not a second model pass**. CALL-E
 * already did the listening; asking another model to interpret its answer would
 * add a second place where a guess could enter, and guesses are the thing this
 * product refuses to make.
 *
 * The load-bearing rule: **a null is not a missing value.** CALL-E returning
 * null for a key means it could not map what it heard — that is the
 * `unmappable` status, and it escalates. A key that never arrived is `missing`,
 * which also escalates but for a different reason a clinician should be able to
 * tell apart. Neither is ever silently filled in.
 *
 * Pure.
 */

import type { AnswerType, SlotStatus } from "@/lib/db/enums";
import type { StoredTurn } from "@/lib/db/schema";
import { UNKNOWN } from "@/lib/plan/result-schema";

export interface ExtractQuestion {
  questionId: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
  required: boolean;
}

export interface ExtractedValue {
  questionId: string;
  status: SlotStatus;
  valueBool: boolean | null;
  valueNumber: number | null;
  valueText: string | null;
  rawValue: unknown;
  utterance: string | null;
  utteranceOffsetSeconds: number | null;
}

export interface ExtractInput {
  /** CALL-E's `structuredResult`. Null when the call was never answered. */
  structuredResult: Record<string, unknown> | null;
  questions: ExtractQuestion[];
  transcript: StoredTurn[] | null;
}

/**
 * Find what the patient said closest to a question.
 *
 * The transcript is walked for the agent turn that asked, then the next patient
 * turn is taken as the answer. It is a heuristic and it is allowed to be: the
 * utterance is *evidence shown to a clinician*, never an input to a decision.
 * The rule engine reads typed values; this only decides which sentence to quote.
 */
function findUtterance(
  transcript: StoredTurn[] | null,
  questionId: string,
  prompt?: string,
): { text: string; offsetSeconds: number } | null {
  if (!transcript || transcript.length === 0) return null;

  const isPatient = (t: StoredTurn) =>
    !["agent", "assistant", "bot", "ai"].includes(t.speaker.toLowerCase());

  if (prompt) {
    const askedAt = transcript.findIndex(
      (t) => !isPatient(t) && t.text.includes(prompt.slice(0, 40)),
    );
    if (askedAt !== -1) {
      const reply = transcript.slice(askedAt + 1).find(isPatient);
      if (reply) return { text: reply.text, offsetSeconds: reply.offsetSeconds };
    }
  }

  // No prompt match: fall back to the longest thing the patient said, which is
  // the most informative line to put in front of a clinician.
  const patientTurns = transcript.filter(isPatient);
  if (patientTurns.length === 0) return null;
  const longest = patientTurns.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  return questionId ? { text: longest.text, offsetSeconds: longest.offsetSeconds } : null;
}

/**
 * Coerce one raw value against its declared type, or refuse to.
 *
 * Answers arrive as strings, because CALL-E's supported schema subset has no
 * nullable types — so every enum carries an explicit `unknown` instead. That is
 * the better shape anyway: "we could not map this" is a value the model had to
 * actively choose, rather than an absence we inferred from a null.
 *
 * A null still arrives when CALL-E could not produce a schema-valid result for
 * the whole call, and it still means unmappable.
 */
function coerce(
  raw: unknown,
  question: ExtractQuestion,
): Pick<ExtractedValue, "status" | "valueBool" | "valueNumber" | "valueText"> {
  const empty = { valueBool: null, valueNumber: null, valueText: null };

  // A whole-result null: CALL-E could not produce anything schema-valid.
  if (raw === null) return { status: "unmappable", ...empty };

  const text = typeof raw === "string" ? raw.trim() : "";
  // The explicit escape hatch. Never coerced into a value.
  if (text.toLowerCase() === UNKNOWN) return { status: "unmappable", ...empty };

  switch (question.answerType) {
    case "boolean": {
      // Booleans still map, in case a schema elsewhere declares one.
      if (typeof raw === "boolean") return { status: "answered", ...empty, valueBool: raw };
      if (text === "yes") return { status: "answered", ...empty, valueBool: true };
      if (text === "no") return { status: "answered", ...empty, valueBool: false };
      return { status: "unmappable", ...empty };
    }

    case "scale_0_10": {
      const n = typeof raw === "number" ? raw : Number(text);
      if (text === "" && typeof raw !== "number") return { status: "unmappable", ...empty };
      if (!Number.isInteger(n) || n < 0 || n > 10) return { status: "unmappable", ...empty };
      return { status: "answered", ...empty, valueNumber: n };
    }

    case "enum": {
      const allowed = question.enumValues ?? [];
      /*
       * Exact membership only. Never the nearest match — picking the closest
       * option because nothing fit is precisely the guess an unmappable status
       * exists to prevent.
       */
      if (!allowed.includes(text)) return { status: "unmappable", ...empty };
      return { status: "answered", ...empty, valueText: text };
    }

    case "text": {
      if (text === "") return { status: "unmappable", ...empty };
      return { status: "answered", ...empty, valueText: text };
    }
  }
}

export function extractSlots(input: ExtractInput): ExtractedValue[] {
  const result = input.structuredResult;

  return input.questions.map((question) => {
    const present = result !== null && Object.hasOwn(result, question.questionId);
    const raw = present ? result[question.questionId] : undefined;

    /*
     * A key that never arrived is `missing`, not `unmappable`. Both escalate,
     * but they are different facts: one is "they said something we could not
     * place", the other "this was never asked or never answered". A clinician
     * should be able to tell those apart.
     */
    const coerced = present
      ? coerce(raw, question)
      : { status: "missing" as SlotStatus, valueBool: null, valueNumber: null, valueText: null };

    const utterance = findUtterance(input.transcript, question.questionId);

    return {
      questionId: question.questionId,
      ...coerced,
      rawValue: present ? (raw as unknown) : null,
      utterance: utterance?.text ?? null,
      utteranceOffsetSeconds: utterance?.offsetSeconds ?? null,
    };
  });
}

/**
 * Did a human actually speak to us on this call?
 *
 * Deliberately broader than the `reached_patient` slot. That slot answers a
 * narrower question — *did the agent confirm it was speaking to the patient* —
 * and CALL-E returns `unknown` for it whenever identity was never explicitly
 * established, which happens on plenty of calls a person clearly answered.
 *
 * Conflating the two was a real bug: a call with thirty-nine transcript turns,
 * consent given and a full set of answers was folded to `no_answer`, which then
 * fed the retry ladder and the "never reached" state. Identity is one fact;
 * somebody picking up the phone is another.
 */
export function someoneSpoke(input: {
  slots: ExtractedValue[];
  transcript: StoredTurn[] | null;
}): boolean {
  const reached = input.slots.find((s) => s.questionId === "reached_patient");
  if (reached?.valueBool === true) return true;

  const consent = input.slots.find((s) => s.questionId === "consent_given");
  if (consent?.valueBool === true) return true;

  // Any question actually answered means a voice was on the line.
  if (input.slots.some((s) => s.status === "answered")) return true;

  const isAgent = (speaker: string) =>
    ["agent", "assistant", "bot", "ai"].includes(speaker.toLowerCase());
  return (input.transcript ?? []).some((t) => !isAgent(t.speaker) && t.text.trim() !== "");
}

/**
 * Fold a finished call into the one outcome the roster reads.
 *
 * Stored, because deriving it needs the slots, the transcript and the failure
 * code together, and the week band would otherwise re-compute it for every
 * patient on every page load.
 */
export function foldOutcome(input: {
  reached: boolean;
  failureCode: string | null;
  hasUrgentHit: boolean;
  hasAnyHit: boolean;
  anyUnmappable: boolean;
}): "answered" | "no_answer" | "flagged" | "unmappable" {
  if (!input.reached) return "no_answer";
  if (input.hasUrgentHit || input.hasAnyHit) return "flagged";
  if (input.anyUnmappable) return "unmappable";
  return "answered";
}
