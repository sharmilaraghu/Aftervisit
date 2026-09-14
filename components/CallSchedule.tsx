"use client";

/**
 * The calls still to come, and a way to place one now.
 *
 * After "Save and start follow-up" the dated calls sat at the bottom of the
 * page, below the whole write-up, in a table nobody could change. A doctor
 * could not see at a glance when the assistant would ring, move a call that
 * landed in the patient's working hours, or drop one they had asked to miss.
 * So the calls to come lead here, each movable and skippable on its own, with
 * "Try a call" beside them for when the doctor wants to hear from the patient
 * now rather than at ten tomorrow.
 *
 * Try a call follows OpenLine's: a confirm that names the person, the masked
 * number and the language before anything rings, then the page stays on the
 * call and shows what came back when it ends. Unlike OpenLine's, the call is
 * saved before it dials — Aftervisit's rule — so leaving the page loses nothing.
 *
 * Times are printed and edited in the patient's zone, never the browser's —
 * "17:30" has to mean 17:30 where the phone rings.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Badge, Button, Notice, TextInput } from "@/components/ui";
import {
  rescheduleCallAction,
  skipCallAction,
  tryCallAction,
  watchCallAction,
  type CallWatch,
} from "@/app/(console)/followups/actions";
import { formatStamp } from "@/lib/format";
import { outcomeLabel, outcomeTone } from "@/lib/patients/labels";
import { localDate } from "@/lib/time/clock";

export interface UpcomingCall {
  id: string;
  occurrence: number;
  attempt: number;
  /** `planned` is a day of the calendar; `try` is an extra call a doctor placed. */
  kind: string;
  scheduledFor: Date;
}

/* Red for the act that reaches a real phone, the same way CloseFile reddens the act that cancels calls. */
const DIAL_STYLE = { background: "var(--danger)", color: "#ffffff", borderColor: "var(--danger)" };

/** A follow-up call runs a few minutes; past this the page stops asking, and says so. */
const GIVE_UP_AFTER_MS = 12 * 60_000;

type Stage =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "watching"; callId: string; startedAt: number; status: string | null; gaveUp: boolean }
  | { kind: "done"; callId: string; watch: Extract<CallWatch, { done: true }> };

