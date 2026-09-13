"use client";

/**
 * The small acts on a visit row: the patient didn't turn up, or did after all.
 *
 * Text buttons, not outlined ones. Printed at the same weight as "Write note"
 * they read as two equal choices, and the note is the row's work; a no-show is
 * the exception. No confirm step: marking one is undone from the same screen in
 * one click ("Arrived after all").
 */

import { useTransition } from "react";

import { markNoShowAction, reopenVisitAction } from "@/app/(console)/consult/actions";

function TextAction({
  label,
  pendingLabel,
  ariaLabel,
  act,
}: {
  label: string;
  pendingLabel: string;
  ariaLabel: string;
  act: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="visit-secondary visit-textbtn"
      disabled={pending}
      aria-label={ariaLabel}
      onClick={() => startTransition(act)}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function NoShowButton({ visitId, patientName }: { visitId: string; patientName: string }) {
  return (
    <TextAction
      label="Didn't turn up"
      pendingLabel="Marking…"
      ariaLabel={`${patientName} didn't turn up`}
      act={() => markNoShowAction(visitId)}
    />
  );
}

export function ArrivedButton({ visitId, patientName }: { visitId: string; patientName: string }) {
  return (
    <TextAction
      label="Arrived after all"
      pendingLabel="Moving…"
      ariaLabel={`${patientName} arrived after all — back onto the list`}
      act={() => reopenVisitAction(visitId)}
    />
  );
}
