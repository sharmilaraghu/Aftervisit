/**
 * Read a doctor's note into a follow-up: a goal, what to find out, and a schedule.
 *
 * The model's only job here is translation: turn free text into a fixed shape.
 * It does not write the questions — the calling agent asks in its own words,
 * under fixed safety instructions — so what it produces is *what the doctor
 * wants to know*, each item carrying the note's own words for it. Every
 * defaultable field is nullable, and the model is told to return null rather
 * than infer. What comes back is stored verbatim as `compileRaw`, then
 * `applyDefaults` fills the nulls and the checks below refuse anything the note
 * did not say.
 *
 * The order matters and is the whole safety argument:
 *
 *   model → nulls preserved → grounding → defaults in code → topic quotes → guard phase 1
 *
 * Nothing downstream trusts the model. Its output is evidence, not authority.
 */

import type { JsonObject } from "@call-e/calle";

import { complete, hasProvider, NoProviderError } from "@/lib/plan/provider";
import {
  applyDefaults,
  DEFAULT_GOAL,
  type CompiledDraft,
  type ResolvedPlan,
  type WatchPoint,
} from "@/lib/plan/defaults";
import { assertGrounded, groundedPhrase, type GroundingViolation } from "@/lib/plan/grounding";
import { isTopicUnit, MAX_TOPICS, TOPIC_UNITS } from "@/lib/plan/result-schema";
import { inspectFindOut } from "@/lib/script/guard";
import { redFlagsFor } from "@/data/red-flags";
import type { PlanRule } from "@/lib/rules/types";
import type { CompileProvider, VisitKind } from "@/lib/db/enums";

/**
 * The parser's output schema.
 *
 * Read the nulls. Every field a plan could default is `["x", "null"]`, and the
 * descriptions say when to use null. That nullability is what makes the "from
 * your note" mark trustworthy, because a value present here provably came from
 * the note — and code, not the model, decides what fills a gap.
 *
 * It is sent in strict mode, so it has to be the subset the API enforces:
 * every key listed in `required`, `additionalProperties: false` on every
 * object. `lib/plan/strict-schema.test.ts` holds it to that.
 */
export const COMPILE_SCHEMA = {
  type: "object",
  properties: {
    reason: {
      type: ["string", "null"],
      description:
        "A short phrase naming what is being followed up, e.g. 'New metformin · tolerance and adherence'. Null if the note does not make it clear.",
    },
    condition: {
      type: ["string", "null"],
      enum: [
        "new_metformin",
        "heart_failure",
        "statin_tolerance",
        "post_op_wound",
        "asthma",
        "post_discharge",
        "blood_pressure",
        "thyroid",
        null,
      ],
      description: "The condition being followed up. Null if none of them fit.",
    },
    goal: {
      type: ["string", "null"],
      description:
        "One plain sentence saying what these follow-up calls are for, starting 'Find out', e.g. 'Find out how the wound is healing and whether the pain is under control.' Never advice, never a diagnosis. Null if the note does not make it clear.",
    },
    durationDays: {
      type: ["integer", "null"],
      description:
        "How many days the doctor asked to follow up for, only when the note says it in words (quote them in durationQuote). Null if the note does not say. Never infer a typical length.",
    },
    durationQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give how long to follow up, copied verbatim, e.g. 'for five days'. Null when durationDays is null.",
    },
    cadence: {
      type: ["string", "null"],
      enum: ["daily", "every_other_day", "weekly", null],
      description:
        "How often to call, only when the note says it in words (quote them in cadenceQuote). If the note states a frequency that is not one of these, return null here and still quote the words.",
    },
    cadenceQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give how often to call, copied verbatim, e.g. 'every morning' or 'twice a day'. Null if the note says nothing about frequency.",
    },
    localTime: {
      type: ["string", "null"],
      description:
        "Time of day to call, as HH:MM in 24-hour form, only from the note's words (quote them in localTimeQuote). A stated part of the day may be written as its representative time: morning 09:00, midday 12:00, afternoon 14:00, evening 18:00, night 20:00. Null if the note gives no time.",
    },
    localTimeQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give the time of day, copied verbatim, e.g. 'evenings after work'. Null when localTime is null.",
    },
    startAfterDays: {
      type: ["integer", "null"],
      description:
        "How many days to wait before the first call, only when the note says it in words such as 'after 3 days' or 'recheck in a week' (quote them in startAfterQuote). Null if the note does not say. Never a length: 'for 3 days' is durationDays.",
    },
    startAfterQuote: {
      type: ["string", "null"],
      description:
        "The note's exact words that give the wait before the first call, copied verbatim, e.g. 'check in after 3 days'. Null when startAfterDays is null.",
    },
    medications: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "Medication names written in the note, exactly as written. Null or empty if none. Never add one that is not there.",
    },
    redFlagTerms: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "Words or phrases the note says to escalate on, in the doctor's own wording. Null if the note names none.",
    },
    watchPoints: {
      type: ["array", "null"],
      description:
        "What the doctor wants found out on these calls — at most 5, one per entry. Null if the note names nothing.",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The thing to find out, in a few plain words, e.g. 'whether the wound is discharging'. Never advice, never a diagnosis.",
          },
          quote: {
            type: "string",
            description: "The note's exact words it comes from, copied verbatim.",
          },
          unit: {
            type: ["string", "null"],
            enum: [...TOPIC_UNITS, null],
            description:
              "Only when the note asks for a single measurement: a temperature is celsius unless the note says fahrenheit, a pain score is score_0_10, pulse is bpm, weight is kg, blood sugar is mmol_L or mg_dL in the unit the note uses. Null otherwise, including blood pressure.",
          },
        },
        required: ["text", "quote", "unit"],
        additionalProperties: false,
      },
    },
  },
  /*
   * Every key, not none. Strict structured outputs require it, and it costs
   * nothing: each of these is nullable, so "required" means "answer, even if
   * the answer is null" — which is exactly the instruction in rule 1.
   */
  required: [
    "reason",
    "condition",
    "goal",
    "durationDays",
    "durationQuote",
    "cadence",
    "cadenceQuote",
    "localTime",
    "localTimeQuote",
    "startAfterDays",
    "startAfterQuote",
    "medications",
    "redFlagTerms",
    "watchPoints",
  ],
  additionalProperties: false,
} as const satisfies JsonObject;

