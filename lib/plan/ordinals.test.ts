import { describe, expect, it } from "vitest";

import { nextOrdinal, stepTarget, type OrdinalRow } from "./ordinals";

/** Two locked openers, then three the doctor may reorder. */
const rows: OrdinalRow[] = [
  { id: "a", ordinal: 1, source: "locked" },
  { id: "b", ordinal: 2, source: "locked" },
  { id: "c", ordinal: 3, source: "note" },
  { id: "d", ordinal: 4, source: "note" },
  { id: "e", ordinal: 5, source: "clinician" },
];

describe("nextOrdinal", () => {
  it("lands strictly between the two neighbours", () => {
    const target = nextOrdinal(rows, "c");
    expect(target).toEqual({ ok: true, ordinal: 3.5 });
  });

  it("appends past the end when dropped after the last row", () => {
    const target = nextOrdinal(rows, "e");
    expect(target).toEqual({ ok: true, ordinal: 6 });
  });

  /*
   * The top of the *movable* band, not the top of the plan. A question above
   * `reached_patient` would have the agent asking about symptoms before it
   * established who was on the phone.
   */
  it("stops above the locked openers, never before them", () => {
    const target = nextOrdinal(rows, null);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.ordinal).toBeGreaterThan(2);
    expect(target.ordinal).toBeLessThan(3);
  });

  it("refuses an unknown id rather than guessing a position", () => {
    expect(nextOrdinal(rows, "nope")).toEqual({ ok: false, reason: "stale" });
  });

  /*
   * float64 gives ~50 subdivisions between adjacent integers, so this is not
   * reachable in practice — but it must be a refusal rather than a silent
   * collision with the row next door.
   */
  it("refuses when there is no room left to subdivide", () => {
    const tight: OrdinalRow[] = [
      { id: "a", ordinal: 1, source: "locked" },
      { id: "x", ordinal: 2, source: "note" },
      { id: "y", ordinal: 2 + 1e-9, source: "note" },
    ];
    expect(nextOrdinal(tight, "x")).toEqual({ ok: false, reason: "exhausted" });
  });

  /*
   * The regression this was written for. Locked questions sit at both ends of
   * a plan — the openers establish who is on the phone, and requests_clinician
   * and emergency_language close it. Taking the highest locked ordinal as the
   * floor picked a trailing one, produced a negative gap, and refused every
   * move to the top with "no room left".
   */
  it("moves to the top when locked questions also sit below the band", () => {
    const bookended: OrdinalRow[] = [
      { id: "open1", ordinal: 1, source: "locked" },
      { id: "open2", ordinal: 2, source: "locked" },
      { id: "c", ordinal: 3, source: "note" },
      { id: "d", ordinal: 4, source: "note" },
      { id: "close1", ordinal: 5, source: "locked" },
      { id: "close2", ordinal: 6, source: "locked" },
    ];
    const target = nextOrdinal(bookended, null);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.ordinal).toBeGreaterThan(2);
    expect(target.ordinal).toBeLessThan(3);
  });

  it("is unaffected by the order the rows arrive in", () => {
    const shuffled = [rows[4], rows[0], rows[3], rows[1], rows[2]];
    expect(nextOrdinal(shuffled, "c")).toEqual(nextOrdinal(rows, "c"));
  });
});

describe("stepTarget", () => {
  it("moving down places the question after its next neighbour", () => {
    expect(stepTarget(rows, "c", "down")).toEqual({ ok: true, afterId: "d" });
  });

  it("moving up from the second movable row goes to the top of the band", () => {
    expect(stepTarget(rows, "d", "up")).toEqual({ ok: true, afterId: null });
  });

  it("moving up jumps over exactly one neighbour", () => {
    expect(stepTarget(rows, "e", "up")).toEqual({ ok: true, afterId: "c" });
  });

  it("refuses at the edges instead of wrapping", () => {
    expect(stepTarget(rows, "c", "up")).toEqual({ ok: false, reason: "edge" });
    expect(stepTarget(rows, "e", "down")).toEqual({ ok: false, reason: "edge" });
  });

  it("ignores locked rows when counting positions", () => {
    // `c` is the first movable row even though two rows sit above it.
    expect(stepTarget(rows, "c", "up")).toEqual({ ok: false, reason: "edge" });
  });
});
