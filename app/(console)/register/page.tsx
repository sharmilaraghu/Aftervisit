/**
 * The front desk.
 *
 * A patient is registered before the doctor sees them, and the visit is booked
 * in the same step. `?patient=` brings a known patient back: the record is
 * pre-filled and updated in place, and a fresh visit is booked for them.
 * Nothing clinical is carried over — the last visit's note is about the last
 * problem.
 */

import { notFound } from "next/navigation";

import { PatientForm } from "@/components/PatientForm";
import { Breadcrumb } from "@/components/ui";
import { registerVisitAction } from "@/app/(console)/patients/actions";
import { getPatient } from "@/lib/db/patients";
import { EMPTY_PATIENT_FORM } from "@/lib/patients/form";
import { localDate } from "@/lib/time/clock";
import { PRACTICE_TIMEZONE } from "@/lib/patients/timezones";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const { patient: patientId } = await searchParams;
  const patient = patientId ? await getPatient(patientId) : null;
  if (patientId && (!patient || patient.archivedAt)) notFound();

  /* Today, on the practice's clock. A visit booked "today" from a server in
     another zone must not land on yesterday. */
  const defaultDate = localDate(new Date(), PRACTICE_TIMEZONE);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        {/* The same trail as every other page in the section. */}
        <Breadcrumb
          items={
            patient
              ? [
                  { label: "Patients", href: "/patients" },
                  { label: patient.name, href: `/patients/${patient.id}` },
                  { label: "New visit" },
                ]
              : [{ label: "Patients", href: "/patients" }, { label: "Register" }]
          }
        />
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          {patient ? `New visit for ${patient.name}.` : "Register a patient."}
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Book the appointment day. On that day the patient is on the doctor&rsquo;s
          Consultations list, where the follow-up note is written. Nothing is
          dialled until the doctor saves that note and starts the follow-up.
        </p>
      </header>

      <PatientForm
        action={registerVisitAction}
        patientId={patient?.id}
        visit={{ defaultDate }}
        initial={{
          errors: {},
          values: {
            ...EMPTY_PATIENT_FORM.values,
            name: patient?.name ?? "",
            age: patient ? String(patient.age) : "",
            phone: patient?.phoneE164 ?? "",
            timezone: patient?.timezone ?? "",
            language: patient?.language ?? "en-IN",
            consent: patient?.aiCallConsent ?? "unknown",
            visitDate: defaultDate,
          },
        }}
        submitLabel={patient ? "Book the visit" : "Register"}
        cancelHref={patient ? `/patients/${patient.id}` : "/patients"}
      />
    </div>
  );
}
