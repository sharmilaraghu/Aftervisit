"use client";

/**
 * The whole practice, in collapsible groups.
 *
 * A roster that renders every patient at once is a wall: the page opened with
 * two full escalation cards and a doctor had to scroll past them to reach
 * anyone else. Grouping by what the patient needs, and shutting the groups that
 * need nothing, turns the same data into an answer.
 *
 * Which groups start open is a clinical judgement, not a preference: anything
 * that needs a person is open, everything running is shut. Once you touch a
 * group your choice sticks for the session — the default is an opinion, not a
 * rule.
 *
 * Searching overrides both. A closed group hiding a match is the bug this kind
 * of interface always ships with, so a group with matches opens itself while a
 * query is live and returns to your setting when the box is cleared.
 *
 * **One table is the default now, not the groups.** The practice opens as a
 * single sortable sheet ordered most-urgent-first, which is the same clinical
 * priority the four bands encoded — just expressed as an order rather than as
 * four containers a doctor has to open. Every column then re-orders the whole
 * practice, and "who has been quiet longest?" has one answer instead of four.
 *
 * A sort applied inside four separate tables is four sorts, which is why the
 * two states are exclusive: grouping is a view you turn on, and turning it on
 * clears the sort. The way in and the way out sit in the same line, and the
 * third press on a header returns to the default order rather than to nothing.
 *
 * The state is local, like the search box, and deliberately not in the URL:
 * `ListFilter` documents the same decision. A clinician re-ordering a list is
 * not navigating, and every click should not be a history entry to back out of.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, TextInput } from "@/components/ui";
import {
  RosterTable,
  SORT_LABEL,
  SORT_WAY,
  sortRoster,
  type RosterSignals,
  type Sort,
  type SortKey,
} from "@/components/RosterTable";
import type { RosterRow } from "@/lib/db/queries";
import { HEALTH_LABEL } from "@/lib/patients/labels";
import type { PlanHealth } from "@/lib/db/enums";
import type { Tone } from "@/components/ui";

interface Group {
  key: string;
  title: string;
  blurb: string;
  tone: Tone;
  /** Shut by default when nothing in here is waiting on a person. */
  openByDefault: boolean;
  states: PlanHealth[];
}

const GROUPS: Group[] = [
  {
    key: "decide",
    title: "Waiting on your decision",
    blurb: "A rule stopped the plan, or there is no approved plan to run.",
    tone: "danger",
    openByDefault: true,
    states: ["escalated", "needs_plan", "awaiting_approval"],
  },
  {
    key: "quiet",
    title: "Not responding",
    blurb: "No rule fired — they have simply stopped answering.",
    tone: "danger",
    openByDefault: true,
    states: ["never_reached", "drifting"],
  },
  {
    key: "stopped",
    title: "Stopped, waiting to be resumed",
    blurb: "A clinician stopped these, or a rule paused them. Nothing is dialling.",
    tone: "amber",
    openByDefault: true,
    /*
     * Paused used to sit in "Running normally — nothing needed from you",
     * which is the opposite of what a paused plan means: nobody is being
     * called and only a person can change that.
     */
    states: ["paused"],
  },
  {
    key: "running",
    title: "Running normally",
    blurb: "Being followed up. Nothing needed from you.",
    tone: "clear",
    openByDefault: false,
    states: ["on_track"],
  },
  {
    key: "done",
    title: "Finished",
    blurb: "The follow-up window closed and the patient was reached.",
    tone: "plain",
    openByDefault: false,
    states: ["completed"],
  },
];

