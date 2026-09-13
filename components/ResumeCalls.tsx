"use client";

/**
 * Start a paused follow-up calling again.
 *
 * A plan can be paused by an escalation the doctor then handles elsewhere, or
 * by the desk's "Stop all calls". Either way the patient used to sit on
 * Follow-ups with no way to restart them from that page — the only resume
 * control was on the desk record — so a paused plan could stay silent while
 * looking merely quiet. Resuming skips the calls missed while it was paused
 * rather than dialling them all at once (`resumePlan`).
 */

import { useTransition } from "react";

import { Button } from "@/components/ui";
import { resumeStoppedPlanAction } from "@/app/(console)/patients/actions";

export function ResumeCalls({
  patientId,
  planId,
  patientName,
}: {
  patientId: string;
  planId: string;
  patientName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="onLabel"
      disabled={pending}
      ariaLabel={`Resume calls to ${patientName}`}
      onClick={() => startTransition(() => resumeStoppedPlanAction(patientId, planId))}
    >
      {pending ? "Resuming…" : "Resume calls"}
    </Button>
  );
}
