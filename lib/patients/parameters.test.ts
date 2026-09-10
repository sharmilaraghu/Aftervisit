import { describe, expect, it } from "vitest";

import {
  allSignals,
  cellLabel,
  cellTone,
  cellTitle,
  signalsFor,
  worstSignal,
  type ParameterReading,
  type ParameterRow,
} from "@/lib/patients/parameters";

function reading(occurrence: number, over: Partial<ParameterReading> = {}): ParameterReading {
  return {
    occurrence,
    status: "answered",
    valueBool: null,
    valueNumber: null,
    valueText: null,
    utterance: null,
    callId: `sc_${occurrence}`,
    ...over,
  };
}

function scale(numbers: (number | null)[]): ParameterRow {
  return {
    questionId: "dizziness",
    prompt: "Rate any dizziness out of ten",
    answerType: "scale_0_10",
    enumValues: null,
    escalatingValues: [],
    escalatingBool: null,
    threshold: 7,
    readings: numbers.map((n, i) =>
      n === null
        ? reading(i + 1, { status: "unmappable" })
        : reading(i + 1, { valueNumber: n }),
    ),
  };
}

function bools(values: (boolean | null)[]): ParameterRow {
  return {
    questionId: "ankle_swelling",
    prompt: "Any ankle swelling?",
    answerType: "boolean",
    enumValues: null,
    escalatingValues: [],
    escalatingBool: true,
    threshold: null,
    readings: values.map((v, i) =>
      v === null ? reading(i + 1, { status: "missing" }) : reading(i + 1, { valueBool: v }),
    ),
  };
}

describe("rising", () => {
  it("reports a climb of three or more, naming both ends", () => {
    const [signal] = signalsFor(scale([2, 3, 5, 7]));
    expect(signal.kind).toBe("rising");
    expect(signal.detail).toBe("2 → 7");
  });

  /*
   * Lowest-to-latest, not adjacent pairs: a number that dips and recovers higher
   * has still climbed, and a doctor scanning the row would say so.
   */
  it("sees through a dip", () => {
    expect(signalsFor(scale([2, 5, 4, 7]))[0]?.detail).toBe("2 → 7");
  });

  it("stays quiet below the threshold, and on a fall", () => {
    expect(signalsFor(scale([2, 3, 4]))).toEqual([]);
    expect(signalsFor(scale([8, 5, 2]))).toEqual([]);
  });

  it("needs two readings", () => {
    expect(signalsFor(scale([9]))).toEqual([]);
  });

  it("ignores unresolved readings when measuring the climb", () => {
    const [signal] = signalsFor(scale([2, null, 7]));
    expect(signal.detail).toBe("2 → 7");
  });
});

describe("flipped", () => {
  it("reports the first time an answer turns, and says which day", () => {
    const [signal] = signalsFor(bools([false, false, true, true]));
    expect(signal.kind).toBe("flipped");
    expect(signal.detail).toBe("yes from day 3");
  });

  /*
   * A parameter that has been "yes" all week is a state, not an event. Reporting
   * it every day would bury the one that changed today.
   */
  it("stays quiet when it never turned", () => {
    expect(signalsFor(bools([true, true, true]))).toEqual([]);
    expect(signalsFor(bools([false, false, false]))).toEqual([]);
  });

  it("uses the plan's own escalating value, not a guess", () => {
    const benignWhenTrue: ParameterRow = { ...bools([false, true]), escalatingBool: false };
    // `true` is the benign value for this patient, so turning to it is not a flip.
    expect(signalsFor(benignWhenTrue)).toEqual([]);
  });

  it("works for choice answers too", () => {
    const row: ParameterRow = {
      questionId: "symptom_change",
      prompt: "Better, the same, or worse?",
      answerType: "enum",
      enumValues: ["better", "same", "worse"],
      escalatingValues: ["worse"],
      escalatingBool: null,
      threshold: null,
      readings: [
        reading(1, { valueText: "same" }),
        reading(2, { valueText: "same" }),
        reading(3, { valueText: "worse" }),
      ],
    };
    expect(signalsFor(row)[0].detail).toBe("worse from day 3");
  });
});

