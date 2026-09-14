/**
 * Fill in what the note did not say — in code, never by the model.
 *
 * This is the file that makes the "Defaulted" mark in the review UI worth
 * anything. Every defaultable field is nullable in the compiler's output schema,
 * and the model is told to return null rather than infer. So a value is either
 * something the doctor wrote, or something this function put there — and the
 * provenance map records which, derived from where the null was, never declared
 * by the model.
 *
 * Pure. Same draft in, same plan out.
 */

import type { Cadence, Provenance } from "@/lib/db/enums";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import { defaultRules, withLockedRules } from "@/lib/rules/catalog";
import { mentionedIn } from "@/lib/plan/grounding";
import type { TopicUnit } from "@/lib/plan/result-schema";

/** The compiler's raw output. Every defaultable field is nullable, on purpose. */
export interface CompiledDraft {
  reason: string | null;
  condition: string | null;
  durationDays: number | null;
  cadence: Cadence | null;
  localTime: string | null;
  /** One sentence: what the calls are for. Null when the note does not make it clear. */
  goal: string | null;
  redFlagTerms: string[] | null;
  medications: string[] | null;
  /**
   * The note's own words for each schedule field. A value arriving without
   * words the note really contains is not trusted as the note's — see
   * `applyDefaults`.
   */
  cadenceQuote?: string | null;
  durationQuote?: string | null;
  localTimeQuote?: string | null;
  /**
   * Days to wait before the first call — "check in after 3 days". Distinct from
   * `durationDays`: a delay with no stated length is one call on that day.
   */
  startAfterDays?: number | null;
  startAfterQuote?: string | null;
  /** What the note asks to be watched, with the note's words for each. */
  watchPoints?: WatchPoint[] | null;
}

export interface WatchPoint {
  text: string;
  quote: string;
  /** The measurement the note asks for, from a closed list. Absent for most topics. */
  unit?: TopicUnit | null;
}

/** The quoted words behind each schedule value the note supplied. */
export interface ScheduleQuotes {
  cadence?: string;
  durationDays?: string;
  startAfterDays?: string;
  localTime?: string;
  /** A frequency the note states that the scheduler cannot follow, e.g. "twice a day". */
  unsupportedCadence?: string;
}

/**
 * The goal code gives a follow-up when the note does not make one clear.
 *
 * Fixed text that passes guard phase 1, so the calling agent always has
 * something safe to set out to do.
 */
export const DEFAULT_GOAL = "Find out how the patient has been since their visit.";

export interface PlanDefaults {
  durationDays: number;
  cadence: Cadence;
  localTime: string;
  maxAttempts: number;
  retryDelayMinutes: number;
}

export const DEFAULTS: PlanDefaults = {
  durationDays: 7,
  cadence: "daily",
  localTime: "10:00",
  maxAttempts: 3,
  retryDelayMinutes: 120,
};

export interface ResolvedPlan {
  reason: string;
  condition: string | null;
  durationDays: number;
  /** Days to wait before the window opens. 0 is "from the next call time". */
  startAfterDays: number;
  cadence: Cadence;
  localTime: string;
  maxAttempts: number;
  retryDelayMinutes: number;
  /** What the calls set out to find out. The calling agent's goal. */
  goal: string;
  redFlagTerms: RedFlagTerm[];
  rules: PlanRule[];
  /** Field name → where its value came from. Derived here, never declared. */
  provenance: Record<string, Provenance>;
  /** The note's words behind every schedule field marked `note`. */
  scheduleQuotes: ScheduleQuotes;
  /** What the note asks to be watched, as the compiler read it. */
  watchPoints: WatchPoint[];
}

