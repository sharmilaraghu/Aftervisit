"use client";

/**
 * The roster, as a table. Presentational — it takes rows and renders them.
 *
 * Rendered once per group rather than once for the whole practice, so a doctor
 * scanning for risk never has to read a status column to find it: the heading
 * above the table already said which kind of patient is in it.
 *
 * The headers sort, and the ordering they produce is a *total* order — every
 * comparison that ties falls through to the name and then to the patient id.
 * A partial comparator would let React's re-render reshuffle equal rows under
 * a doctor's cursor, which is the way a sortable table quietly loses trust.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui";
import type { RosterRow } from "@/lib/db/queries";
import { HEALTH_LABEL, HEALTH_ORDER, HEALTH_TONE } from "@/lib/patients/labels";
import { maskPhone } from "@/lib/phone/normalize";

export type SortKey = "name" | "age" | "reason" | "state";

export interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

const CELL = "calc(var(--cell) * 1.5) calc(var(--cell) * 2)";

interface Column {
  label: string;
  className?: string;
  sort?: SortKey;
  /** What each direction does, in a doctor's words, for the header's label. */
  ways?: [asc: string, desc: string];
}

/*
 * The columns that drop on a phone are marked here and hidden in `globals.css`.
 */
const COLUMNS: Column[] = [
  { label: "Patient", sort: "name", ways: ["A to Z", "Z to A"] },
  {
    label: "Age",
    className: "col-age",
    sort: "age",
    ways: ["youngest first", "oldest first"],
  },
  {
    label: "Following up on",
    className: "col-reason",
    sort: "reason",
    ways: ["A to Z", "Z to A"],
  },
  /* No "Silent for" column: a silence is already a state — the State column
     says "Gone quiet" — and a second column of em-dashes said nothing about
     the eight patients who are not silent. */
  { label: "State", sort: "state", ways: ["most urgent first", "least urgent first"] },
];

/** The label a status line uses to name the active sort. */
export const SORT_LABEL: Record<SortKey, string> = Object.fromEntries(
  COLUMNS.filter((c) => c.sort).map((c) => [c.sort, c.label]),
) as Record<SortKey, string>;

export const SORT_WAY: Record<SortKey, [string, string]> = Object.fromEntries(
  COLUMNS.filter((c) => c.sort).map((c) => [c.sort, c.ways]),
) as Record<SortKey, [string, string]>;

const RANK: Record<SortKey, (a: RosterRow, b: RosterRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  age: (a, b) => a.age - b.age,
  reason: (a, b) => a.reason.localeCompare(b.reason),
  // Clinical order, never alphabetical: "escalated" must not land beside
  // "completed" because both start with the same letter.
  state: (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
};

/** The tiebreak, and the reason the order is stable across re-renders. */
const settle = (a: RosterRow, b: RosterRow) =>
  a.name.localeCompare(b.name) || a.patientId.localeCompare(b.patientId);

export function sortRoster(rows: RosterRow[], sort: Sort): RosterRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * RANK[sort.key](a, b) || settle(a, b));
}

