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

  /*
   * Ghost, always. This sits on the graphite bench at the foot of the plan
   * page, and the `onLabel` variant it used for a live plan is dark ink meant
   * for white stock — so the control that stops a running follow-up rendered
   * all but invisible on exactly the plans where it matters.
   */
  if (!armed) {
    return (
      <Button variant="ghost" onClick={() => setArmed(true)}>
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
          color: "var(--bench-ink-2)",
          maxWidth: 460,
        }}
      >
        {draft
          ? "Nothing was dialled from this draft. The note stays on the record."
          : "No further calls will be placed. Everything already recorded is kept."}
      </span>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => startTransition(() => cancelPlanAction(planId, patientId))}
      >
        {pending ? "Discarding…" : draft ? "Yes, discard it" : "Yes, cancel it"}
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => setArmed(false)}
      >
        {draft ? "Keep it" : "Keep it running"}
      </Button>
    </span>
  );
}