/** `HH:MM`, or null. A model that returns "5:30pm" has not returned a time. */
function validTime(value: string | null): string | null {
  if (!value) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function validDuration(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  // A follow-up window longer than a season is a data-entry error, not a plan.
  return value > 0 && value <= 90 ? value : null;
}

const CADENCES: Cadence[] = ["daily", "every_other_day", "weekly"];

/*
 * Does the quote actually say this value?
 *
 * Finding the quote in the note proves the words are the doctor's; it does not
 * prove the value came from them. A model quoting "for five days" and
 * returning thirty would otherwise be marked "From note". These are small,
 * deliberate readings of the words — not a parser — and anything they do not
 * recognise falls back to a default the doctor is asked to set.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  twenty: 20, thirty: 30,
};

/** Whether the quoted words say this many days. */
export function quoteSaysDays(days: number, quote: string): boolean {
  const q = quote.toLowerCase();
  const counts = [
    ...[...q.matchAll(/\d+/g)].map((m) => Number(m[0])),
    ...q.split(/[^a-z]+/).flatMap((w) => (w in NUMBER_WORDS ? [NUMBER_WORDS[w]] : [])),
  ];
  if (/\bfortnight\b/.test(q)) return days === 14;
  // "a week" is seven days; "two weeks" is fourteen.
  if (/\bweeks?\b/.test(q)) return days === (counts[0] ?? 1) * 7;
  return counts.includes(days);
}

/**
 * Whether the quoted words say to wait this many days before calling.
 *
 * "for 3 days" is a length, not a delay, and must never become one — so the
 * words have to say after, in, wait or from now as well as the number.
 */
export function quoteSaysDelay(days: number, quote: string): boolean {
  /*
   * The delay word has to govern the number, not merely share the quote with it:
   * a real note opened "Day 3 after laparoscopic cholecystectomy", which has
   * both "after" and a 3 and is a day since surgery, not a wait before calling.
   */
  const count = String.raw`(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|twenty|thirty)`;
  const span = String.raw`${count}\s+(?:more\s+)?(?:days?|weeks?)|a\s+fortnight`;
  const delay = new RegExp(
    String.raw`\b(?:after|in|wait(?:\s+for)?)\s+(?:${span})\b|\b(?:${span})\s+(?:from\s+now|later|time)\b`,
    "i",
  );
  const phrase = quote.match(delay)?.[0];
  return phrase !== undefined && quoteSaysDays(days, phrase);
}

function validDelay(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value > 0 && value <= 60 ? value : null;
}

const CADENCE_WORDS: Record<Cadence, RegExp> = {
  daily: /\b(daily|every ?day|each day|once a day|(every|each) (morning|evening|night))\b/i,
  every_other_day: /\b(every other day|alternate days?|every second day)\b/i,
  weekly: /\b(weekly|once a week|(every|each) week)\b/i,
};

/** Whether the quoted words say this frequency. "Twice a day" says none of them. */
export function quoteSaysCadence(cadence: Cadence, quote: string): boolean {
  return CADENCE_WORDS[cadence].test(quote);
}

/** Whether the quoted words name a time of day at all. */
export function quoteSaysTime(quote: string): boolean {
  return /\b(morning|afternoon|evening|night|midday|noon|lunch|breakfast|dinner|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i.test(
    quote,
  );
}

/**
 * Apply defaults and stamp provenance.
 *
 * `baseRules` and `baseRedFlags` come from the condition catalog, so a plan is
 * never left with only whatever the model happened to mention.
 */
export function applyDefaults(
  draft: CompiledDraft,
  options: {
    fallbackReason: string;
    baseRedFlags: string[];
    baseRules: PlanRule[];
    defaults?: Partial<PlanDefaults>;
    /**
     * The note the draft was compiled from. When given, a schedule value is
     * kept as the note's only if its quote is found in this text. Absent on
     * paths with no model answer to check (a refused compile).
     */
    noteText?: string;
  },
): ResolvedPlan {
  const d = { ...DEFAULTS, ...options.defaults };
  const provenance: Record<string, Provenance> = {};
  const scheduleQuotes: ScheduleQuotes = {};

  /*
   * A schedule value is the note's only if the model quoted the words it came
   * from and those words are really in the note. The model is told to leave a
   * silent schedule null; this is the check that does not depend on it having
   * listened. An unquoted or unfound value falls through to our default and is
   * marked as one — the doctor is asked to set it rather than told they wrote it.
   */
  const fromNote = <T>(
    value: T | null,
    quote: string | null | undefined,
    field: "cadence" | "durationDays" | "startAfterDays" | "localTime",
    /** Whether the words say this value — found in the note is not enough. */
    says: (value: T, words: string) => boolean,
  ): T | null => {
    if (value === null) return null;
    if (options.noteText === undefined) return value;
    const words = quote?.trim();
    if (!words || !mentionedIn(options.noteText, words) || !says(value, words)) return null;
    scheduleQuotes[field] = words;
    return value;
  };

  // The shape of every line below is the same: the note's value if there is
  // one, otherwise ours — and the mark follows the branch that was taken.
  const take = <T>(field: string, fromNote: T | null, fallback: T): T => {
    if (fromNote !== null && fromNote !== undefined) {
      provenance[field] = "note";
      return fromNote;
    }
    provenance[field] = "default";
    return fallback;
  };

  const statedCadence = draft.cadence && CADENCES.includes(draft.cadence) ? draft.cadence : null;
  const cadence = take<Cadence>(
    "cadence",
    fromNote(statedCadence, draft.cadenceQuote, "cadence", quoteSaysCadence),
    d.cadence,
  );
  /*
   * The same words cannot be both the length and the wait. When the model quotes
   * one phrase for both, it is a length misread as a delay too — and a wrong
   * delay moves every call past the days the doctor asked for, so it is the
   * delay that goes.
   */
  const delayWords = draft.startAfterQuote?.trim();
  const sameWords = Boolean(delayWords) && delayWords === draft.durationQuote?.trim();
  const startAfterDays = take(
    "startAfterDays",
    fromNote(
      sameWords ? null : validDelay(draft.startAfterDays),
      draft.startAfterQuote,
      "startAfterDays",
      quoteSaysDelay,
    ),
    0,
  );
  /*
   * "Check in after 3 days" is one call on day 3. A week of daily calls from
   * day 3 is not what that sentence asked for, so a delay the note gave with no
   * length of its own defaults to a single day — still marked a default.
   */
  const durationDays = take(
    "durationDays",
    fromNote(validDuration(draft.durationDays), draft.durationQuote, "durationDays", quoteSaysDays),
    provenance.startAfterDays === "note" ? 1 : d.durationDays,
  );
  const localTime = take(
    "localTime",
    fromNote(validTime(draft.localTime), draft.localTimeQuote, "localTime", (_time, words) =>
      quoteSaysTime(words),
    ),
    d.localTime,
  );

  /* The note states a frequency the scheduler cannot follow ("twice a day").
     It stays a default, but the words are kept so the review screen can say
     what the doctor asked for instead of silently printing "daily". */
  const cadenceWords = draft.cadenceQuote?.trim();
  if (
    options.noteText !== undefined &&
    statedCadence === null &&
    cadenceWords &&
    mentionedIn(options.noteText, cadenceWords)
  ) {
    scheduleQuotes.unsupportedCadence = cadenceWords;
  }
  const reason = take("reason", draft.reason?.trim() || null, options.fallbackReason);

  // Never offered to the model at all: a retry ladder is an operational
  // decision, not something a consultation note has an opinion about.
  provenance.maxAttempts = "default";
  provenance.retryDelayMinutes = "default";

  const noteTerms = (draft.redFlagTerms ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const baseSet = new Set(options.baseRedFlags.map((t) => t.toLowerCase()));
  const redFlagTerms: RedFlagTerm[] = [
    ...options.baseRedFlags.map((term) => ({ term, source: "default" as const })),
    // Compiler additions are marked, so the review UI can show them as
    // additions and let the clinician delete them.
    ...noteTerms
      .filter((t) => !baseSet.has(t))
      .map((term) => ({ term, source: "note" as const })),
  ];
  provenance.redFlagTerms = noteTerms.length > 0 ? "note" : "default";

  const goal = take("goal", draft.goal?.trim() || null, DEFAULT_GOAL);

  return {
    reason,
    condition: draft.condition,
    durationDays,
    startAfterDays,
    cadence,
    localTime,
    maxAttempts: d.maxAttempts,
    retryDelayMinutes: d.retryDelayMinutes,
    goal,
    redFlagTerms,
    // The locked three are re-asserted here, so no compile path can drop them.
    rules: withLockedRules([...defaultRules(), ...options.baseRules]),
    provenance,
    scheduleQuotes,
    watchPoints: draft.watchPoints ?? [],
  };
}

export type ScheduleField = "durationDays" | "localTime" | "cadence" | "maxAttempts";

/**
 * Which schedule fields a save on the review screen makes the clinician's.
 *
 * A changed value is theirs. An unchanged value keeps its mark — the note's
 * own words stay the note's, which is the bug this replaced: every save used
 * to stamp all five fields "You set this", including ones read out of the
 * note. The exception is a default: saving the form with a placeholder on it
 * is the doctor confirming that value, which is what "Not in note — set this"
 * asked them to do.
 */
export function fieldsToMarkAsClinician(
  before: Record<ScheduleField, string | number>,
  after: Record<ScheduleField, string | number>,
  provenance: Record<string, Provenance>,
): ScheduleField[] {
  return (Object.keys(after) as ScheduleField[]).filter(
    (field) => after[field] !== before[field] || provenance[field] === "default",
  );
}

/** Whether a field's value came from the doctor's note. Drives the review UI's marks. */
export function isDefaulted(
  provenance: Record<string, Provenance>,
  field: string,
): boolean {
  return provenance[field] === "default";
}