const SYSTEM = `You read a doctor's free-text consultation note and set up the automated follow-up phone calls it asks for.

You are a translator, not a clinician. You do not decide anything about this patient's care, and you do not write the questions — the calling agent asks in its own words. Your job is to say what the doctor wants to find out, and on what schedule.

Rules you must follow exactly:

1. If the note does not state something, return null for it. Never infer, never fill in a typical value, never pick something sensible. A null is the correct and expected answer — the system fills gaps itself and marks them as defaults, and it can only do that honestly if you leave them empty.
   The schedule — how often, for how long, what time — comes only from words the note actually uses, and you must copy those exact words into cadenceQuote, durationQuote and localTimeQuote, exactly as they appear in the note and without adding words. A phrase like "each morning" gives both how often and what time: quote it for both. "Follow up for 3 days" gives durationDays 3. "Check in after 3 days" or "recheck in 3 days" gives startAfterDays 3 and leaves durationDays null — it is one call on that day unless the note also says for how long. Never choose a schedule because of the condition or because it is usual.
2. Never name a medication that is not written in the note.
3. Never invent a red-flag term. Only include wording the note actually uses.
4. goal is one plain sentence starting "Find out", saying what the calls are for. Never advice, reassurance, a diagnosis, or anything attributed to the doctor.
5. watchPoints are what the doctor wants found out — at most 5. List only what the note asks about, each with quote: the note's own words, copied exactly as they appear. Never add framing such as "watch for" or "ask whether" to a quote. An item without words from the note is thrown away. Do not add items because they seem clinically sensible, and do not pad the list. Give an item a unit only when the note asks for a number — a temperature, a pain score, a blood pressure — and never otherwise.
6. The note may be followed by a block headed WHAT TO ESCALATE ON. That is the doctor's own list of what they want to hear about. Take its wording for redFlagTerms exactly as they wrote it. Never generalise it into a broader category, and never add a condition they did not name.
7. The patient's age may be given. Use it only to phrase the goal plainly; never to decide what to find out.
8. The note may be followed by a block headed VISIT KIND. Use it only to choose the condition and to phrase the reason. It never adds something to find out, a medication, or a red-flag term the note does not contain.`;

