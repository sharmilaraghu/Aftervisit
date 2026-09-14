"use client";

/**
 * What a clinician does about an escalation, in the order they do it.
 *
 *   Phone them yourself   — the primary: the first thing a doctor does about a
 *                           patient in trouble. The doctor's own phone (`tel:`);
 *                           Aftervisit dials nothing from here.
 *   View patient record   — everything else about this patient, including the
 *                           ways to amend or restart the follow-up.
 *   Handled               — the decision: resolve it (resuming paused calls),
 *                           or end the follow-up. Nothing changes until one is
 *                           chosen, and the next step says what each will do.
 *
 * It used to lead with "I've contacted them", a claim that recorded nothing and
 * hid the real choice behind it — which then appeared under three names
 * ("Resume calls", "Keep following up", "Mark handled") beside a "Not yet" that
 * meant Cancel, and a caps line about dialling. Ending arms before it fires,
 * and its confirm is the one red button, because it cannot be undone.
 */

import { useState, useTransition } from "react";

import { Button, Textarea } from "@/components/ui";
import { closePlanAction, resolveEscalationAction } from "@/app/(console)/plans/actions";

type Armed = null | "spoken" | "end";

const RED = { background: "var(--danger)", color: "#ffffff", borderColor: "var(--danger)" };

export function QueueActions({
  escalationId,
  planId,
  patientName,
  phoneE164,
  pausedPlan,
  planLive,
  recordHref,
}: {
  escalationId: string;
  planId: string;
  patientName: string;
  /** The patient's number, for the doctor's own phone. Never dialled by Aftervisit. */
  phoneE164?: string;
  pausedPlan: boolean;
  /** Kept for callers; the escalation's read state no longer changes anything here. */
  status?: string;
  /** Whether there is still a follow-up to resume or end. */
  planLive: boolean;
  /** Where the whole record is. Omitted on the record itself. */
  recordHref?: string;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const firstName = patientName.split(" ")[0];
  const trimmed = note.trim() || null;

  const run = (act: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await act();
      } catch {
        setError("That didn't go through. Nothing changed — try again.");
      }
    });

  const errorLine = error ? (
    <p role="alert" style={{ margin: "calc(var(--cell) * 1.5) 0 0", fontSize: 14, color: "var(--danger-deep)" }}>
      {error}
    </p>
  ) : null;

  const row = { display: "flex", flexWrap: "wrap" as const, gap: "calc(var(--cell) * 1.5)", alignItems: "center" };

  if (armed === "end") {
    return (
      <div style={{ maxWidth: 620 }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", fontSize: 14, lineHeight: 1.5, color: "var(--print)" }}>
          <strong>All remaining calls to {firstName} are cancelled.</strong> This can&rsquo;t be undone.
        </p>
        <div style={row}>
          <Button variant="primary" style={RED} disabled={pending} onClick={() => run(() => closePlanAction(escalationId, planId, trimmed))}>
            {pending ? "Ending…" : "End follow-up"}
          </Button>
          <Button variant="onLabel" disabled={pending} onClick={() => setArmed("spoken")}>
            Back
          </Button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (armed === "spoken") {
    return (
      <div style={{ maxWidth: 620 }}>
        {/* What marking it handled will do, before it is done. */}
        <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", fontSize: 14, lineHeight: 1.5, color: "var(--print)" }}>
          {!planLive
            ? "This follow-up has already ended, so this only closes the escalation."
            : pausedPlan
              ? `Calls to ${firstName} start again. The ones missed while they were paused are not dialled.`
              : "The follow-up carries on as it is."}
        </p>
        <label
          htmlFor={`note-${escalationId}`}
          style={{ display: "block", color: "var(--print-2)", fontSize: 14, fontWeight: 600, marginBottom: "calc(var(--cell) * 0.75)" }}
        >
          What happened? <span style={{ fontWeight: 400, color: "var(--print-3)" }}>(optional)</span>
        </label>
        <Textarea
          id={`note-${escalationId}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Spoke to her — keeping fluids down now."
          style={{ marginBottom: "calc(var(--cell) * 1.5)" }}
        />
        <div style={row}>
          <Button variant="primary" disabled={pending} onClick={() => run(() => resolveEscalationAction(escalationId, planId, trimmed))}>
            {pending ? "Saving…" : "Handled"}
          </Button>
          {planLive ? (
            <Button variant="onLabel" disabled={pending} onClick={() => setArmed("end")}>
              End follow-up
            </Button>
          ) : null}
          <Button variant="onLabel" disabled={pending} onClick={() => setArmed(null)}>
            Cancel
          </Button>
        </div>
        {errorLine}
      </div>
    );
  }

  return (
    <div style={row}>
      {phoneE164 ? (
        <Button variant="primary" href={`tel:${phoneE164}`} ariaLabel={`Phone ${patientName} from your own phone`}>
          Phone {firstName} yourself
        </Button>
      ) : null}
      {recordHref ? (
        <Button variant="onLabel" href={recordHref} ariaLabel={`View ${patientName}'s record`}>
          View patient record
        </Button>
      ) : null}
      {/* "Handled" is the decision: it resolves the escalation and, when this
          one paused the calls, starts them again. What it will do is said on
          the next step, before it fires. */}
      <Button variant={phoneE164 ? "onLabel" : "primary"} onClick={() => setArmed("spoken")}>
        Handled
      </Button>
    </div>
  );
}
