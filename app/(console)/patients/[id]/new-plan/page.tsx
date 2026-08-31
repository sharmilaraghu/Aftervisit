/**
 * Write a follow-up note for one patient.
 *
 * A reading column, because this is a page for writing prose rather than
 * filling in fields.
 */

import { notFound } from "next/navigation";

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
        maxWidth: 860,
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
          Follow up on {patient.name}.
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Write the note as you normally would. Care Loop compiles it into a plan
          you can read, edit and approve — and marks every field it filled in
          itself, so you can see what came from you and what did not.
        </p>
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
