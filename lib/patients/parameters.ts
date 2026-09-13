/**
 * What a parameter did over the window, and whether it is worth a look.
 *
 * The product collects one typed answer per question per call. Over a seven-day
 * plan that is a matrix — parameters down, days across — and until now nothing
 * read it. The week band shows whether we *reached* the patient; this shows what
 * they *said*.
 *
 * **Pure.** No clock, no IO, no model.
 *
 * Every signal here is a description of the data, never a clinical judgement.
 * "Dizziness went 2 → 7" is arithmetic and a doctor can check it. "Dizziness is
 * worsening" would be a verdict, and this product does not make those — the same
 * line the rule engine holds.
 *
 * Signals do **not** escalate. They order the roster and draw the eye;
 * escalation stays with the pure rule engine, per call.
 */

import type { AnswerType, SlotStatus } from "@/lib/db/enums";

/** One answer, on one day. */
export interface ParameterReading {
  occurrence: number;
  status: SlotStatus | null;
  valueBool: boolean | null;
  valueNumber: number | null;
  valueText: string | null;
  utterance: string | null;
  callId: string | null;
  /** When that day's call was scheduled — so a change can be dated, not numbered. */
  date?: Date | null;
}

export interface ParameterRow {
  questionId: string;
  prompt: string;
  answerType: AnswerType;
  enumValues: string[] | null;
  readings: ParameterReading[];
  /** Values that escalate for this patient, taken from the plan's own rules. */
  escalatingValues: string[];
  escalatingBool: boolean | null;
  threshold: number | null;
}

export type SignalKind = "rising" | "flipped" | "gap";

export interface Signal {
  kind: SignalKind;
  questionId: string;
  /** A sentence a clinician can check against the row. Never an interpretation. */
  detail: string;
  /** Ordering only — which row to put first, not how serious anything is. */
  weight: number;
}

/** A rise of this much across the window is worth pointing at. */
const RISE = 3;

/**
 * A number that climbed.
 *
 * Compares the lowest reading to the most recent one rather than adjacent pairs,
 * so a 2 → 5 → 4 → 7 still reads as a rise. The detail names both ends so the
 * claim is checkable against the row beside it.
 */
function risingSignal(row: ParameterRow): Signal | null {
  if (row.answerType !== "scale_0_10") return null;

  const numbers = row.readings
    .filter((r) => r.status === "answered" && typeof r.valueNumber === "number")
    .map((r) => r.valueNumber as number);
  if (numbers.length < 2) return null;

  const latest = numbers[numbers.length - 1];
  const lowest = Math.min(...numbers);
  const climb = latest - lowest;
  if (climb < RISE) return null;

  return {
    kind: "rising",
    questionId: row.questionId,
    detail: `${lowest} → ${latest}`,
    weight: 100 + climb,
  };
}

/**
 * An answer that turned.
 *
 * "Escalating" is not guessed — it comes from the plan's own rules, which the
 * doctor set. A flip is only reported the first time it happens; a parameter
 * that has been "yes" all week is a state, not an event.
 */
function flippedSignal(row: ParameterRow): Signal | null {
  const answered = row.readings.filter((r) => r.status === "answered");
  if (answered.length < 2) return null;

  const escalating = (r: ParameterReading): boolean => {
    if (row.escalatingBool !== null && r.valueBool !== null) {
      return r.valueBool === row.escalatingBool;
    }
    if (row.escalatingValues.length && r.valueText) {
      return row.escalatingValues.includes(r.valueText);
    }
    return false;
  };

  for (let i = 1; i < answered.length; i++) {
    if (!escalating(answered[i - 1]) && escalating(answered[i])) {
      const value = answered[i].valueText ?? (answered[i].valueBool ? "yes" : "no");
      return {
        kind: "flipped",
        questionId: row.questionId,
        detail: `${value} from day ${answered[i].occurrence}`,
        weight: 90,
      };
    }
  }
  return null;
}

/**
 * A question that keeps not landing.
 *
 * Two or more unresolved answers in a row usually means the question is worded
 * badly, not that the patient is unwell — which is exactly why it belongs in
 * front of the doctor who wrote it.
 */
