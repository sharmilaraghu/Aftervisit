"use client";

/**
 * The two decisions a clinician makes about an escalation, and one state.
 *
 * There used to be three buttons of identical weight sitting in a row, one of
 * which **ended the patient's follow-up on a single click**. It looked exactly
 * like the one beside it. Everything else consequential in this console arms
 * first — cancelling a plan, archiving, deleting, finishing a treatment — and
 * this was the one place that did not.
 *
 * The shape now follows the decisions rather than the endpoints:
 *
 *   Done with this      — I have handled it. Restarts the plan if this
 *                         escalation stopped it, leaves it alone if not.
 *   End the follow-up   — the whole plan is over. Arms before it fires.
 *   I have read this    — a state, not an action. `open` means nobody has
 *                         looked; `acknowledged` means somebody has.
 *
 * Both actions take a note, because the queue could record *that* an
 * escalation was closed and never *what happened* — so "I rang her, she is
 * fine" had nowhere to live, and the next person read the same evidence from
 * scratch. The field is optional and it is kept verbatim.
 */

import { useState, useTransition } from "react";

import { Button, Textarea } from "@/components/ui";
import {
  acknowledgeEscalationAction,
  closePlanAction,
  resolveEscalationAction,
} from "@/app/(console)/plans/actions";

type Armed = null | "resolve" | "close";

const BAND = "calc(var(--cell) * 2) calc(var(--cell) * 2.5)";

export function QueueActions({
  escalationId,
  planId,
  patientName,
  pausedPlan,
  status,
}: {
  escalationId: string;
  planId: string;
  patientName: string;
  pausedPlan: boolean;
  /** `open` means nobody has looked at it yet. */
  status: string;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const trimmed = note.trim() || null;

  if (armed) {
    const closing = armed === "close";
    return (
      <div
        style={{
          padding: BAND,
          background: closing ? "var(--danger-wash)" : "var(--label-2)",
          boxShadow: closing ? "inset 0 0 0 1px var(--danger)" : "inset 0 0 0 1px var(--rule)",
        }}
      >
        <p
          style={{
            margin: "0 0 calc(var(--cell) * 2)",
            color: "var(--print)",
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: "60ch",
          }}
        >
          {closing ? (
            <>
              <strong>Every remaining call for {patientName} is dropped.</strong> The
              record is kept. No undo — starting again means a new note.
            </>
          ) : pausedPlan ? (
            <>
              Calls missed while it was stopped are skipped, not dialled all at once.
            </>
          ) : (
            <>The follow-up is still running and stays running.</>
          )}
        </p>

        <label
          className="caps"
          htmlFor={`note-${escalationId}`}
          style={{ display: "block", color: "var(--print-3)", marginBottom: "calc(var(--cell) * 0.75)" }}
        >
          What did you do?
        </label>
        <Textarea
          id={`note-${escalationId}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Rang her, she is keeping fluids down now."
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
          <Button
            variant="onLabel"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                closing
                  ? closePlanAction(escalationId, planId, trimmed)
                  : resolveEscalationAction(escalationId, planId, trimmed),
              )
            }
          >
            {pending
              ? "Working…"
              : closing
                ? "Yes, end the follow-up"
                : pausedPlan
                  ? "Done — restart the follow-up"
                  : "Done with this"}
          </Button>
          <Button variant="onLabel" disabled={pending} onClick={() => setArmed(null)}>
            {closing ? "Keep it running" : "Cancel"}
          </Button>
          <span className="caps" style={{ color: "var(--print-3)" }}>
            The note is optional
          </span>
        </div>
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
        padding: BAND,
        background: "var(--label-2)",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <Button variant="onLabel" disabled={pending} onClick={() => setArmed("resolve")}>
        {pausedPlan ? "Done — restart the follow-up" : "Done with this"}
      </Button>
      <Button variant="onLabel" disabled={pending} onClick={() => setArmed("close")}>
        End the follow-up
      </Button>

      {/*
        Reading is not deciding. A clinician who has looked at an escalation but
        cannot act on it yet needs a way to say so, or the next person picks it
        up from scratch and the queue cannot tell the two apart.
      */}
      {status === "open" ? (
        <Button
          variant="onLabel"
          disabled={pending}
          onClick={() => startTransition(() => acknowledgeEscalationAction(escalationId))}
        >
          I have read this
        </Button>
      ) : (
        <span className="caps" style={{ color: "var(--clear)" }}>
          Read
        </span>
      )}

      <span className="caps" style={{ marginLeft: "auto", color: "var(--print-3)" }}>
        {pausedPlan ? "Nothing is dialling until you decide" : "The plan is still running"}
      </span>
    </div>
  );
}