/** Something the note asked about that will not be followed up, and why. */
export interface DroppedTopic {
  text: string;
  quote: string;
  why: "not_in_note" | "unrelated" | "guard" | "over_cap";
}

/** Words that say nothing about what a topic is, so they cannot tie it to a quote. */
const TOPIC_FILLER = new Set([
  "whether", "that", "with", "have", "been", "does", "this", "from", "they", "their",
  "about", "still", "since", "much", "many", "some", "there", "what", "your", "when",
]);

/** A topic's meaningful words, reduced to a five-letter stem so "taking" meets "take". */
function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !TOPIC_FILLER.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/** The longest topic the agent is handed. A topic is a few words, not a sentence. */
const MAX_TOPIC_LENGTH = 120;

export type CompileOutcome =
  | {
      ok: true;
      provider: CompileProvider;
      model: string;
      raw: unknown;
      plan: ResolvedPlan;
      /** Topics refused by the checks. Reported, never asked. */
      droppedTopics: DroppedTopic[];
    }
  | { ok: false; reason: "no_provider" | "model_error" | "not_grounded"; detail: string; violations?: GroundingViolation[] };

/** Parse the model's answer into a draft, tolerating missing keys but never inventing values. */
function toDraft(raw: unknown): CompiledDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  return {
    reason: str(r.reason),
    condition: str(r.condition),
    goal: str(r.goal),
    durationDays: typeof r.durationDays === "number" ? r.durationDays : null,
    cadence: str(r.cadence) as CompiledDraft["cadence"],
    localTime: str(r.localTime),
    durationQuote: str(r.durationQuote),
    cadenceQuote: str(r.cadenceQuote),
    localTimeQuote: str(r.localTimeQuote),
    startAfterDays: typeof r.startAfterDays === "number" ? r.startAfterDays : null,
    startAfterQuote: str(r.startAfterQuote),
    medications: arr(r.medications),
    redFlagTerms: arr(r.redFlagTerms),
    watchPoints: Array.isArray(r.watchPoints)
      ? (r.watchPoints as Record<string, unknown>[])
          .filter((w) => typeof w?.text === "string" && typeof w?.quote === "string")
          /* Only a unit from the closed list survives; anything else is no unit at all. */
          .map((w) => ({ text: String(w.text), quote: String(w.quote), unit: isTopicUnit(w.unit) ? w.unit : null }))
      : null,
  };
}

export interface CompileInput {
  noteBody: string;
  /**
   * The doctor's own list of what to escalate on, verbatim.
   *
   * Parsed into `redFlagTerms` in their wording, and kept whole on the note so
   * the triage model can be handed it later as the reference standard.
   */
  escalationNote?: string;
  /** Age only — never the name. A name buys nothing for parsing, so it is not sent. */
  patientAge?: number;
  /** Fallback `reason` when the note does not make one clear. */
  fallbackReason?: string;
  /**
   * What sort of visit the note came from. Rule 8 confines it to `condition`
   * and `reason`; grounding still refuses anything the note itself does not say.
   */
  visitKind?: VisitKind;
  baseRules?: PlanRule[];
  env?: NodeJS.ProcessEnv;
}

const VISIT_KIND_TEXT: Record<VisitKind, string> = {
  consultation: "consultation",
  post_op: "post-operative follow-up",
};

/**
 * What the model reads.
 *
 * The escalation block is labelled rather than concatenated silently, so rule 6
 * has something to point at and the doctor's wording stays attributable in the
 * raw request we persist.
 */
export function compilePrompt(input: CompileInput): string {
  const parts = [input.noteBody.trim()];
  if (input.patientAge !== undefined) parts.push(`PATIENT AGE\n\n${input.patientAge}`);
  const escalation = input.escalationNote?.trim();
  if (escalation) parts.push(`WHAT TO ESCALATE ON\n\n${escalation}`);
  if (input.visitKind) parts.push(`VISIT KIND\n\n${VISIT_KIND_TEXT[input.visitKind]}`);
  return parts.join("\n\n");
}

export async function compileNote(input: CompileInput): Promise<CompileOutcome> {
  const env = input.env ?? process.env;

  if (!hasProvider(env)) {
    return {
      ok: false,
      reason: "no_provider",
      detail: new NoProviderError().message,
    };
  }

  let result;
  try {
    result = await complete(
      { system: SYSTEM, user: compilePrompt(input), schema: COMPILE_SCHEMA, name: "follow_up_plan" },
      env,
    );
  } catch (error) {
    return {
      ok: false,
      reason: "model_error",
      detail:
        error instanceof Error
          ? `The note could not be read: ${error.message}`
          : "The note could not be read.",
    };
  }

  return processCompiledAnswer(result.raw, input, result.provider, result.model);
}