/** `HH:MM` on a 24-hour clock in the patient's zone — the shape a time input takes. */
function wallTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function CallSchedule({
  planId,
  patientId,
  patientName,
  maskedPhone,
  language,
  timezone,
  maxAttempts,
  upcoming,
  paused,
  blocked,
}: {
  planId: string;
  patientId: string;
  patientName: string;
  /** Masked, always: this page ends up in a published video. */
  maskedPhone: string;
  /** The language the assistant speaks to this patient, as a label. */
  language: string;
  timezone: string;
  maxAttempts: number;
  /** Calls still waiting to be placed, soonest first. */
  upcoming: UpcomingCall[];
  /** A paused plan places nothing, so nothing here can be moved or tried. */
  paused: boolean;
  /** Why no call would be placed at all — consent, the lock, no key. Null when one would. */
  blocked: string | null;
}) {
  const router = useRouter();
  const firstName = patientName.split(" ")[0];
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = upcoming[0];

  const watchingId = stage.kind === "watching" && !stage.gaveUp ? stage.callId : null;
  const startedAt = stage.kind === "watching" ? stage.startedAt : 0;

  /*
   * While the call is live, ask the server where it has got to. The server
   * re-fetches through the authenticated API and finishes the call when CALL-E
   * is done; this page holds nothing about the call except its id.
   */
  useEffect(() => {
    if (!watchingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let watch: CallWatch;
      try {
        watch = await watchCallAction(watchingId, patientId);
      } catch {
        watch = { done: false, status: "unreachable" };
      }
      if (cancelled) return;

      if (watch.done) {
        setStage({ kind: "done", callId: watchingId, watch });
        router.refresh();
        return;
      }
      const gaveUp = Date.now() - startedAt > GIVE_UP_AFTER_MS;
      setStage((s) =>
        s.kind === "watching" && s.callId === watchingId ? { ...s, status: watch.status, gaveUp } : s,
      );
      if (!gaveUp) timer = setTimeout(poll, 4_000);
    };

    timer = setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watchingId, startedAt, patientId, router]);

  const placeCall = () =>
    startTransition(async () => {
      const outcome = await tryCallAction(planId, patientId);
      if (outcome.ok && outcome.callId) {
        setNotice(null);
        setStage({ kind: "watching", callId: outcome.callId, startedAt: Date.now(), status: null, gaveUp: false });
      } else {
        setNotice(outcome.message);
        setStage({ kind: "idle" });
      }
      router.refresh();
    });

  const busy = stage.kind === "watching" && !stage.gaveUp;

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "calc(var(--cell) * 2)",
          padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
        }}
      >
        <p style={{ margin: 0, fontSize: 15, color: "var(--print-2)" }}>
          {paused ? (
            "Calls are on hold while this follow-up is paused."
          ) : next ? (
            <>
              Next call{" "}
              <span className="mono" style={{ color: "var(--print)", fontWeight: 700 }}>
                {formatStamp(next.scheduledFor, timezone)}
              </span>
            </>
          ) : (
            "No calls are left to place."
          )}
        </p>
        {!paused && stage.kind !== "confirm" && !busy ? (
          <Button
            variant="primary"
            disabled={pending || blocked !== null}
            ariaLabel={`Try a call to ${patientName} now`}
            onClick={() => {
              setNotice(null);
              setStage({ kind: "confirm" });
            }}
          >
            Try a call
          </Button>
        ) : null}
      </div>

      {blocked && !paused ? (
        <p className="measure" style={{ margin: 0, padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 2)", fontSize: 13, color: "var(--print-3)" }}>
          {blocked}
        </p>
      ) : null}

      {stage.kind === "confirm" ? (
        <div style={{ display: "grid", gap: "calc(var(--cell) * 1.5)", padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 2)" }}>
          <p className="measure" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
            Call {firstName} at <span className="mono">{maskedPhone}</span>, in {language}?
          </p>
          <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--print-2)" }}>
            The phone rings now, and it spends one CALL-E call. The assistant says it is an AI assistant
            before it asks anything. This is an extra call — the planned calls below still ring at their times.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
            <Button variant="primary" style={DIAL_STYLE} disabled={pending} onClick={placeCall}>
              {pending ? "Placing the call…" : `Call ${firstName}`}
            </Button>
            <Button variant="onLabel" disabled={pending} onClick={() => setStage({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {stage.kind === "watching" ? (
        <div style={{ display: "grid", gap: "calc(var(--cell) * 1)", padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 1.5)" }}>
            <Badge tone="danger">On the line</Badge>
            {stage.status ? (
              <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                CALL-E: {stage.status.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
          <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--print)" }}>
            {stage.gaveUp
              ? "This page has stopped waiting. The call is saved, so its result lands under Calls placed as soon as CALL-E reports it."
              : <>Calling {firstName} at <span className="mono">{maskedPhone}</span>. What they said appears here when the call ends — and it is saved either way, so leaving the page loses nothing.</>}
          </p>
        </div>
      ) : null}

      {stage.kind === "done" ? (
        <div style={{ padding: "0 calc(var(--cell) * 3)" }}>
          <Notice
            tone={outcomeTone(stage.watch.outcome).tone}
            label={
              stage.watch.status === "refused"
                ? "Not placed"
                : outcomeLabel(stage.watch.status, stage.watch.outcome, null)
            }
          >
            {stage.watch.recap ?? stage.watch.detail ?? "The call ended."}{" "}
            {stage.watch.status !== "missing" ? (
              <Link href={`/calls/${stage.callId}`} style={{ color: "var(--print)", fontWeight: 700, textUnderlineOffset: 3 }}>
                Read the call
              </Link>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {notice ? (
        <div style={{ padding: "0 calc(var(--cell) * 3)" }}>
          <Notice tone="amber" label="Try a call">
            {notice}
          </Notice>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--rule)" }}>
          {upcoming.map((call, i) => (
            <ScheduleRow
              key={call.id}
              call={call}
              first={i === 0}
              patientId={patientId}
              firstName={firstName}
              timezone={timezone}
              maxAttempts={maxAttempts}
              locked={paused}
            />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ScheduleRow({
  call,
  first,
  patientId,
  firstName,
  timezone,
  maxAttempts,
  locked,
}: {
  call: UpcomingCall;
  first: boolean;
  patientId: string;
  firstName: string;
  timezone: string;
  maxAttempts: number;
  locked: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "skip">("view");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stamp = formatStamp(call.scheduledFor, timezone);

  const open = () => {
    /* From the row as it is now, not as it was when the page first rendered. */
    setDate(localDate(call.scheduledFor, timezone));
    setTime(wallTime(call.scheduledFor, timezone));
    setError(null);
    setMode("edit");
  };

  const save = () =>
    startTransition(async () => {
      const r = await rescheduleCallAction(call.id, patientId, date, time);
      if (r.ok) setMode("view");
      else setError(r.error ?? "The call could not be moved.");
    });

  const skip = () =>
    startTransition(async () => {
      const r = await skipCallAction(call.id, patientId);
      if (!r.ok) {
        setError(r.error ?? "The call could not be skipped.");
        setMode("view");
      }
    });

  const labelStyle = {
    display: "grid",
    gap: "calc(var(--cell) * 0.5)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--print-2)",
  } as const;

  return (
    <li
      style={{
        padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 3)",
        borderTop: first ? undefined : "1px solid var(--rule-2)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 1) calc(var(--cell) * 2)" }}>
        <span className="mono" style={{ fontSize: 15, color: "var(--print)", minWidth: "calc(var(--cell) * 16)" }}>
          {stamp}
        </span>
        <span style={{ flex: 1, fontSize: 14, color: "var(--print-2)" }}>
          {call.kind === "try" ? (
            <Badge tone="plain" quiet>
              Try a call
            </Badge>
          ) : (
            <>
              Day <span className="mono">{call.occurrence}</span>
            </>
          )}
          {call.attempt > 1 ? (
            <>
              {" "}· retry <span className="mono">{call.attempt}</span> of <span className="mono">{maxAttempts}</span>
            </>
          ) : null}
        </span>
        {!locked && mode === "view" ? (
          <span style={{ display: "flex", gap: "calc(var(--cell) * 1)" }}>
            <Button variant="onLabel" ariaLabel={`Change the call on ${stamp}`} onClick={open}>
              Change
            </Button>
            <Button
              variant="onLabel"
              ariaLabel={`Skip the call on ${stamp}`}
              onClick={() => {
                setError(null);
                setMode("skip");
              }}
            >
              Skip
            </Button>
          </span>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div style={{ marginTop: "calc(var(--cell) * 1.5)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "calc(var(--cell) * 1.5)" }}>
            <label style={{ ...labelStyle, width: "calc(var(--cell) * 22)" }}>
              Date
              <TextInput
                mono
                type="date"
                value={date}
                min={localDate(new Date(), timezone)}
                disabled={pending}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label style={{ ...labelStyle, width: "calc(var(--cell) * 16)" }}>
              Time
              <TextInput mono type="time" value={time} disabled={pending} onChange={(e) => setTime(e.target.value)} />
            </label>
            <Button variant="onLabel" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="onLabel" disabled={pending} onClick={() => setMode("view")}>
              Back
            </Button>
          </div>
          <p style={{ margin: "calc(var(--cell) * 0.75) 0 0", fontSize: 13, color: "var(--print-3)" }}>
            In {firstName}&rsquo;s time zone, {timezone}.
          </p>
        </div>
      ) : null}

      {mode === "skip" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 1.5)", marginTop: "calc(var(--cell) * 1.5)" }}>
          <span style={{ fontSize: 14, color: "var(--print)" }}>
            <strong>Skip this call?</strong> It won&rsquo;t ring, and can&rsquo;t be put back.
          </span>
          <Button variant="onLabel" disabled={pending} onClick={skip}>
            {pending ? "Skipping…" : "Skip call"}
          </Button>
          <Button variant="onLabel" disabled={pending} onClick={() => setMode("view")}>
            Back
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 14, color: "var(--danger-deep)" }}>
          {error}
        </p>
      ) : null}
    </li>
  );
}
