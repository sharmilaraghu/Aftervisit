/**
 * Patients — find anyone, and see where every patient stands.
 *
 * Today answers what needs doing now; this answers who exists. A patient with
 * an open escalation is a row like everyone else here.
 *
 * Every state is derived from `scheduled_calls` at read time — none of it is a
 * stored counter. A cached "on track" is wrong the moment a patient stops
 * answering, and that is the exact failure this page exists to make visible.
 */

import { Button } from "@/components/ui";
import { RosterTable } from "@/components/RosterTable";
import { getRoster } from "@/lib/db/queries";
import { HEALTH_ORDER } from "@/lib/patients/labels";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const rows = await getRoster();

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
              ? "Add a patient to write their consultation note and approve a follow-up plan."
              : waiting > 0
                ? `${waiting} need something from you. The rest are running.`
                : "Everyone is being followed up."}
          </p>
        </div>
        <span style={{ marginLeft: "auto" }}>
          {/* The page's one amber: the only thing you can start from here. */}
          <Button variant="primary" href="/plan/new">
            Add a patient
          </Button>
        </span>
      </header>

      {/* The table prints dark ink, so it needs the label stock under it. It
          used to get that from the group wrapper this page no longer has, and
          without it every patient name was near-invisible on the bench. */}
      {roster.length > 0 ? (
        <div className="sheet">
          <RosterTable rows={roster} />
        </div>
      ) : null}
    </div>
  );
}
