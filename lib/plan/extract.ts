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
import { UNIT_RANGE, UNKNOWN, type TopicSpec, type TopicUnit } from "@/lib/plan/result-schema";
import {
  OBSERVED_QUESTION_IDS,
  UNSPOKEN_RESULT_KEYS,
} from "@/lib/plan/universal-questions";

export interface ExtractQuestion {
  questionId: string;
  /**
   * The wording the agent was told to use, which is how its turn is found in
   * the transcript. Without it there is no way to tell which reply belongs to
   * which question, and no quote is shown.
   */
  prompt?: string;
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

function isPatient(turn: StoredTurn): boolean {
  return !["agent", "assistant", "bot", "ai"].includes(turn.speaker.toLowerCase());
}

/**
 * Where in the transcript the agent asked this question, or -1.
 *
 * A prefix match, because the agent is told to use this wording but is not
 * bound to it character for character.
 */
function askedAt(transcript: StoredTurn[], prompt: string): number {
  return transcript.findIndex((t) => !isPatient(t) && t.text.includes(prompt.slice(0, 40)));
}

/**
 * Find what the patient said in reply to one question.
 *
 * The transcript is walked for the agent turn that asked, then the next patient
 * turn is taken as the answer. It is a heuristic and it is allowed to be: the
 * utterance is *evidence shown to a clinician*, never an input to a decision.
 * The rule engine reads typed values; this only decides which sentence to quote.
 *
 * Null is the honest answer whenever that reply cannot be located — the question
 * was never asked, or the call ended before anyone answered it. There used to be
 * a fallback here that quoted "the longest thing the patient said" instead,
 * which meant every question on a call carried the same sentence: one real call
 * printed the same eleven words under all eight answers, including the two
 * nobody had answered. A quote under the wrong question is not weak evidence,
 * it is wrong evidence.
 */
function findUtterance(
  transcript: StoredTurn[] | null,
  prompt: string | undefined,
): { text: string; offsetSeconds: number } | null {
  if (!transcript || transcript.length === 0 || !prompt) return null;

  const at = askedAt(transcript, prompt);
  if (at === -1) return null;

  const reply = transcript.slice(at + 1).find(isPatient);
  return reply ? { text: reply.text, offsetSeconds: reply.offsetSeconds } : null;
}

/**
 * Ids the agent records without ever saying them out loud, so their absence
 * from the transcript proves nothing.
 */
const NEVER_SPOKEN = new Set<string>([...OBSERVED_QUESTION_IDS, ...UNSPOKEN_RESULT_KEYS]);

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

    /*
     * The transcript is the check on the extraction, not a second source of it.
     *
     * A real call came back with `consent_given: "yes"` for a question the agent
     * never asked — the patient had volunteered "Yes, we can discuss now" before
     * being asked, and it was read as the answer. The task text says in those
     * words: never record an answer to a question you did not actually ask. That
     * instruction is not enforceable at the far end, so it is enforced here.
     *
     * An answered slot whose question is nowhere in the transcript becomes
     * `unmappable`, which is the honest state and the one that routes to a
     * person. Only when there is a transcript to check against: a call nobody
     * answered has nothing to prove anything with, and questions the agent
     * records rather than asks are absent by design.
     */
    const unasked =
      coerced.status === "answered" &&
      Boolean(question.prompt) &&
      !NEVER_SPOKEN.has(question.questionId) &&
      input.transcript !== null &&
      input.transcript.length > 0 &&
      askedAt(input.transcript, question.prompt as string) === -1;

    const checked = unasked
      ? { status: "unmappable" as SlotStatus, valueBool: null, valueNumber: null, valueText: null }
      : coerced;

    const utterance = findUtterance(input.transcript, question.prompt);

    return {
      questionId: question.questionId,
      ...checked,
      rawValue: present ? (raw as unknown) : null,
      utterance: utterance?.text ?? null,
      utteranceOffsetSeconds: utterance?.offsetSeconds ?? null,
    };
  });
}

