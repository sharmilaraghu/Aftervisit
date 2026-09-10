"use client";

/**
 * The things a clinician can do to a patient record, in order of how much they
 * destroy.
 *
 * **Stop calls** is the emergency brake and is deliberately the easiest to
 * reach: one click, no confirmation. When someone realises the agent is about
 * to phone a person it should not, asking them "are you sure?" is the wrong
 * response — stopping is always safe and always reversible, because the plan
 * can be resumed.
 *
 * That last clause was, for a while, false. `stopCalls` pauses without raising
 * an escalation, and the only resume path in the app hung off an escalation
 * card — so the brake was a one-way door and this comment was the argument for
 * why it needed no confirmation. **Resume the follow-up** is what makes the
 * sentence true, and it appears whenever the plan is paused, carrying the
 * reason it was paused so the button explains itself.
 *
 * **Delete** arms before it acts and spells out what happens, because it takes
 * the call history with it and there is no undo.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import {
  deletePatientAction,
  resumeStoppedPlanAction,
  stopCallsAction,
} from "@/app/(console)/patients/actions";

type Armed = null | "delete";

export function PatientControls({
  id,
  name,
  hasPendingCalls,
  planId,
  paused,
  pausedReason,
}: {
  id: string;
  name: string;
  hasPendingCalls: boolean;
  /** Null when this patient has no plan at all — then there is nothing to resume. */
  planId: string | null;
  paused: boolean;
  pausedReason: string | null;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [stopped, setStopped] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const explain = armed
    ? `Deleting ${name} removes the patient, their plans, every call and every transcript, permanently. There is no undo.`
    : null;

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
        <span style={{ fontSize: 14, color: "var(--bench-ink-2)", maxWidth: 520 }}>
          {explain}
        </span>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(() => deletePatientAction(id))}
        >
          {pending ? "Working…" : "Yes, delete permanently"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setArmed(null)}>
          Keep
        </Button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "calc(var(--cell) * 1.5)",
        alignItems: "center",
      }}
    >
      {paused && planId ? (
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(() => resumeStoppedPlanAction(id, planId))
            }
          >
            {pending ? "Resuming…" : "Resume the follow-up"}
          </Button>
          <span style={{ fontSize: 14, color: "var(--bench-ink-2)", maxWidth: 460 }}>
            {/* The reason is written at pause time and was rendered nowhere, so
                "why did this stop?" had no answer on any screen. */}
            {pausedReason ? `Paused: ${pausedReason.toLowerCase()}. ` : "Paused. "}
            Calls missed while it was paused are skipped, not dialled at once.
          </span>
        </>
      ) : null}

      {hasPendingCalls ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await stopCallsAction(id);
              setStopped(result.stopped);
            })
          }
        >
          {pending ? "Stopping…" : "Stop all calls"}
        </Button>
      ) : null}

      <Button variant="ghost" onClick={() => setArmed("delete")}>
        Delete
      </Button>

      {stopped !== null ? (
        <span role="status" style={{ fontSize: 14, color: "var(--bench-ink-2)", maxWidth: 460 }}>
          {stopped === 0
            ? "Nothing was waiting to be dialled. The plan is paused."
            : `${stopped} ${stopped === 1 ? "call" : "calls"} stopped and the plan is paused. `}
          {/*
            Said plainly rather than left to be discovered. CALL-E has no cancel
            endpoint, so a call already in progress cannot be pulled back, and a
            control that implied otherwise would be worse than none.
          */}
          A call already in progress cannot be recalled.
        </span>
      ) : null}
    </div>
  );
}