export function RosterTable({ rows }: { rows: RosterRow[] }) {
  /*
   * Null until a header is clicked. The server hands these rows over already
   * ordered by severity, and that is the order a doctor wants first — sorting
   * is something they ask for, not something the table does to them on arrival.
   */
  const [sort, setSort] = useState<Sort | null>(null);
  const onSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const ordered = sort ? sortRoster(rows, sort) : rows;

  const scroller = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  /* The cue has to be true, or it is noise: at desktop width the table fits its
     sheet and there is nothing to the right to go and find. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Focusable so a keyboard alone can reach the columns that scrolled off. */}
      <div
        ref={scroller}
        className="scroller"
        tabIndex={0}
        role="group"
        aria-label="Patient roster"
      >
        <table
          className="roster-table"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
              {COLUMNS.map((c) => {
                const key = c.sort;
                const active = key !== undefined && key === sort?.key;
                return (
                  <th
                    key={c.label}
                    className={c.className ? `caps ${c.className}` : "caps"}
                    /* Only the column actually ordering the table is marked;
                       aria-sort on every header says nothing at all. */
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    style={{
                      textAlign: "left",
                      padding: CELL,
                      color: "var(--print-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {key && c.ways ? (
                      <button
                        type="button"
                        className="caps sort-head"
                        data-key={key}
                        data-dir={active ? sort.dir : undefined}
                        /*
                         * The name opens with the visible label, so a voice
                         * user can still say what they can read, and then
                         * states what this click will do rather than what the
                         * column is — the direction itself is already carried
                         * by aria-sort.
                         */
                        aria-label={`${c.label} — ${
                          active && sort.dir === "desc"
                            ? "stop sorting, back to groups"
                            : `sort ${active ? c.ways[1] : c.ways[0]}`
                        }`}
                        onClick={() => onSort(key)}
                      >
                        {c.label}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {/*
            The rows re-feed when the order changes.

            Sorting a table normally teleports every row, which on a clinical
            roster is the one moment a doctor most needs to see that the list
            moved — otherwise the same fourteen names in a different order reads
            as the same list. The `key` restarts the stagger on every sort, and
            `advance` floors at 0.3 opacity, so mid-animation the sheet is still
            legible and still photographs.
          */}
          <tbody
            className="feed-rows"
            data-fed="true"
            key={sort ? `${sort.key}:${sort.dir}` : "grouped"}
          >
            {ordered.map((p, i) => {
              return (
                <tr
                  key={p.patientId}
                  data-row-id={p.patientId}
                  style={
                    {
                      borderBottom: "1px solid var(--rule-2)",
                      /* The stagger caps so a 40-row practice does not spend
                         1.6s feeding; past 12 rows everything lands together. */
                      "--i": Math.min(i, 12),
                    } as React.CSSProperties
                  }
                >
                  <td style={{ padding: CELL }}>
                    {/* The thing you want is the patient, so the patient is what
                        you click — not a trailing "view" control. */}
                    <Link
                      href={`/patients/${p.patientId}`}
                      style={{
                        display: "block",
                        color: "var(--print)",
                        fontWeight: 700,
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                        textDecorationColor: "var(--rule)",
                      }}
                    >
                      {p.name}
                    </Link>
                    <span
                      className="mono"
                      /* One line: at 390px "54 ·" wrapped onto a line of its own. */
                      style={{ fontSize: 12, color: "var(--print-3)", whiteSpace: "nowrap" }}
                    >
                      {/* Age gets its own sortable column the moment there is
                          room for one; on a phone there is not, and this line
                          is where it goes on carrying it. */}
                      <span className="age-inline">{p.age} · </span>
                      {maskPhone(p.phoneE164)}
                    </span>                  </td>
                  <td className="col-age mono" style={{ padding: CELL, color: "var(--print-2)" }}>
                    {p.age}
                  </td>
                  <td
                    className="col-reason"
                    style={{ padding: CELL, color: "var(--print-2)", maxWidth: 280 }}
                  >
                    {p.reason}
                  </td>
                  <td style={{ padding: CELL }}>
                    {/*
                      The badge is the shortest route to the thing it describes: a
                      plan waiting on approval links to the plan, a patient with no
                      plan links to the consult list, an escalation to Today.
                    */}
                    <Link
                      href={
                        p.health === "needs_plan"
                          ? "/consult"
                          : p.health === "awaiting_approval" && p.planId
                            ? `/plans/${p.planId}`
                            : p.health === "escalated"
                              ? "/dashboard"
                              : `/patients/${p.patientId}`
                      }
                      /* The badge is the target, so the link has to be at least
                         the badge — an inline link 15px tall is a miss on a
                         phone even when the thing inside it looks tappable. */
                      style={{
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: "calc(var(--cell) * 4)",
                      }}
                    >
                      {/*
                        Amber states go quiet here. The page's one amber is "Add a
                        patient"; a column of filled amber badges would out-shout
                        it. Danger stays filled — red is supposed to interrupt.
                      */}
                      <Badge
                        tone={HEALTH_TONE[p.health]}
                        quiet={HEALTH_TONE[p.health] !== "danger"}
                        /* May wrap: a long state clipped the column at phone
                           width and brought the sideways scroll back. */
                        style={{ whiteSpace: "normal" }}
                      >
                        {HEALTH_LABEL[p.health]}
                      </Badge>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scrolls ? (
        <p className="scroll-note">Scroll the table sideways for the rest of each row.</p>
      ) : null}
    </>
  );
}