export function RosterGroups({
  rows,
  signals,
}: {
  rows: RosterRow[];
  signals: RosterSignals;
}) {
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  /*
   * The opening order. `state` ascending is `HEALTH_ORDER` — escalated first,
   * completed last — so the sheet a doctor lands on is already triaged, and the
   * badge column explains the order without a legend.
   */
  const [sort, setSort] = useState<Sort | null>({ key: "state", dir: "asc" });
  const [grouped, setGrouped] = useState(false);

  const needle = query.trim().toLowerCase();

  const matched = useMemo(() => {
    if (!needle) return rows;
    return rows.filter((p) =>
      `${p.name} ${p.reason} ${HEALTH_LABEL[p.health]}`.toLowerCase().includes(needle),
    );
  }, [rows, needle]);

  const buckets = GROUPS.map((g) => ({
    group: g,
    rows: matched.filter((p) => g.states.includes(p.health)),
  })).filter((b) => b.rows.length > 0);

  const flat = useMemo(
    () => (sort ? sortRoster(matched, sort) : matched),
    [matched, sort],
  );

  /*
   * Flattening and regrouping swap one table for four, so the header that was
   * just pressed is unmounted and the keyboard lands back on `document.body`:
   * a doctor sorting by keyboard had to tab in from the top of the page again
   * between every press. Focus follows the control instead. Layout effect, not
   * an effect, so it happens before the browser paints a lost focus ring.
   */
  const pressed = useRef<SortKey | null>(null);

  /* Ascending, then descending, then back to the triaged default. A third
     press never lands on "no order at all": an unordered roster is not a state
     anyone asked for. */
  const cycle = (key: SortKey) => {
    pressed.current = key;
    setSort((s) =>
      s?.key !== key
        ? { key, dir: "asc" }
        : s.dir === "asc"
          ? { key, dir: "desc" }
          : { key: "state", dir: "asc" },
    );
  };

  useLayoutEffect(() => {
    const key = pressed.current;
    if (key === null) return;
    pressed.current = null;
    document.querySelector<HTMLButtonElement>(`.sort-head[data-key="${key}"]`)?.focus();
  }, [sort]);

  const way = sort ? SORT_WAY[sort.key][sort.dir === "asc" ? 0 : 1] : null;

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
          margin: "0 0 calc(var(--cell) * 3)",
        }}
      >
        <TextInput
          type="search"
          aria-label="Find a patient"
          placeholder="Find a patient"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        {needle ? (
          <span role="status" className="caps" style={{ color: "var(--bench-ink-3)" }}>
            {matched.length} of {rows.length}
            {matched.length === 0 ? " — nothing matches" : ""}
          </span>
        ) : null}

        {/*
          Grouping is now a view you switch to, not the thing you land on.
          Turning it on clears the sort, because a sort inside four tables is
          four sorts and answers nobody's question.
        */}
        <span style={{ marginLeft: "auto" }}>
          <Button
            variant="ghost"
            aria-pressed={grouped}
            onClick={() => {
              setGrouped(!grouped);
              if (!grouped) setSort(null);
              else setSort({ key: "state", dir: "asc" });
            }}
          >
            {grouped ? "Show one table" : "Group by what they need"}
          </Button>
        </span>
      </div>

      {matched.length === 0 ? (
        <p style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          No patient matches &ldquo;{query}&rdquo;.
        </p>
      ) : null}

      {/*
        One region, kept in the DOM in both states so the change is spoken.
        Losing the four headings is a large change to a page a screen reader
        cannot see happen, and it needs saying in a full sentence.
      */}
      <p role="status" className="sr-only">
        {grouped || !sort
          ? "Grouped by what each patient needs."
          : /* With nothing to show, the search's own count is already saying so. */
            flat.length > 0
            ? `One table of ${flat.length} patients, sorted by ${SORT_LABEL[sort.key]}, ${way}.`
            : ""}
      </p>

      {/* A head and a count over an empty stretch of bench reads as a broken
          page rather than as a search that found nobody. */}
      {!grouped && sort && matched.length > 0 ? (
        <>
          {/* The same index tab the groups print, naming the order the sheet is
              actually in — a spreadsheet with no visible sort state is one you
              have to re-derive by reading it. */}
          {/* A real heading. The roster table sat under no h2 at all, so the
              page outline was one h1 and then a table — the only route in the
              console with nothing between them. */}
          <div className="roster-flat-head">
            <h2 className="caps" style={{ color: "var(--bench-ink)", margin: 0 }}>
              Sorted by {SORT_LABEL[sort.key]}
            </h2>
            <Badge tone="plain" quiet>
              {flat.length}
            </Badge>
            <span className="roster-group-blurb">{way}</span>
          </div>
          <div className="sheet">
            <RosterTable rows={flat} signals={signals} sort={sort} onSort={cycle} />
          </div>
        </>
      ) : null}

      {!grouped ? null : buckets.map(({ group, rows: groupRows }) => {
        /* A live query wins over both the default and your toggle: a shut group
           hiding a match is the failure this pattern always ships with. */
        const open = needle ? true : (toggled[group.key] ?? group.openByDefault);
        return (
          <details
            key={group.key}
            className="roster-group"
            open={open}
            /* Read synchronously. Inside the updater React runs later, the
               event is already pooled and `currentTarget` is null. */
            onToggle={(e) => {
              const isOpen = (e.currentTarget as HTMLDetailsElement).open;
              setToggled((t) => ({ ...t, [group.key]: isOpen }));
            }}
          >
            <summary>
              <span className="caps" style={{ color: "var(--bench-ink)" }}>
                {group.title}
              </span>
              <Badge tone={group.tone} quiet={group.tone !== "danger"}>
                {groupRows.length}
              </Badge>
              <span className="roster-group-blurb">{group.blurb}</span>
            </summary>
            <div className="sheet">
              <RosterTable
                rows={groupRows}
                signals={signals}
                sort={null}
                onSort={cycle}
              />
            </div>
          </details>
        );
      })}
    </>
  );
}
