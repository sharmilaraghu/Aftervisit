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

export function CancelPlan({ planId, patientId }: { planId: string; patientId: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!armed) {
    return (
      <Button variant="onLabel" onClick={() => setArmed(true)}>
        Cancel this plan
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
      <span style={{ fontSize: 14, color: "var(--print-2)", maxWidth: 460 }}>
        No further calls will be placed. The calls already made, and anything
        they raised, stay in the record.
      </span>
      <Button
        variant="onLabel"
        disabled={pending}
        onClick={() => startTransition(() => cancelPlanAction(planId, patientId))}
      >
        {pending ? "Cancelling…" : "Yes, cancel it"}
      </Button>
      <Button variant="onLabel" disabled={pending} onClick={() => setArmed(false)}>
        Keep it running
      </Button>
    </span>
  );
}
