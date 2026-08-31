"use client";

/**
 * The three things a clinician can do to a patient record, in order of how much
 * they destroy.
 *
 * **Stop calls** is the emergency brake and is deliberately the easiest to
 * reach: one click, no confirmation. When someone realises the agent is about
 * to phone a person it should not, asking them "are you sure?" is the wrong
 * response — stopping is always safe and always reversible, because the plan
 * can be resumed.
 *
 * **Archive** and **Delete** both arm before they act, and each spells out what
 * actually happens, because "archive" and "delete" are words people assume they
 * already understand. One keeps the call history; the other does not.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import {
  archivePatientAction,
  deletePatientAction,
  stopCallsAction,
} from "@/app/(console)/patients/actions";

type Armed = null | "archive" | "delete";

export function PatientControls({
  id,
  name,
  hasPendingCalls,
}: {
  id: string;
  name: string;
  hasPendingCalls: boolean;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [stopped, setStopped] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const explain =
    armed === "archive"
      ? `Archiving ${name} stops every scheduled call and closes the plan. Their calls and escalations stay in the history — nothing is deleted.`
      : armed === "delete"
        ? `Deleting ${name} removes the patient, their plans, every call and every transcript, permanently. There is no undo. Archive instead if you might want the record later.`
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
          onClick={() =>
            startTransition(() =>
              armed === "archive" ? archivePatientAction(id) : deletePatientAction(id),
            )
          }
        >
          {pending ? "Working…" : armed === "archive" ? "Yes, archive" : "Yes, delete permanently"}
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
      <Button variant="ghost" href={`/patients/${id}/edit`}>
        Edit patient
      </Button>

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

      <Button variant="ghost" onClick={() => setArmed("archive")}>
        Archive
      </Button>
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
