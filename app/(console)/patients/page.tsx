/**
 * Patients — the whole practice, and the only place that holds all of it.
 *
 * This page and Overview are not two views of the same thing, and it took a
 * wrong turn to see why. It used to open with the same escalation cards that
 * Overview shows and that Escalations owns in full — three surfaces printing
 * one list. So the boundary is now drawn by the question each answers:
 *
 *   Overview     what is happening right now, in one screen
 *   Escalations  work through what a rule raised, with the evidence
 *   Patients     find anyone, and see where every patient stands
 *
 * Which is why nothing here is an escalation card. A patient with an open
 * escalation appears as a row like everyone else, and their badge is the link
 * to the queue. The groups are collapsible because a roster that renders every
 * patient at once is a wall rather than an answer.
 *
 * Every state is derived from `scheduled_calls` at read time — none of it is a
 * stored counter. A cached "on track" is wrong the moment a patient stops
 * answering, and that is the exact failure this page exists to make visible.
 */

import { Button } from "@/components/ui";
import { RosterGroups } from "@/components/RosterGroups";
import { getRoster } from "@/lib/db/queries";
import { getDashboardStats } from "@/lib/db/calls";
import { getRosterSignals } from "@/lib/db/parameters";
import { HEALTH_ORDER } from "@/lib/patients/labels";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const [rows, signals, stats] = await Promise.all([
    getRoster(),
    // One query for the whole roster, not one per patient.
    getRosterSignals(),
    getDashboardStats(),
  ]);
  const openEscalations = stats.openEscalations;

  const roster = [...rows].sort(
    (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
  );

  const waiting = roster.filter((p) =>
    ["escalated", "needs_plan", "awaiting_approval", "never_reached", "drifting"].includes(
      p.health,
    ),
  ).length;

  return (
    <div
      style={{
        /* DESIGN.md documents the container as 1240; the roster had drifted. */
        maxWidth: 1240,
        margin: "0 auto",
        padding: "calc(var(--cell) * 4) calc(var(--cell) * 4) calc(var(--cell) * 8)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 2)",
          marginBottom: "calc(var(--cell) * 3)",
        }}
      >
        <div>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: "0 0 calc(var(--cell) * 1)",
              color: "var(--bench-ink)",
            }}
          >
            {roster.length === 0
              ? "No patients yet."
              : `${roster.length} ${roster.length === 1 ? "patient" : "patients"}.`}
          </h1>
          <p style={{ margin: 0, color: "var(--bench-ink-2)" }}>
            {roster.length === 0
              ? "Add a patient and write the note from their consultation. You approve the plan it compiles, and the calls run from there."
              : waiting > 0
                ? `${waiting} need something from you. The rest are running.`
                : "Everyone is being followed up."}
          </p>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
          {/*
            The queue's door, now that it is not a nav tab. It appears only when
            there is something in it — a permanent link to an empty worklist is
            furniture, and the roster's own first band already says who needs a
            decision.
          */}
          {openEscalations > 0 ? (
            <Button variant="ghost" href="/escalations">
              Work the queue ({openEscalations})
            </Button>
          ) : null}
          {/* The page's one amber: the only thing you can start from here. */}
          <Button variant="primary" href="/patients/new">
            Add a patient
          </Button>
        </span>
      </header>

      {roster.length > 0 ? <RosterGroups rows={roster} signals={signals} /> : null}
    </div>
  );
}
