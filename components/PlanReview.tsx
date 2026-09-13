"use client";

/**
 * The two interactive parts of the review screen.
 *
 * Approve is one button and it is the only amber-filled element on the page —
 * there is exactly one primary action here, and it is the one that makes the
 * agent start phoning someone.
 */

import { useEffect, useRef, useState, useTransition } from "react";

import { Button, Field, Panel, Select, TextInput } from "@/components/ui";
import {
  approvePlanAction,
  updateDraftAction,
  updateTimeScaleAction,
} from "@/app/(console)/plans/actions";
import { TIME_SCALE_OPTIONS } from "@/lib/patients/plan-form";

export function PlanDraftControls({
  planId,
  durationDays,
  localTime,
  cadence,
  maxAttempts,
  startOpen = false,
  marks,
}: {
  planId: string;
  durationDays: number;
  localTime: string;
  cadence: string;
  maxAttempts: number;
  /**
   * Where each value came from, shown under its own field. Passed on a draft,
   * where the form *is* the schedule: the read-only values used to sit directly
   * above an open form holding the same numbers, so the page said everything
   * twice. With marks, the form is always open and there is nothing to toggle.
   */
  marks?: Partial<Record<"durationDays" | "localTime" | "cadence" | "maxAttempts", React.ReactNode>>;
  /**
   * Open on arrival when the note gave no schedule. The values shown are
   * placeholders, and a closed drawer under them made approving a guess the
   * path of least resistance.
   */
  startOpen?: boolean;
}) {
  const inline = marks !== undefined;
  const [open, setOpen] = useState(startOpen || inline);
  const action = updateDraftAction.bind(null, planId);

  if (!open) {
    return (
      <p style={{ margin: "calc(var(--cell) * 3) 0 0", display: "flex" }}>
        {/*
          The drawer edits the days, the local time and the demo clock — so
          calling it "the cadence" hid the time behind a word that does not mean
          it, and a doctor looking for "when does this ring?" read the button as
          being about something else entirely. Name the three things.
        */}
        <Button variant="onLabel" onClick={() => setOpen(true)}>
          Change the schedule
        </Button>
      </p>
    );
  }

  return (
    <form
      id="schedule"
      action={action}
      style={
        inline
          ? { marginBottom: "calc(var(--cell) * 2)" }
          : {
              marginTop: "calc(var(--cell) * 3)",
              paddingTop: "calc(var(--cell) * 3)",
              borderTop: "1px solid var(--rule)",
            }
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 3)" }}>
        <div style={{ minWidth: 144 }}>
          <Field label="Days" htmlFor="durationDays" hint={marks?.durationDays}>
            <TextInput
              id="durationDays"
              name="durationDays"
              mono
              inputMode="numeric"
              defaultValue={String(durationDays)}
            />
          </Field>
        </div>
        <div style={{ minWidth: 144 }}>
          <Field label="Best time to call" htmlFor="localTime" hint={marks?.localTime}>
            <TextInput id="localTime" name="localTime" mono defaultValue={localTime} />
          </Field>
        </div>
        <div style={{ minWidth: 200 }}>
          {/* Every value on the panel above carries a provenance mark. Cadence
              and attempts carried one while having no control anywhere in the
              product, which made the mark a claim the interface could not keep. */}
          <Field label="How often" htmlFor="cadence" hint={marks?.cadence}>
            <Select
              id="cadence"
              name="cadence"
              defaultValue={cadence}
              options={[
                { value: "daily", label: "Every day" },
                { value: "every_other_day", label: "Every other day" },
                { value: "weekly", label: "Once a week" },
              ]}
            />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="Attempts a day" htmlFor="maxAttempts" hint={marks?.maxAttempts}>
            <Select
              id="maxAttempts"
              name="maxAttempts"
              defaultValue={String(maxAttempts)}
              options={[1, 2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: n === 1 ? "1 — no retry" : `${n}`,
              }))}
            />
          </Field>
        </div>
      </div>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}
      >
        <Button type="submit" variant="onLabel">
          {inline ? "Save the schedule" : "Save"}
        </Button>
        {inline ? (
          <Button type="reset" variant="onLabel">
            Undo changes
          </Button>
        ) : (
          <Button variant="onLabel" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
        {/* Its own line on a phone, not a crushed column beside the buttons. */}
        <span style={{ color: "var(--print-3)", fontSize: 13, flex: "1 1 calc(var(--cell) * 30)" }}>
          Values you change, and placeholders you confirm, are marked as yours.
          What the note said stays marked as the note&rsquo;s.
        </span>
      </div>
    </form>
  );
}

