"use client";

/**
 * The two ways a course of treatment ends.
 *
 * Until this existed, a follow-up could only stop by running out of calendar,
 * by being paused, or by archiving the patient — so a doctor who had seen
 * someone recover had no way to say so, and the record showed a plan that
 * simply ran out.
 *
 * **Finished** arms before it acts, and asks how it resolved. Unlike "Stop
 * calls", which is the emergency brake and is one click on purpose, this one is
 * not reversible: closing a plan skips its remaining calls, and the way back is
 * to write a new note. The summary is the one thing the record cannot
 * reconstruct afterwards — the calls say what was asked and answered, and
 * nothing says whether the patient got better.
 *
 * **Another follow-up** is offered while this plan is still live because that is
 * when it is usually wanted — a second condition appears at a second
 * consultation. Approving the successor closes this one as superseded, so
 * nothing has to be finished first.
 */

import { useState, useTransition } from "react";

import { Button, Textarea } from "@/components/ui";
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
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();

  if (armed) {
    return (
      <div style={{ display: "grid", gap: "calc(var(--cell) * 1.5)", maxWidth: 620 }}>
        <span style={{ fontSize: 14, color: "var(--print-2)" }}>
          Every call still scheduled for {patientName} is dropped and this plan is closed.
          The calls already made stay in the record.
        </span>

        <label style={{ display: "grid", gap: "calc(var(--cell) * 0.75)" }}>
          <span className="caps" style={{ color: "var(--print-3)" }}>
            How did it resolve?
          </span>
          <Textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Tolerating the metformin, no further vomiting. Discharged from follow-up."
            style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
          />
          <span style={{ color: "var(--print-3)", fontSize: 13 }}>
            Kept on {patientName}&rsquo;s record and shown first if they come back.
          </span>
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await finishTreatmentAction(planId, patientId, summary);
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
      </div>
    );
  }

  /*
   * Folded. These are lifecycle decisions, made once per course, and printed
   * open they were three more peers in a wall of thirteen same-weight buttons
   * on the page a clinician reaches from an escalation. "See the whole plan"
   * went entirely: the header already carries that link.
   */
  return (
    <details className="disclosure">
      <summary>Manage this follow-up</summary>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          marginTop: "calc(var(--cell) * 1.5)",
        }}
      >
        <Button variant="onLabel" href={`/register?patient=${patientId}`}>
          Book another visit
        </Button>
        <Button variant="onLabel" onClick={() => setArmed(true)}>
          Treatment finished
        </Button>
      </div>
    </details>
  );
}
