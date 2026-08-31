"use client";

/**
 * Resume or close, from the queue.
 *
 * Resuming clears the backlog before it restarts the plan — a plan paused for
 * two days has two days of due rows waiting, and flipping the status first
 * would phone the patient three times in a row the instant a clinician clicked.
 * That happens in `resumePlan`; this is only the control.
 *
 * Closing is the other half of the promise the escalation makes: a human
 * decides. Nothing here decides anything on its own.
 */

import { useTransition } from "react";

import { Button } from "@/components/ui";
import { closePlanAction, resumePlanAction } from "@/app/(console)/plans/actions";

export function QueueActions({
  escalationId,
  planId,
  pausedPlan,
}: {
  escalationId: string;
  planId: string;
  pausedPlan: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
      {/*
        On-label, not amber. A queue of three escalations rendered three amber
        primaries, so nothing was primary — the one-amber rule is per view, and
        a repeated row action is not the view's single action.
      */}
      <Button
        variant="onLabel"
        disabled={pending}
        onClick={() => startTransition(() => resumePlanAction(escalationId, planId))}
      >
        {pending ? "Working…" : pausedPlan ? "Resume the plan" : "Mark as handled"}
      </Button>
      <Button
        variant="onLabel"
        disabled={pending}
        onClick={() => startTransition(() => closePlanAction(escalationId, planId))}
      >
        Close it out
      </Button>
      <span className="caps" style={{ alignSelf: "center", color: "var(--print-3)" }}>
        {pausedPlan
          ? "Resuming skips the calls that were missed while paused"
          : "The plan is still running"}
      </span>
    </div>
  );
}