/**
 * The demo clock — demo scaffolding, kept apart from the clinical schedule.
 *
 * Folded, because a doctor approving a real follow-up has no use for it; it is
 * there so a three-minute demo can show a week of calls.
 */
export function DemoClock({ planId, timeScale }: { planId: string; timeScale: number }) {
  const action = updateTimeScaleAction.bind(null, planId);
  return (
    /* Bench ink on the graphite ground: the sheet's greys measured 3.0:1 here.
       The form itself sits on a sheet, where its own greys are legible. */
    <details
      className="disclosure"
      style={{ marginTop: "calc(var(--cell) * 3)", color: "var(--bench-ink-2)", fontSize: 14 }}
    >
      <summary style={{ color: "var(--bench-ink-2)" }}>Demo clock — for demos, not clinical use</summary>
      <form
        action={action}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 1.5)",
          marginTop: "calc(var(--cell) * 1.5)",
          padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5) 0",
          background: "var(--label)",
        }}
      >
        <div style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 420 }}>
          <Field
            label="Calendar speed"
            htmlFor="timeScale"
            hint="Not a clinical setting. It only compresses the calendar; the calls themselves are identical."
          >
            <Select
              id="timeScale"
              name="timeScale"
              defaultValue={String(timeScale)}
              options={TIME_SCALE_OPTIONS}
            />
          </Field>
        </div>
        <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <Button type="submit" variant="onLabel">
            Set
          </Button>
        </div>
      </form>
    </details>
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
  patientId,
  corrections,
  canApprove,
  refusedQuestions,
  patientName,
  maskedPhone,
  firstCallAt,
  timezone,
  calls,
  maxAttempts,
  consent,
  language,
  willRing,
  blockedReason,
  unsetSchedule = [],
}: {
  planId: string;
  /** Where a successful approval lands: the patient's file, and the calendar. */
  patientId: string;
  /** The details drawer, rendered where the details are actually restated. */
  corrections?: React.ReactNode;
  canApprove: boolean;
  /**
   * Questions the guard refused. Any at all and the plan cannot dial — the
   * script assembler refuses to build a task while one is outstanding — so
   * approving would produce a follow-up that silently never runs.
   */
  refusedQuestions: number;
  patientName: string;
  maskedPhone: string;
  firstCallAt: string;
  timezone: string;
  calls: number;
  maxAttempts: number;
  consent: string;
  /** The language's name, e.g. "Hindi". What the agent will speak. */
  language: string;
  /** True when approving will genuinely cause this phone to ring. */
  willRing: boolean;
  /** Why it will not, in one sentence. Null when it will. */
  blockedReason: string | null;
  /**
   * Schedule fields still on a placeholder, in words ("what time"). While any
   * remain, approving would authorise calls at a time nobody chose.
   */
  unsetSchedule?: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * Whether the real authorisation panel is on screen.
   *
   * The commit band below mirrors this button, and two amber buttons in one
   * viewport would break the One Amber Rule — so exactly one of them is ever
   * rendered. `rootMargin` trims the band's own height off the bottom of the
   * root, or the two would swap places while the panel is still underneath it.
   */
  /* What stands between the doctor and approving, if anything. The band below
     follows the page in every case — held with its reason, or live. */
  const blocked = !canApprove || refusedQuestions > 0;
  const mode = blocked ? "blocked" : unsetSchedule.length > 0 ? "unset" : "ready";

  const panel = useRef<HTMLDivElement | null>(null);
  const [panelSeen, setPanelSeen] = useState(true);
  useEffect(() => {
    const node = panel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setPanelSeen(entry.isIntersecting),
      /* Deeper than the band is tall at its tallest (stacked, ~124px), so the
         two never overlap: the band leaves only once the panel is clear of
         where it was sitting. */
      { rootMargin: "0px 0px -128px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
    /* Re-observe when the panel swaps: saving the schedule turns the held
       notice into the authorisation panel, a different node. */
  }, [mode]);

  const approve = () =>
    startTransition(async () => {
      const result = await approvePlanAction(planId, patientId);
      // Approval can be refused — a window whose every call would land in the
      // past, for one. Surfacing that here is the whole point: it used to
      // redirect and look exactly like success.
      setRefusal(result.ok ? null : (result.reason ?? "That plan could not be approved."));
      // The refusal prints inside the panel, where the facts it disputes are.
      // If the click came from the band, the panel is off screen, so go to it
      // rather than leaving an error nobody is looking at.
      if (!result.ok) panel.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });

  /*
   * One definition, rendered in the panel or in the band — never both. The
   * label states the actual outcome: promising "start the follow-up" beside a
   * notice saying nothing will ring is the interface contradicting itself at
   * the moment of commitment.
   */
  const approveButton = (
    <Button variant="primary" disabled={pending || calls === 0} onClick={approve}>
      {/* The label carries the when; the panel around it names who and on
          which number. At the moment of commitment the button states the
          outcome, not just the verb. */}
      {pending
        ? "Approving…"
        : willRing
          ? `Approve · first call ${firstCallAt}`
          : "Approve · nothing will ring yet"}
    </Button>
  );

  /*
   * The page used to print "a plan with a refused question does not dial at
   * all — rewrite each one or remove it before you approve", and then leave the
   * approve button live two thousand pixels below it. A doctor could do the
   * exact opposite of an explicit instruction in one click and believe a
   * follow-up had started. The blocker now sits on the button it blocks.
   *
   * And it follows the page. A held plan used to show its reason only at the
   * foot, 2000px down, so a doctor reading the questions had no approve in
   * sight at all. The band now carries the held button and the reason, and on
   * a placeholder schedule a jump straight to the fields.
   */
  const held = (notice: React.ReactNode) => (
    <>
      <div ref={panel}>{notice}</div>
      {panelSeen ? null : (
        <div className="commit-band">
          <div className="commit-band-inner">
            <p className="commit-band-note">
              {mode === "unset"
                ? "Set the call time before approving — the note doesn’t say."
                : "Rewrite or remove the refused questions before approving."}
            </p>
            {mode === "unset" ? (
              <Button variant="ghost" href="#schedule">
                Set the schedule
              </Button>
            ) : null}
            {/* Outlined, not a dimmed amber: a disabled amber measured 2.4:1
                and still read as the page's action. */}
            <Button variant="ghost" disabled>
              Approve
            </Button>
          </div>
        </div>
      )}
    </>
  );

  /*
   * A placeholder schedule is not a decision.
   *
   * The banner above said "set them before approving" while this button stayed
   * live on the placeholder — and edits typed into the schedule drawer but not
   * saved were silently lost on approve. The one irreversible act in the
   * product was contradicting its own instruction. Blue, not red: nobody is at
   * risk, the doctor just has not chosen yet. Saving the schedule clears it.
   */
  if (!blocked && unsetSchedule.length > 0) {
    const words =
      unsetSchedule.length === 1
        ? unsetSchedule[0]
        : `${unsetSchedule.slice(0, -1).join(", ")} and ${unsetSchedule[unsetSchedule.length - 1]}`;
    return held(
      <p
        role="status"
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 2)",
          background: "var(--info-wash)",
          boxShadow: "inset 0 0 0 1px var(--info)",
          color: "var(--print)",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        <strong>Set {words} to call before approving.</strong> Save the schedule and this
        becomes the approve button.
      </p>
    );
  }

  if (blocked) {
    return held(
      <p
        role="alert"
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 2)",
          background: "var(--danger-wash)",
          boxShadow: "inset 0 0 0 1px var(--danger)",
          color: "var(--print)",
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        {!canApprove ? (
          <>
            <strong>Nothing here passed the clinical guard.</strong> There is
            nothing safe to ask, so this plan cannot be approved.
          </>
        ) : (
          <>
            <strong>
              {refusedQuestions === 1
                ? "One question was refused by the clinical guard."
                : `${refusedQuestions} questions were refused by the clinical guard.`}
            </strong>{" "}
            A plan carrying a refused question never dials, so approving it would
            start a follow-up that silently does nothing. Rewrite or remove{" "}
            {refusedQuestions === 1 ? "it" : "them"} above, then approve.
          </>
        )}
      </p>
    );
  }

  return (
    <>
      <div ref={panel}>
        <Panel title="The authorisation">
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print)", fontSize: 17, lineHeight: 1.5 }}>
              Care Loop will call <strong>{patientName}</strong> on{" "}
              <span className="mono">{maskedPhone}</span>.
            </p>

            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--cell) * 22), 1fr))",
                gap: "calc(var(--cell) * 3) calc(var(--cell) * 4)",
                margin: "0 0 calc(var(--cell) * 3)",
              }}
            >
              {/*
                The second value is the text; the third says whether a clinician
                will compare it to another instance of itself. A time and a count
                will be; a consent state and a language name will not.

                Four columns rather than a wrapping row: the row put LANGUAGE alone
                on a second line with 654px of empty stock beside it, on the one
                screen the product calls the moment of commitment.
              */}
              {([
                ["First call", calls === 0 ? "nothing scheduled" : `${firstCallAt} · ${timezone}`, true],
                [
                  "Authorises",
                  calls === 0
                    ? "no calls — see below"
                    : `${calls} ${calls === 1 ? "call" : "calls"}, up to ${maxAttempts} attempts each`,
                  true,
                ],
                ["Consent", consent, false],
                ["Language", language, false],
              ] as [string, string, boolean][]).map(([label, value, mono]) => (
                <div key={String(label)}>
                  <dt className="caps" style={{ color: "var(--print-3)", marginBottom: 2 }}>
                    {label}
                  </dt>
                  {/* Mono is for what a clinician compares by eye — a time, a
                      count. "Already agreed" and "English (US)" are language, and
                      setting them in a number face was the rule applied backwards. */}
                  <dd
                    className={mono ? "mono" : undefined}
                    style={{ margin: 0, fontSize: 14, color: "var(--print)" }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              The one place any of this can be wrong and it still matters.

              These six facts used to be printed twice — once in a panel at the top
              of the page and again here — so the page said the same thing in two
              places four screens apart. This is the one that earns it: the moment
              before a machine starts telephoning a person.
            */}
            {corrections}

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
                window lands in the past. Use <em>Change the schedule</em> above to
                set a later time, or a longer window.
              </p>
            ) : null}

            {/*
              Only the case that changes the outcome gets a notice.
              "This number is on the dial allowlist — approving will cause a real
              phone to ring" told a doctor about our deployment configuration and
              then restated what the button already says. The inverse is different:
              it is the difference between an approval that starts a follow-up and
              one that starts nothing, and it must be visible before the click.
            */}
            {willRing ? null : (
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 3)",
                  padding: "calc(var(--cell) * 2)",
                  background: "var(--amber-wash)",
                  boxShadow: "inset 0 0 0 1px var(--amber)",
                  color: "var(--print)",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                <strong>No call will be placed.</strong> {blockedReason} The plan
                will run and every call will be refused with a reason on the record.
              </p>
            )}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 1.5)",
                alignItems: "center",
              }}
            >
              {approveButton}
              {/* Prose, not tracked caps: caps label a value, and this is the only
                  warning attached to the one irreversible act in the product. */}
              <span style={{ alignSelf: "center", color: "var(--print-2)", fontSize: 14 }}>
                {/* What can still change, not a warning. The plan can be
                    cancelled at any point; only calls already placed stay. */}
                You can cancel it later; calls already made stay on the record.
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
      </div>

      {/*
        The commit band.

        The decision this page exists for used to sit at 94% of its depth,
        behind every control for rewording a question or reordering the
        schedule — so the reading order was edit everything, then decide, when
        the deciding is the point. Moving the authorisation above the evidence
        would have been worse: it invites approving a plan nobody read.

        So the band follows instead. It is the console's own closing tone with
        a hairline rule, not a floating card, and it renders only while the
        real panel is off screen — one amber button in view, always.
      */}
      {panelSeen ? null : (
        <div className="commit-band">
          <div className="commit-band-inner">
            {/* Bench ink, not print: this band sits on the graphite ground, and
                the sheet's greys are unreadable there. The warning rides in the
                sentence rather than as a second column, so the narrow layout is
                one caption and one full-width button instead of three fragments
                wrapping into each other. */}
            <p className="commit-band-note">
              Calling <strong style={{ color: "var(--bench-ink)" }}>{patientName}</strong> on{" "}
              <span className="mono">{maskedPhone}</span>. You can cancel it later.
            </p>
            {approveButton}
          </div>
        </div>
      )}
    </>
  );
}