function gapSignal(row: ParameterRow): Signal | null {
  let run = 0;
  let longest = 0;
  for (const r of row.readings) {
    if (r.status === "unmappable" || r.status === "missing") {
      run += 1;
      longest = Math.max(longest, run);
    } else if (r.status === "answered") {
      run = 0;
    }
  }
  if (longest < 2) return null;

  return {
    kind: "gap",
    questionId: row.questionId,
    detail: `unclear ×${longest}`,
    weight: 50 + longest,
  };
}

/** Every signal on one parameter, strongest first. */
export function signalsFor(row: ParameterRow): Signal[] {
  return [risingSignal(row), flippedSignal(row), gapSignal(row)]
    .filter((s): s is Signal => s !== null)
    .sort((a, b) => b.weight - a.weight);
}

/** Every signal across a patient's parameters, strongest first. */
export function allSignals(rows: ParameterRow[]): Signal[] {
  return rows.flatMap(signalsFor).sort((a, b) => b.weight - a.weight);
}

/**
 * The one thing to show in a roster column.
 *
 * A single line, because the roster's job is to say which patient to open — not
 * to reproduce their chart in a table cell.
 */
export function worstSignal(rows: ParameterRow[]): Signal | null {
  return allSignals(rows)[0] ?? null;
}

/** An answer in words — "severe", "yes", "7 of 10" — never a code. */
export function answerWord(reading: ParameterReading): string | null {
  if (reading.status !== "answered") return null;
  if (typeof reading.valueNumber === "number") return `${reading.valueNumber} of 10`;
  if (reading.valueBool !== null) return reading.valueBool ? "yes" : "no";
  if (reading.valueText) return reading.valueText.replace(/_/g, " ");
  return null;
}

/** Whether the plan's own rules — never a guess — call this answer escalating. */
function escalatesByRule(row: ParameterRow, r: ParameterReading): boolean {
  if (r.status !== "answered") return false;
  if (row.escalatingBool !== null && r.valueBool !== null) return r.valueBool === row.escalatingBool;
  if (row.escalatingValues.length && r.valueText) return row.escalatingValues.includes(r.valueText);
  if (row.threshold !== null && typeof r.valueNumber === "number") return r.valueNumber >= row.threshold;
  return false;
}

/** A question whose answer moved, or landed on a value the plan escalates. */
export interface ChangeLine {
  questionId: string;
  prompt: string;
  /** The first answer, in words. Equal to `to` when it never moved but escalates. */
  from: string;
  to: string;
  /** The reading where the latest answer began — its date and the patient's words. */
  since: ParameterReading;
  escalating: boolean;
}

/** A question that said the same thing every time it was answered. */
export interface SteadyLine {
  questionId: string;
  prompt: string;
  answer: string;
  answered: number;
  asked: number;
}

/**
 * What changed across the calls, assembled from the answers — never generated.
 *
 * The replacement for the day-by-day grid. A doctor does not want a matrix of
 * every answer; they want what moved. Every line is arithmetic on the stored
 * answers and checkable against the call it links to: "none → severe on 9 Sep,
 * in the patient's words". Nothing here is a verdict.
 *
 * Needs two answered calls before anything can be said to have changed; with
 * one, both lists are empty and the assistant's summary stands alone.
 */
export function whatChanged(rows: ParameterRow[]): { changed: ChangeLine[]; steady: SteadyLine[] } {
  const changed: ChangeLine[] = [];
  const steady: SteadyLine[] = [];

  for (const row of rows) {
    const answered = row.readings.filter((r) => answerWord(r) !== null);
    if (answered.length < 2) continue;

    const words = answered.map((r) => answerWord(r) as string);
    const latest = words[words.length - 1];
    /* Where the latest answer began: walk back while it holds. */
    let start = answered.length - 1;
    while (start > 0 && words[start - 1] === latest) start -= 1;

    const moved = new Set(words).size > 1;
    const escalating = escalatesByRule(row, answered[answered.length - 1]);

    if (moved || escalating) {
      changed.push({
        questionId: row.questionId,
        prompt: row.prompt,
        from: words[0],
        to: latest,
        since: answered[start],
        escalating,
      });
    } else {
      steady.push({
        questionId: row.questionId,
        prompt: row.prompt,
        answer: latest,
        answered: answered.length,
        asked: row.readings.filter((r) => r.status !== null).length,
      });
    }
  }

  /* Escalating first, then the most recent change first. */
  changed.sort(
    (a, b) =>
      Number(b.escalating) - Number(a.escalating) || b.since.occurrence - a.since.occurrence,
  );
  return { changed, steady };
}

