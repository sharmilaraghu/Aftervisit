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
  if (reading.valueBool !== null) return reading.valueBool ? "Y" : "N";
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
  if (reading.status === null) return `${day}: not scheduled`;
  if (reading.status === "missing") return `${day}: never answered`;
  if (reading.status === "unmappable") return `${day}: could not be mapped`;
  if (typeof reading.valueNumber === "number") return `${day}: ${reading.valueNumber} out of 10`;
  if (reading.valueBool !== null) return `${day}: ${reading.valueBool ? "yes" : "no"}`;
  if (reading.valueText) return `${day}: ${reading.valueText.replace(/_/g, " ")}`;
  return day;
}
