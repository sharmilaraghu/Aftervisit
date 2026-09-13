"use client";

/**
 * Close a patient's file, saying how it resolved.
 *
 * The same act whether the follow-up is still running or its window already
 * ran out — and so the same control. It arms before it acts and asks one
 * question, because the closing note is the one thing the record cannot
 * reconstruct: the calls say what was asked and answered, and nothing says
 * whether the patient got better.
 *
 *   running  → `finishTreatmentAction`: drops the scheduled calls, closes it
 *   finished → `closeFinishedAction`: nothing left to drop, records the note
 */

import { useState, useTransition } from "react";

import { Button, Textarea } from "@/components/ui";
import { closeFinishedAction, finishTreatmentAction } from "@/app/(console)/plans/actions";

export function CloseFile({
  planId,
  patientId,
  patientName,
  finished,
}: {
  planId: string;
  patientId: string;
  patientName: string;
  /** True when the window already ran out, so there are no calls to drop. */
  finished: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();

  /* "End follow-up" while calls are still due — the same name the escalation
     panel uses; "Close file" once the window has already run out. */
  if (!armed) {
    return (
      <Button variant="onLabel" onClick={() => setArmed(true)}>
        {finished ? "Close file" : "End follow-up"}
      </Button>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "calc(var(--cell) * 1.5)",
        flexBasis: "100%",
        maxWidth: 620,
      }}
    >
      {!finished ? (
        <span style={{ fontSize: 14, color: "var(--print)" }}>
          <strong>All remaining calls to {patientName.split(" ")[0]} are cancelled.</strong> This
          can&rsquo;t be undone.
        </span>
      ) : null}
      <label style={{ display: "grid", gap: "calc(var(--cell) * 0.75)" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--print-2)" }}>
          What happened? <span style={{ fontWeight: 400, color: "var(--print-3)" }}>(optional)</span>
        </span>
        <Textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Wound healed, no fever. Discharged from follow-up."
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
        <Button
          variant="primary"
          /* Red when it cancels calls: that is the irreversible act. */
          style={finished ? undefined : { background: "var(--danger)", color: "#ffffff", borderColor: "var(--danger)" }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (finished) await closeFinishedAction(planId, patientId, summary);
              else await finishTreatmentAction(planId, patientId, summary);
            })
          }
        >
          {pending ? "Saving…" : finished ? "Close file" : "End follow-up"}
        </Button>
        <Button variant="onLabel" disabled={pending} onClick={() => setArmed(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}
