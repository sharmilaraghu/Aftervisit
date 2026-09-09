"use client";

/**
 * The two ways a course of treatment ends.
 *
 * Until this existed, a follow-up could only stop by running out of calendar,
 * by being paused, or by archiving the patient — so a doctor who had seen
 * someone recover had no way to say so, and the record showed a plan that
 * simply ran out.
 *
 * **Finished** arms before it acts. Unlike "Stop calls", which is the emergency
 * brake and is one click on purpose, this one is not reversible: closing a plan
 * skips its remaining calls, and the way back is to write a new note.
 *
 * **Another follow-up** is offered while this plan is still live because that is
 * when it is usually wanted — a second condition appears at a second
 * consultation. Approving the successor closes this one as superseded, so
 * nothing has to be finished first.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { finishTreatmentAction } from "@/app/(console)/plans/actions";

export function TreatmentControls({
  planId,
  patientId,
  patientName,
}: {
  planId: string;
  patientId: string;
  patientName: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (armed) {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--print-2)", maxWidth: 520 }}>
          Every call still scheduled for {patientName} is dropped and this plan
          is closed. The calls already made stay in the record. To follow them up
          again you would write a new note.
        </span>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await finishTreatmentAction(planId, patientId);
              setArmed(false);
            })
          }
        >
          {pending ? "Closing…" : "Yes, finish it"}
        </Button>
        <Button variant="onLabel" disabled={pending} onClick={() => setArmed(false)}>
          Keep following up
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
      <Button variant="onLabel" href={`/plans/${planId}`}>
        See the whole plan
      </Button>
      <Button variant="onLabel" href={`/patients/${patientId}/new-plan`}>
        Another follow-up
      </Button>
      <Button variant="onLabel" onClick={() => setArmed(true)}>
        Treatment finished
      </Button>
    </div>
  );
}
