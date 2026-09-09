/**
 * Where a question lands when a doctor moves it.
 *
 * Pure: no IO, no clock, no database. Everything it needs is the list it is
 * given, which is what makes the ordering rules testable without a plan.
 *
 * **Why fractions.** The obvious implementation of "move this question up" is
 * to swap two ordinals, or renumber the list. Both are multi-row writes, and
 * this codebase has no transactions — the Neon HTTP driver gives one implicit
 * transaction per statement. A half-applied renumber would leave the plan in an
 * order nobody chose, and `uniq_q_ordinal` makes the intermediate states of a
 * shuffle collide with each other besides. A permutation `UPDATE` does not
 * rescue it: Postgres checks a non-deferrable unique index per tuple, which is
 * why `set n = n + 1` classically fails.
 *
 * So a move never renumbers anything. It computes one new ordinal, strictly
 * between the two rows the question is being dropped between, and writes that
 * single row. Every intermediate state of the table is a valid total order,
 * because there is only ever one row in flight.
 */

/** The minimum gap worth subdividing. Below this, ask for a renumber instead. */
const MIN_GAP = 1e-6;

export interface OrdinalRow {
  /** The row id, not the question slug. */
  id: string;
  ordinal: number;
  /** `locked` rows open the call and never move. */
  source: string;
}

export type OrdinalTarget =
  | { ok: true; ordinal: number }
  | { ok: false; reason: "stale" | "exhausted" | "locked" };

/**
 * The ordinal a question should take to sit immediately after `afterId`.
 *
 * `afterId === null` means "to the top of the movable band" — not to the top of
 * the plan. The locked questions establish who is on the phone and whether they
 * agreed to talk, so nothing may be inserted above them.
 */
export function nextOrdinal(ordered: OrdinalRow[], afterId: string | null): OrdinalTarget {
  const rows = [...ordered].sort((a, b) => a.ordinal - b.ordinal);
  const movable = rows.filter((r) => r.source !== "locked");
  if (movable.length === 0) return { ok: false, reason: "stale" };

  if (afterId === null) {
    const first = movable[0];
    /*
     * The row immediately above the movable band, whatever its source — not the
     * highest locked ordinal. Locked questions sit at *both* ends: the openers
     * establish who is on the phone, and `requests_clinician` /
     * `emergency_language` close the call. Reducing over all of them picked a
     * trailing one and produced a negative gap, which read as "no room left"
     * on every move to the top.
     */
    const above = rows.filter((r) => r.ordinal < first.ordinal);
    const floor = above.length > 0 ? Math.max(...above.map((r) => r.ordinal)) : first.ordinal - 2;
    const gap = first.ordinal - floor;
    if (gap < MIN_GAP) return { ok: false, reason: "exhausted" };
    return { ok: true, ordinal: floor + gap / 2 };
  }

  const index = rows.findIndex((r) => r.id === afterId);
  if (index === -1) return { ok: false, reason: "stale" };

  const after = rows[index];
  if (after.source === "locked" && movable.some((m) => m.ordinal < after.ordinal)) {
    /* Dropping below a locked row is fine; dropping *between* locked rows is
       not, and only happens if the caller passed a stale list. */
    return { ok: false, reason: "locked" };
  }

  const before = rows[index + 1];
  if (!before) return { ok: true, ordinal: after.ordinal + 1 };

  const gap = before.ordinal - after.ordinal;
  if (gap < MIN_GAP) return { ok: false, reason: "exhausted" };
  return { ok: true, ordinal: after.ordinal + gap / 2 };
}

/**
 * The id a question should be placed after in order to move it one step.
 *
 * The UI thinks in "up" and "down"; the database thinks in "after this row".
 * Translating here keeps that vocabulary out of the SQL, and returns null when
 * the question is already at the end it is being moved toward.
 */
export function stepTarget(
  ordered: OrdinalRow[],
  questionId: string,
  direction: "up" | "down",
): { ok: true; afterId: string | null } | { ok: false; reason: "stale" | "edge" } {
  const movable = [...ordered]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((r) => r.source !== "locked");

  const index = movable.findIndex((r) => r.id === questionId);
  if (index === -1) return { ok: false, reason: "stale" };

  if (direction === "up") {
    if (index === 0) return { ok: false, reason: "edge" };
    /* Two steps back: the row before the one we are jumping over. */
    return { ok: true, afterId: index === 1 ? null : movable[index - 2].id };
  }

  if (index === movable.length - 1) return { ok: false, reason: "edge" };
  return { ok: true, afterId: movable[index + 1].id };
}
