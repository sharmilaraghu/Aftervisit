/**
 * Add a patient.
 *
 * A narrow reading column, not the roster's full width: this is one task with
 * five fields, and a form stretched to 1240px is a form nobody can scan.
 */

import { PatientForm } from "@/components/PatientForm";
import { createPatientAction } from "@/app/(console)/patients/actions";
import { EMPTY_PATIENT_FORM } from "@/lib/patients/form";
import { hasProvider } from "@/lib/plan/provider";

export default function NewPatientPage() {
  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          Add a patient.
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Write the follow-up note here too and Care Loop will compile it into a
          plan for you to approve. Nothing is dialled by adding someone — a
          patient is only ever called once you have approved a plan.
        </p>
      </header>

      <PatientForm
        action={createPatientAction}
        initial={EMPTY_PATIENT_FORM}
        submitLabel="Save patient"
        cancelHref="/patients"
        withNote
        canCompile={hasProvider()}
      />
    </div>
  );
}
