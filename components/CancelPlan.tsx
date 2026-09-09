"use client";

/**
 * Cancel a plan.
 *
 * Arms before it acts, and says what actually happens — "cancel" is a word
 * people assume they understand, and here it stops future calls without
 * deleting the ones already made.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { cancelPlanAction } from "@/app/(console)/plans/actions";

export function CancelPlan({
  planId,
  patientId,
  /** A draft was never approved, so nothing has been dialled and the words change. */
  draft = false,
}: {
  planId: string;
  patientId: string;
  draft?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!armed) {
    return (
      <Button variant={draft ? "ghost" : "onLabel"} onClick={() => setArmed(true)}>
        {draft ? "Discard this draft" : "Cancel this plan"}
      </Button>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: "calc(var(--cell) * 1.5)",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 14,
          color: draft ? "var(--bench-ink-2)" : "var(--print-2)",
          maxWidth: 460,
        }}
      >
        {draft
          ? "Nothing was ever dialled from this draft, so nothing is lost. The note stays on the patient's record."
          : "No further calls will be placed. The calls already made, and anything they raised, stay in the record."}
      </span>
      <Button
        variant={draft ? "ghost" : "onLabel"}
        disabled={pending}
        onClick={() => startTransition(() => cancelPlanAction(planId, patientId))}
      >
        {pending ? "Discarding…" : draft ? "Yes, discard it" : "Yes, cancel it"}
      </Button>
      <Button
        variant={draft ? "ghost" : "onLabel"}
        disabled={pending}
        onClick={() => setArmed(false)}
      >
        {draft ? "Keep it" : "Keep it running"}
      </Button>
    </span>
  );
}
