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
import { approvePlanAction, updateDraftAction } from "@/app/(console)/plans/actions";
import { TIME_SCALE_OPTIONS } from "@/lib/patients/plan-form";

export function PlanDraftControls({
  planId,
  durationDays,
  localTime,
  timeScale,
  cadence,
  maxAttempts,
}: {
  planId: string;
  durationDays: number;
  localTime: string;
  timeScale: number;
  cadence: string;
  maxAttempts: number;
}) {
  const [open, setOpen] = useState(false);
  const action = updateDraftAction.bind(null, planId);

  if (!open) {
    return (
      <p style={{ margin: "calc(var(--cell) * 3) 0 0" }}>
        {/*
          The drawer edits the days, the local time and the demo clock — so
          calling it "the cadence" hid the time behind a word that does not mean
          it, and a doctor looking for "when does this ring?" read the button as
          being about something else entirely. Name the three things.
        */}
        <Button variant="onLabel" onClick={() => setOpen(true)}>
          Change how often, when, and how many tries
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
        <div style={{ minWidth: 144 }}>
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
        <div style={{ minWidth: 144 }}>
          <Field label="Best time to call" htmlFor="localTime">
            <TextInput id="localTime" name="localTime" mono defaultValue={localTime} />
          </Field>
        </div>
        <div style={{ minWidth: 200 }}>
          {/* Every value on the panel above carries a provenance mark. Cadence
              and attempts carried one while having no control anywhere in the
              product, which made the mark a claim the interface could not keep. */}
          <Field label="How often" htmlFor="cadence">
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
          <Field label="Attempts a day" htmlFor="maxAttempts">
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
        <div style={{ minWidth: 280, flex: 1 }}>
          <Field
            label="Demo clock"
            htmlFor="timeScale"
            hint="Demo scaffolding, not a clinical setting. It only compresses the calendar; the calls themselves are identical."
          >
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
  /** BCP 47 tag with its label, e.g. "hi-IN — Hindi". What the agent will speak. */
  language: string;
  /** True when approving will genuinely cause this phone to ring. */
  willRing: boolean;
  /** Why it will not, in one sentence. Null when it will. */
  blockedReason: string | null;
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
  }, []);

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
      {pending
        ? "Approving…"
        : willRing
          ? "Approve — start the follow-up"
          : "Approve — nothing will ring yet"}
    </Button>
  );

  /*
   * The page used to print "a plan with a refused question does not dial at
   * all — rewrite each one or remove it before you approve", and then leave the
   * approve button live two thousand pixels below it. A doctor could do the
   * exact opposite of an explicit instruction in one click and believe a
   * follow-up had started. The blocker now sits on the button it blocks.
   */
  const blocked = !canApprove || refusedQuestions > 0;

  if (blocked) {
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
                window lands in the past — the local time has already gone today.
                Use <em>Change how often, when, and how many tries</em> above to set a later time, or a
                longer window.
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
                This cannot be undone.
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
              <span className="mono">{maskedPhone}</span> — this cannot be undone.
            </p>
            {approveButton}
          </div>
        </div>
      )}
    </>
  );
}
