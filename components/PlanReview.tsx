"use client";

/**
 * The two interactive parts of the review screen.
 *
 * Approve is one button and it is the only amber-filled element on the page —
 * there is exactly one primary action here, and it is the one that makes the
 * agent start phoning someone.
 */

import { useState, useTransition } from "react";

import { Button, Field, Panel, Select, TextInput } from "@/components/ui";
import { approvePlanAction, updateDraftAction } from "@/app/(console)/plans/actions";
import { TIME_SCALE_OPTIONS } from "@/lib/patients/plan-form";

export function PlanDraftControls({
  planId,
  durationDays,
  localTime,
  timeScale,
}: {
  planId: string;
  durationDays: number;
  localTime: string;
  timeScale: number;
}) {
  const [open, setOpen] = useState(false);
  const action = updateDraftAction.bind(null, planId);

  if (!open) {
    return (
      <p style={{ margin: "calc(var(--cell) * 3) 0 0" }}>
        <Button variant="onLabel" onClick={() => setOpen(true)}>
          Change the cadence
        </Button>
      </p>
    );
  }

  return (
    <form
      action={action}
      style={{
        marginTop: "calc(var(--cell) * 3)",
        paddingTop: "calc(var(--cell) * 3)",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 3)" }}>
        <div style={{ minWidth: 140 }}>
          <Field label="Days" htmlFor="durationDays">
            <TextInput
              id="durationDays"
              name="durationDays"
              mono
              inputMode="numeric"
              defaultValue={String(durationDays)}
            />
          </Field>
        </div>
        <div style={{ minWidth: 140 }}>
          <Field label="Local time" htmlFor="localTime">
            <TextInput id="localTime" name="localTime" mono defaultValue={localTime} />
          </Field>
        </div>
        <div style={{ minWidth: 280, flex: 1 }}>
          <Field label="Clock" htmlFor="timeScale">
            <Select
              id="timeScale"
              name="timeScale"
              defaultValue={String(timeScale)}
              options={TIME_SCALE_OPTIONS}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: "flex", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
        <Button type="submit" variant="onLabel">
          Save
        </Button>
        <Button variant="onLabel" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="caps" style={{ color: "var(--print-3)" }}>
          Anything you change here is marked as yours
        </span>
      </div>
    </form>
  );
}

/**
 * The moment of commitment.
 *
 * Approving is the only irreversible act in the product: it makes a machine
 * telephone a real person. So the button restates, in one place, everything a
 * doctor needs to be sure of before they press it — who is called, on what
 * number, when the first call goes out in *their* local time, how many calls
 * this authorises, and whether that number is actually armed to dial.
 *
 * The allowlist line is the one that matters most. Without it, a doctor cannot
 * tell an approval that will ring a phone from one whose every call will be
 * refused, and those are completely different acts.
 */
export function ApprovePlan({
  planId,
  canApprove,
  patientName,
  maskedPhone,
  firstCallAt,
  timezone,
  calls,
  maxAttempts,
  consent,
  language,
  allowlisted,
  allowlistOpen = false,
}: {
  planId: string;
  canApprove: boolean;
  patientName: string;
  maskedPhone: string;
  firstCallAt: string;
  timezone: string;
  calls: number;
  maxAttempts: number;
  consent: string;
  /** BCP 47 tag with its label, e.g. "hi-IN — Hindi". What the agent will speak. */
  language: string;
  allowlisted: boolean;
  /** True when the gate is open for every number, not this one specifically. */
  allowlistOpen?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!canApprove) {
    return (
      <p
        role="alert"
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 2)",
          background: "var(--danger-wash)",
          boxShadow: "inset 0 0 0 1px var(--danger)",
          color: "var(--print)",
          fontSize: 15,
        }}
      >
        <strong>Nothing here passed the clinical guard.</strong> There is nothing
        safe to ask, so this plan cannot be approved.
      </p>
    );
  }

  return (
    <Panel title="Before you approve">
      <div style={{ padding: "calc(var(--cell) * 3)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print)", fontSize: 17, lineHeight: 1.5 }}>
          Care Loop will call <strong>{patientName}</strong> on{" "}
          <span className="mono">{maskedPhone}</span>.
        </p>

        <dl
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 4)",
            margin: "0 0 calc(var(--cell) * 3)",
          }}
        >
          {[
            ["First call", calls === 0 ? "nothing scheduled" : `${firstCallAt} · ${timezone}`],
            [
              "Authorises",
              calls === 0
                ? "no calls — see below"
                : `${calls} ${calls === 1 ? "call" : "calls"}, up to ${maxAttempts} attempts each`,
            ],
            ["Consent", consent],
            ["Language", language],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="caps" style={{ color: "var(--print-3)", marginBottom: 2 }}>
                {label}
              </dt>
              <dd className="mono" style={{ margin: 0, fontSize: 14, color: "var(--print)" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {calls === 0 ? (
          <p
            style={{
              margin: "0 0 calc(var(--cell) * 3)",
              padding: "calc(var(--cell) * 2)",
              background: "var(--danger-wash)",
              boxShadow: "inset 0 0 0 1px var(--danger)",
              color: "var(--print)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong>This plan would schedule nothing.</strong> Every call in the
            window lands in the past — the local time has already gone today.
            Use <em>Change the cadence</em> above to set a later time, or a
            longer window.
          </p>
        ) : null}

        <p
          style={{
            margin: "0 0 calc(var(--cell) * 3)",
            padding: "calc(var(--cell) * 2)",
            background: allowlisted ? "var(--clear-wash)" : "var(--amber-wash)",
            boxShadow: `inset 0 0 0 1px var(--${allowlisted ? "clear" : "amber"})`,
            color: "var(--print)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {allowlisted ? (
            allowlistOpen ? (
              <>
                {/*
                  Said differently on purpose. "This number is armed" would imply
                  somebody armed it; the gate is simply open for everything.
                */}
                <strong>The dial allowlist is open.</strong> Any number on an
                approved plan can be called, so approving will cause a real phone
                to ring.
              </>
            ) : (
              <>
                <strong>This number is on the dial allowlist.</strong> Approving will
                cause a real phone to ring.
              </>
            )
          ) : (
            <>
              <strong>This number is not on the dial allowlist.</strong> The plan
              will run and every call will be refused with a visible reason —
              nothing will ring. Add it to <span className="mono">CARELOOP_CALL_ALLOWLIST</span> to
              place real calls.
            </>
          )}
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 1.5)",
            alignItems: "center",
          }}
        >
          <Button
            variant="primary"
            disabled={pending || calls === 0}
            onClick={() =>
              startTransition(async () => {
                const result = await approvePlanAction(planId);
                // Approval can be refused — a window whose every call would
                // land in the past, for one. Surfacing that here is the whole
                // point: it used to redirect and look exactly like success.
                setRefusal(result.ok ? null : (result.reason ?? "That plan could not be approved."));
              })
            }
          >
            {pending ? "Approving…" : "Approve — start the follow-up"}
          </Button>
          <span className="caps" style={{ alignSelf: "center", color: "var(--print-3)" }}>
            This cannot be undone
          </span>
        </div>

        {refusal ? (
          <p
            role="alert"
            style={{
              margin: "calc(var(--cell) * 3) 0 0",
              padding: "calc(var(--cell) * 2)",
              background: "var(--danger-wash)",
              boxShadow: "inset 0 0 0 1px var(--danger)",
              color: "var(--print)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {refusal}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