/**
 * Keep only the topics the note grounds and the guard passes, at most five.
 *
 * A topic is handed to the calling agent as vetted text — phase 2 masks it — so
 * this is the check that makes that safe: `inspectFindOut` on the words, and the
 * note's own words behind them. A partial quote is narrowed to the phrase the note
 * really contains, so "From your note" never prints words the doctor did not
 * write. Pure.
 */
export function screenTopics(
  topics: WatchPoint[],
  noteText: string,
): { kept: WatchPoint[]; dropped: DroppedTopic[] } {
  const kept: WatchPoint[] = [];
  const dropped: DroppedTopic[] = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    const text = topic.text.trim();
    const quote = topic.quote.trim();
    if (!text || seen.has(text.toLowerCase())) continue;

    const grounded = groundedPhrase(noteText, quote);
    if (!grounded) {
      dropped.push({ text, quote, why: "not_in_note" });
      continue;
    }
    /*
     * The quote proves the note says something; only the text reaches the agent.
     * A topic that shares no meaningful word with its own quote is not that
     * quote's topic, whatever the model paired it with.
     */
    const quoted = stems(grounded);
    if (quoted.size === 0 || ![...stems(text)].some((s) => quoted.has(s))) {
      dropped.push({ text, quote, why: "unrelated" });
      continue;
    }
    if (text.length > MAX_TOPIC_LENGTH || !inspectFindOut(text).ok) {
      dropped.push({ text, quote, why: "guard" });
      continue;
    }
    if (kept.length >= MAX_TOPICS) {
      dropped.push({ text, quote, why: "over_cap" });
      continue;
    }
    seen.add(text.toLowerCase());
    kept.push({ text, quote: grounded, unit: isTopicUnit(topic.unit) ? topic.unit : null });
  }
  return { kept, dropped };
}

/**
 * Everything after the model answers: coerce, ground, default, screen, guard.
 *
 * Pure, and separate from `compileNote` so the whole post-model pipeline can be
 * pinned by tests against a recorded answer without calling a model — see
 * `lib/plan/compile-fixtures.test.ts`. Same answer in, same outcome out.
 */
export function processCompiledAnswer(
  raw: unknown,
  input: CompileInput,
  provider: CompileProvider,
  model: string,
): CompileOutcome {
  const draft = toDraft(raw);

  /*
   * Grounding, before anything else is done with the draft. A term the doctor
   * wrote in the escalation box is grounded — it is their wording, and refusing
   * it would reject exactly the input we just asked for.
   */
  const noteText = `${input.noteBody}\n${input.escalationNote ?? ""}`;
  const grounding = assertGrounded({
    noteBody: noteText,
    medications: draft.medications ?? [],
    compilerAddedTerms: draft.redFlagTerms ?? [],
  });

  if (!grounding.ok) {
    return {
      ok: false,
      reason: "not_grounded",
      detail:
        "The note was read as referring to something it does not contain. " +
        "Aftervisit will not ground a call in text the doctor did not write.",
      violations: grounding.violations,
    };
  }

  /*
   * The goal goes to the calling agent as vetted text, so it passes the guard
   * here or is replaced by code's own. It must read as what to find out — a goal
   * that advises or reassures is not the doctor's goal; it is the model talking.
   */
  const goalText = draft.goal?.trim() ?? "";
  const goalOk = /^find out\b/i.test(goalText) && inspectFindOut(goalText).ok;
  const plan = applyDefaults(
    { ...draft, goal: goalOk ? draft.goal : null },
    {
      fallbackReason: input.fallbackReason ?? "Follow-up",
      baseRedFlags: redFlagsFor(draft.condition),
      baseRules: input.baseRules ?? [],
      noteText,
    },
  );

  const topics = screenTopics(plan.watchPoints, noteText);

  return {
    ok: true,
    provider,
    model,
    raw,
    plan: { ...plan, watchPoints: topics.kept },
    droppedTopics: topics.dropped,
  };
}

export { DEFAULT_GOAL };
