/**
 * Write a follow-up note for one patient.
 *
 * A reading column, because this is a page for writing prose rather than
 * filling in fields.
 */

import { notFound } from "next/navigation";

import { Button } from "@/components/ui";

import { NoteComposer } from "@/components/NoteComposer";
import { compileNoteAction } from "@/app/(console)/plans/actions";
import { getPatient } from "@/lib/db/patients";
import { EMPTY_COMPILE_FORM } from "@/lib/patients/plan-form";
import { hasProvider } from "@/lib/plan/provider";

export const dynamic = "force-dynamic";

export default async function NewPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient || patient.archivedAt) notFound();

  const action = compileNoteAction.bind(null, id);

  return (
    <div
      style={{
        maxWidth: 864,
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
          Follow up on {patient.name}.
        </h1>
        {/*
          No standing blurb here. It explained what the product does to someone
          already using it, which is an advert with the sound turned down — and
          the next screen demonstrates the same claim by marking the defaulted
          fields, where it is a fact rather than a promise.
        */}
      </header>

      <NoteComposer
        action={action}
        initial={EMPTY_COMPILE_FORM}
        cancelHref={`/patients/${id}`}
        canCompile={hasProvider()}
      />
    </div>
  );
}
