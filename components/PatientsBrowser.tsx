"use client";

/**
 * The patient list with a search box and filters over it.
 *
 * Filtering is local: the roster is one practice's patients, already on the
 * page, and a round trip per keystroke would buy nothing. The filters are
 * grouped by what the doctor does next, not by the eight raw health states —
 * "needs you" is one question, however many ways a patient can come to it.
 */

import { useState } from "react";

import { Button, Segmented, TextInput } from "@/components/ui";
import { RosterTable } from "@/components/RosterTable";
import type { RosterRow } from "@/lib/db/queries";

type Filter = "all" | "needs" | "doctor" | "running" | "done";

/* The same split, and the same words, as the doctor's Follow-ups: someone who
   needs attention is not the same as someone waiting to be seen. */
const IN_FILTER: Record<Exclude<Filter, "all">, readonly RosterRow["health"][]> = {
  needs: ["escalated", "never_reached", "drifting"],
  doctor: ["needs_plan", "awaiting_approval"],
  running: ["on_track", "paused"],
  done: ["completed"],
};

export function PatientsBrowser({ rows }: { rows: RosterRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const count = (f: Filter) =>
    f === "all" ? rows.length : rows.filter((r) => IN_FILTER[f].includes(r.health)).length;

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || IN_FILTER[filter].includes(r.health)) &&
      (!q || r.name.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)),
  );

  return (
    /* One sheet: the controls belong to the list they filter, not to the bench. */
    <div className="sheet">
      <div className="patients-tools">
        <div className="patients-search">
          <label htmlFor="patient-search" className="sr-only">
            Search patients
          </label>
          <TextInput
            id="patient-search"
            type="search"
            placeholder="Search by name or reason"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="patients-filter">
          <span className="caps patients-filter-label" aria-hidden>
            Show
          </span>
          <Segmented
          label="Filter patients"
          on="label"
          current={filter}
          onSelect={(k) => setFilter(k as Filter)}
          options={[
            { key: "all", label: "All", count: count("all") },
            { key: "needs", label: "Needs attention", count: count("needs") },
            { key: "doctor", label: "Waiting on the doctor", count: count("doctor") },
            { key: "running", label: "Running", count: count("running") },
            { key: "done", label: "Finished", count: count("done") },
          ]}
          />
        </div>
      </div>

      {shown.length > 0 ? (
        <RosterTable rows={shown} />
      ) : (
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print)" }}>
            Nobody matches{q ? ` “${query.trim()}”` : ""} in this view.
          </p>
          <Button
            variant="onLabel"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Show everyone
          </Button>
        </div>
      )}
    </div>
  );
}