/** How a reading renders in a cell. Presentation only; no judgement. */
export type CellTone = "escalating" | "benign" | "unclear" | "none";

export function cellTone(row: ParameterRow, reading: ParameterReading): CellTone {
  if (reading.status === null) return "none";
  if (reading.status === "unmappable" || reading.status === "missing") return "unclear";

  if (row.escalatingBool !== null && reading.valueBool !== null) {
    return reading.valueBool === row.escalatingBool ? "escalating" : "benign";
  }
  if (row.escalatingValues.length && reading.valueText) {
    return row.escalatingValues.includes(reading.valueText) ? "escalating" : "benign";
  }
  if (row.threshold !== null && typeof reading.valueNumber === "number") {
    return reading.valueNumber >= row.threshold ? "escalating" : "benign";
  }
  /*
   * A severity scale reads as one without being declared. Only the universal
   * set carries escalating values, so a compiled "none / mild / moderate /
   * severe" question printed its worst answer — "severe", on the day a patient
   * could not keep water down — at the same weight as "none". This is a tone on
   * the patient's own words, not a verdict: the scale's top two answers are
   * marked, and declared values above still win.
   */
  if (reading.valueText && (row.enumValues ?? []).includes("severe")) {
    return reading.valueText === "moderate" || reading.valueText === "severe"
      ? "escalating"
      : "benign";
  }
  return "benign";
}

/**
 * What a cell shows: a digit, an initial, or a mark.
 *
 * An enum takes as many letters as it needs to be unambiguous *within its own
 * option list*. One letter is the right density for a grid, but `mild` and
 * `moderate` both start with M, and a severity column reading `M M M` where one
 * of them means moderate is worse than no grid at all. The full value is on the
 * cell's title and in its screen-reader text either way.
 */
export function cellLabel(row: ParameterRow, reading: ParameterReading): string {
  if (reading.status === null) return "";
  if (reading.status === "unmappable" || reading.status === "missing") return "?";
  if (typeof reading.valueNumber === "number") return String(reading.valueNumber);
  /* Spelled out. "N" meant "no" in a yes/no row and "none" in the severity row
     beneath it, so the key had to list one letter twice. */
  if (reading.valueBool !== null) return reading.valueBool ? "Yes" : "No";
  if (reading.valueText) return abbreviate(reading.valueText, row.enumValues ?? []);
  return "";
}

/** The shortest prefix of `value` that no sibling option shares. */
function abbreviate(value: string, options: string[]): string {
  const clean = (v: string) => v.replace(/_/g, " ").trim();
  const self = clean(value);
  const siblings = options.map(clean).filter((o) => o !== self);

  for (let n = 1; n <= self.length; n++) {
    const prefix = self.slice(0, n);
    if (!siblings.some((o) => o.slice(0, n).toLowerCase() === prefix.toLowerCase())) {
      return prefix.toUpperCase();
    }
  }
  return self.toUpperCase();
}

/** The full value, for a `title` and the row's `aria-label`. */
export function cellTitle(row: ParameterRow, reading: ParameterReading): string {
  const day = `Day ${reading.occurrence}`;
  /* Not "not scheduled": a day whose call the network refused was scheduled and
     attempted, and there is simply no reading from it. */
  if (reading.status === null) return `${day}: no reading`;
  if (reading.status === "missing") return `${day}: never answered`;
  if (reading.status === "unmappable") return `${day}: could not be mapped`;
  if (typeof reading.valueNumber === "number") return `${day}: ${reading.valueNumber} out of 10`;
  if (reading.valueBool !== null) return `${day}: ${reading.valueBool ? "yes" : "no"}`;
  if (reading.valueText) return `${day}: ${reading.valueText.replace(/_/g, " ")}`;
  return day;
}