/**
 * Whether a human actually spoke to us on this call.
 *
 * Broader than the `reached_patient` slot — that asks whether the agent
 * confirmed *identity*, and a call can plainly be answered without it.
 * Conflating the two once folded a 39-turn conversation into `no_answer`.
 *
 * **It no longer accepts "some slot came back answered" as evidence**, and that
 * narrowing is the whole point. CALL-E returns a result object even for a call
 * nobody picked up, and a careful model fills the safety questions in
 * defensively: two real declined calls came back with an empty transcript and
 * `emergency_language_heard: "no"`, `requests_clinician: "no"` — honest answers,
 * and not a conversation. Each one made a silent call read as reached, which
 * suppressed the retry and fired `unmappable_response` on a call that never
 * happened.
 *
 * A negative answer to a question nobody was asked is an absence, not a voice.
 * What counts now is a positive identity or consent, or a patient turn with
 * words in it — and when none of those exist, treating the call as unreached is
 * also the safe direction: it schedules another attempt rather than silently
 * spending the patient's remaining ones.
 */
export function someoneSpoke(input: {
  slots: ExtractedValue[];
  transcript: StoredTurn[] | null;
}): boolean {
  const reached = input.slots.find((s) => s.questionId === "reached_patient");
  if (reached?.valueBool === true) return true;

  /*
   * A patient turn with words in it. This is the strong signal and the reason
   * the rule is broader than `reached_patient`: a call can plainly be answered
   * without the agent confirming identity, and conflating the two once folded
   * a 39-turn conversation into `no_answer`.
   */
  const isAgent = (speaker: string) =>
    ["agent", "assistant", "bot", "ai"].includes(speaker.toLowerCase());
  return (input.transcript ?? []).some((t) => !isAgent(t.speaker) && t.text.trim() !== "");
}

/** What the patient said about one of the note's topics. */
export interface Finding {
  topic: string;
  /** The number they gave, for a measured topic. Null when they gave none. */
  value: number | null;
  unit: TopicUnit | null;
  answer: string | null;
  patientWords: string | null;
  clarity: "clear" | "unclear" | "not_discussed" | null;
}

/**
 * Read the per-topic answers out of a call's structured result.
 *
 * Pure, and not a second model pass: CALL-E already filled `topic_1`…`topic_n`.
 * A topic whose object is missing or malformed comes back with nulls rather
 * than a guessed answer, and `unknown` is read as absent, never as an answer.
 */
export function extractFindings(
  structuredResult: Record<string, unknown> | null,
  topics: TopicSpec[],
): Finding[] {
  const text = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" || t.toLowerCase() === UNKNOWN ? null : t;
  };
  /*
   * Digits or nothing. "about thirty-eight", "high" or "38-39" are not a number
   * the doctor can compare day to day, so they stay in the patient's words and
   * the value stays null — never parsed into the nearest guess.
   */
  const number = (v: unknown): number | null => {
    const t = text(v);
    if (t === null || !/^-?\d+(?:\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  /*
   * A number is kept only from a clearly answered topic and only inside the
   * widest plausible range for its unit. "About 38, I think" written down as 38
   * is the agent's guess, and 101 as °C is a unit mix-up — neither is a reading.
   */
  const reading = (v: unknown, unit: TopicUnit, clarity: unknown): number | null => {
    if (clarity !== "clear") return null;
    const n = number(v);
    if (n === null) return null;
    const [low, high] = UNIT_RANGE[unit];
    return n >= low && n <= high ? n : null;
  };
  return topics.map((topic, i) => {
    const raw = structuredResult?.[`topic_${i + 1}`];
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const clarity = obj?.clarity;
    const unit = topic.unit ?? null;
    return {
      topic: topic.text,
      value: unit ? reading(obj?.value, unit, clarity) : null,
      unit,
      answer: text(obj?.answer),
      patientWords: text(obj?.patient_words),
      clarity:
        clarity === "clear" || clarity === "unclear" || clarity === "not_discussed" ? clarity : null,
    };
  });
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
  hasUrgentHit: boolean;
  hasAnyHit: boolean;
  anyUnmappable: boolean;
}): "answered" | "no_answer" | "flagged" | "unmappable" {
  if (!input.reached) return "no_answer";
  if (input.hasUrgentHit || input.hasAnyHit) return "flagged";
  if (input.anyUnmappable) return "unmappable";
  return "answered";
}
