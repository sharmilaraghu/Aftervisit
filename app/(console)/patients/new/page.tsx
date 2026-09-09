/**
 * Add a patient.
 *
 * A narrow reading column, not the roster's full width: this is one task with
 * three fields and a note, and a form stretched to 1240px is a form nobody can
 * scan.
 */

import { Button } from "@/components/ui";
import { PatientForm } from "@/components/PatientForm";
import { createPatientAction } from "@/app/(console)/patients/actions";
import { EMPTY_PATIENT_FORM } from "@/lib/patients/form";
import { hasProvider } from "@/lib/plan/provider";

export default function NewPatientPage() {
  return (
    <div
      style={{
        maxWidth: 816,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      {/*
        The heading and nothing else.

        It carried a line explaining that adding a patient does not dial them —
        true, and the wrong place for it. A doctor inside the console is not
        being sold the product, and a sentence at the top of a form is read
        before the question it answers has occurred to anyone. The same fact is
        stated once, beside the Save button, where the question is live.
      */}
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        {/* Every screen under the roster carries the same way out, in the same
            place. This one had none: the only exit was Cancel at the foot of a
            form, or the browser. */}
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Button variant="ghost" href="/patients">
            All patients
          </Button>
        </p>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: 0,
            color: "var(--bench-ink)",
          }}
        >
          Add a patient.
        </h1>
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
