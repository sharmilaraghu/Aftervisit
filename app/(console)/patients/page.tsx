/**
 * Patients — the record and the front desk.
 *
 * Every patient, and the door to register a new one: registering is the first
 * step of the workflow, so it lives with the list it adds to rather than as a
 * section of its own. A patient with an open escalation is a row like everyone
 * else here.
 *
 * Every state is derived from `scheduled_calls` at read time — none of it is a
 * stored counter. A cached "on track" is wrong the moment a patient stops
 * answering, and that is the exact failure this page exists to make visible.
 */

import { Button, Panel } from "@/components/ui";
import { PatientsBrowser } from "@/components/PatientsBrowser";
import { getRoster } from "@/lib/db/queries";
import { HEALTH_ORDER } from "@/lib/patients/labels";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const rows = await getRoster();

  const roster = [...rows].sort(
    (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
  );

  /* The front desk's count, not the doctor's. This screen is the desk's, and
     "5 need something from you" told a receptionist about escalations only a
     doctor can act on. What the desk can see through is who is booked and still
     waiting to be seen. */
  const waitingForDoctor = roster.filter((p) => p.health === "needs_plan").length;

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
              ? "Register a patient and book their appointment. They go straight onto the doctor's Consultations list."
              : waitingForDoctor > 0
                ? `${waitingForDoctor} waiting to see the doctor.`
                : "Nobody is waiting to see the doctor."}
          </p>
        </div>
        <span style={{ marginLeft: "auto" }}>
          {/* The page's one amber: the only thing you can start from here. */}
          <Button variant="primary" href="/register">
            Register a patient
          </Button>
        </span>
      </header>

      {roster.length > 0 ? (
        <PatientsBrowser rows={roster} />
      ) : (
        <Panel title="The list is empty">
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}>
            Registering records who the patient is, whether they agreed to automated
            follow-up calls, and the day of their appointment. The visit then waits on
            Consultations until the doctor writes it up.
          </p>
        </Panel>
      )}
    </div>
  );
}
