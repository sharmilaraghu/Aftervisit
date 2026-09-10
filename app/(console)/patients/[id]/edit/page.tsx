/**
 * Edit a patient.
 *
 * The same form as adding one, pre-filled. The action is bound to the id here
 * rather than carried in a hidden field, so the id is never part of the
 * rendered HTML for someone to change on the way back.
 */

import { notFound } from "next/navigation";

import { Button } from "@/components/ui";

import { PatientForm } from "@/components/PatientForm";
import { updatePatientAction } from "@/app/(console)/patients/actions";
import { getPatient } from "@/lib/db/patients";

export const dynamic = "force-dynamic";

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient || patient.archivedAt) notFound();

  const action = updatePatientAction.bind(null, id);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        {/* The same way out, in the same place, on every screen under a
            patient. This one only had Cancel at the foot of a form. */}
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Button variant="ghost" href={`/patients/${id}`}>
            Back to {patient.name}
          </Button>
        </p>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          Edit {patient.name}.
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Changing the number changes who gets dialled next.
        </p>
      </header>

      <PatientForm
        action={action}
        initial={{
          errors: {},
          values: {
            name: patient.name,
            age: String(patient.age),
            phone: patient.phoneE164,
            timezone: patient.timezone,
            language: patient.language,
            consent: patient.aiCallConsent,
            // Editing a patient never touches their plan, so the note and
            // schedule fields are absent from this form entirely.
            note: "",
            escalationNote: "",
            timeScale: "1",
            localTime: "",
            cadence: "",
            durationDays: "",
          },
        }}
        submitLabel="Save changes"
        cancelHref={`/patients/${id}`}
      />
    </div>
  );
}