describe("gap", () => {
  it("reports two or more unresolved answers in a row", () => {
    const row = bools([true, null, null, true]);
    const gap = signalsFor(row).find((s) => s.kind === "gap");
    expect(gap?.detail).toBe("unclear ×2");
  });

  it("ignores a single unresolved answer", () => {
    const row = bools([true, null, true]);
    expect(signalsFor(row).some((s) => s.kind === "gap")).toBe(false);
  });

  it("does not count a run across an answered day", () => {
    const row = bools([null, true, null]);
    expect(signalsFor(row).some((s) => s.kind === "gap")).toBe(false);
  });
});

describe("ordering", () => {
  it("puts the strongest signal first across parameters", () => {
    const signals = allSignals([bools([false, false, true]), scale([1, 4, 9])]);
    expect(signals[0].kind).toBe("rising");
  });

  it("worstSignal is the one a roster column should show", () => {
    expect(worstSignal([bools([true, true]), scale([2, 8])])?.kind).toBe("rising");
  });

  it("returns null when nothing is off", () => {
    expect(worstSignal([bools([false, false]), scale([2, 2])])).toBeNull();
  });
});

describe("cells", () => {
  const row = scale([2, 8]);

  it("tones a reading against the plan's threshold", () => {
    expect(cellTone(row, row.readings[0])).toBe("benign");
    expect(cellTone(row, row.readings[1])).toBe("escalating");
  });

  it("marks an unresolved reading as unclear, never as absent", () => {
    expect(cellTone(row, reading(3, { status: "unmappable" }))).toBe("unclear");
    expect(cellLabel(row, reading(3, { status: "unmappable" }))).toBe("?");
  });

  it("shows a digit for a scale and an initial for a choice", () => {
    expect(cellLabel(row, row.readings[1])).toBe("8");
    expect(cellLabel(bools([true]), reading(1, { valueBool: true }))).toBe("Y");
  });

  /* Colour is never the only carrier: every cell says its value in words. */
  it("titles every cell with its full value", () => {
    expect(cellTitle(row, row.readings[1])).toBe("Day 2: 8 out of 10");
    expect(cellTitle(row, reading(4, { status: null }))).toBe("Day 4: no reading");
    expect(cellTitle(row, reading(5, { status: "missing" }))).toBe("Day 5: never answered");
  });
});

describe("purity", () => {
  it("does not mutate its input", () => {
    const row = scale([2, 5, 8]);
    const snapshot = structuredClone(row);
    signalsFor(row);
    allSignals([row]);
    expect(row).toEqual(snapshot);
  });

  it("is deterministic", () => {
    const row = scale([2, 5, 8]);
    expect(signalsFor(row)).toEqual(signalsFor(row));
  });
});

/*
 * Added when the grid was first put on screen: a severity column rendered
 * `mild` and `moderate` both as "M", so a doctor scanning a week could not tell
 * which one a cell meant.
 */
describe("cellLabel disambiguates within the option list", () => {
  const severity: ParameterRow = {
    questionId: "side_effects",
    prompt: "Any side effects?",
    answerType: "enum",
    enumValues: ["none", "mild", "moderate", "severe"],
    readings: [],
    escalatingValues: ["severe"],
    escalatingBool: null,
    threshold: null,
  };

  it("takes as many letters as it needs and no more", () => {
    expect(cellLabel(severity, reading(1, { valueText: "none" }))).toBe("N");
    expect(cellLabel(severity, reading(2, { valueText: "mild" }))).toBe("MI");
    expect(cellLabel(severity, reading(3, { valueText: "moderate" }))).toBe("MO");
    expect(cellLabel(severity, reading(4, { valueText: "severe" }))).toBe("S");
  });

  it("reads an underscored value as words", () => {
    const concern: ParameterRow = {
      ...severity,
      enumValues: ["not_concerned", "mildly", "very"],
    };
    expect(cellLabel(concern, reading(1, { valueText: "not_concerned" }))).toBe("N");
    expect(cellLabel(concern, reading(2, { valueText: "very" }))).toBe("V");
  });

  it("falls back to a plain initial when the row has no option list", () => {
    const free: ParameterRow = { ...severity, enumValues: null };
    expect(cellLabel(free, reading(1, { valueText: "better" }))).toBe("B");
  });
});
