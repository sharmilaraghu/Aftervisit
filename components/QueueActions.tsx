"use client";

/**
 * What a clinician does about an escalation: handle the person, then decide.
 *
 * The primary used to be "Done — restart the follow-up". On a patient
 * escalated for vomiting and unable to keep water down, the one amber button
 * on the page pointed a tired clinician at re-arming the calls — turning the
 * machine back on before anyone had spoken to the person. The order is now the
 * clinical one:
 *
 *   I've contacted them  — the primary. Opens the note and the decision; it
 *                          changes nothing on its own.
 *   then one of          — resume calls (or keep them running), end the
 *                          follow-up, or not yet. Ending arms before it fires.
 *   I have read this     — a state, not an action. `open` means nobody has
 *                          looked; `acknowledged` means somebody has.
 *
 * Phoning the patient lives here too, relabelled. It is the doctor's own
 * phone (`tel:`), and "Call Asha" in a product whose whole point is an agent
 * that calls read as "have the agent dial now" — the one thing that never
 * happens by accident.
 */

import { useState, useTransition } from "react";

import { Button, Textarea } from "@/components/ui";
import {
  acknowledgeEscalationAction,
  closePlanAction,
  resolveEscalationAction,
} from "@/app/(console)/plans/actions";

type Armed = null | "handled" | "close";

const BAND = "calc(var(--cell) * 2) calc(var(--cell) * 2.5)";

export function QueueActions({
  escalationId,
  planId,
  patientName,
  phoneE164,
  pausedPlan,
  status,
  planLive,
}: {
  escalationId: string;
  planId: string;
  patientName: string;
  /** The patient's number, for the doctor's own phone. Never dialled by Care Loop from here. */
  phoneE164?: string;
  pausedPlan: boolean;
  /** `open` means nobody has looked at it yet. */
  status: string;
  /**
   * Whether there is still a follow-up to end.
   *
   * An escalation outlives the plan that raised it — a completed course keeps
   * its unresolved escalations, and this strip was offering "End the
   * follow-up" and printing "The plan is still running" on a course that had
   * already finished, two lines under a ledger saying it had.
   */
  planLive: boolean;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const firstName = patientName.split(" ")[0];
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
          ) : !planLive ? (
            <>This follow-up has already ended. Recording what you did closes the escalation.</>
          ) : pausedPlan ? (
            <>
              Calls stay paused until you choose. Resuming skips the calls missed while it
              was paused rather than dialling them all at once.
            </>
          ) : (
            <>The follow-up is still running and stays running.</>
          )}
        </p>

        <label
          htmlFor={`note-${escalationId}`}
          style={{
            display: "block",
            color: "var(--print-2)",
            fontSize: 14,
            fontWeight: 600,
            marginBottom: "calc(var(--cell) * 0.75)",
          }}
        >
          What happened? <span style={{ fontWeight: 400, color: "var(--print-3)" }}>(optional)</span>
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
          {closing ? (
            <>
              <Button
                variant="onLabel"
                disabled={pending}
                onClick={() => startTransition(() => closePlanAction(escalationId, planId, trimmed))}
              >
                {pending ? "Working…" : "Yes, end the follow-up"}
              </Button>
              <Button variant="onLabel" disabled={pending} onClick={() => setArmed("handled")}>
                Back
              </Button>
            </>
          ) : (
            <>
              {/* The decision, now that the person has been dealt with. */}
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  startTransition(() => resolveEscalationAction(escalationId, planId, trimmed))
                }
              >
                {pending
                  ? "Working…"
                  : !planLive
                    ? "Mark handled"
                    : pausedPlan
                      ? "Resume calls"
                      : "Keep following up"}
              </Button>
              {planLive ? (
                <Button variant="onLabel" disabled={pending} onClick={() => setArmed("close")}>
                  End follow-up
                </Button>
              ) : null}
              <Button variant="onLabel" disabled={pending} onClick={() => setArmed(null)}>
                Not yet
              </Button>
            </>
          )}
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
      {/* The page's one amber while a plan is live: the header's primary is
          empty then. On a finished plan the header keeps it. */}
      <Button
        variant={planLive ? "primary" : "onLabel"}
        disabled={pending}
        onClick={() => setArmed("handled")}
      >
        I&rsquo;ve contacted {firstName}
      </Button>

      {phoneE164 ? (
        <Button variant="onLabel" href={`tel:${phoneE164}`} ariaLabel={`Phone ${patientName} from your own phone`}>
          Phone {firstName} yourself
        </Button>
      ) : null}

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
        {!planLive
          ? "This follow-up has ended"
          : pausedPlan
            ? "Nothing is dialling until you decide"
            : "The plan is still running"}
      </span>
    </div>
  );
}
