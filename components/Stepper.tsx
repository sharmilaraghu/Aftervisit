"use client";

/**
 * Where you are in writing a follow-up, as a track rather than five buttons.
 *
 * It was five bordered chips carrying the full step names, which needed about
 * 1,100px and so wrapped onto a second row at any ordinary window — four chips
 * and then a lonely fifth, which reads as a layout fault rather than a
 * sequence. Sitting under a floating "All patients" chip and beside the rail,
 * it made three separate navigation systems on one screen.
 *
 * So: short labels, one row that cannot wrap, and the state carried by the
 * track itself. A finished step is green because it is finished — the palette
 * has had `--clear` in it the whole time and the console never reached for it.
 */

import Link from "next/link";

export const WIZARD_STEPS = [
  "The patient and the note",
  "What to escalate on",
  "The schedule",
  "The questions",
  "Review and approve",
] as const;

/** What the track prints. The panel heading carries the full sentence. */
const SHORT = ["Patient", "Escalate on", "Schedule", "Questions", "Review"] as const;

export function Stepper({
  current,
  reached,
  planId,
  onGo,
}: {
  current: number;
  /** The highest step that can be opened right now. */
  reached: number;
  /** Present once the draft exists, which is what makes 4 and 5 addressable. */
  planId?: string;
  onGo?: (step: number) => void;
}) {
  return (
    <ol className="stepper" aria-label="Progress">
      {SHORT.map((label, i) => {
        const n = i + 1;
        /*
           Done means behind you, not merely reachable. `reached` says what may
           be opened — on step 1 of the form that is already 3, because all
           three panes are mounted — so keying "done" off it ticked two steps
           the doctor had not filled in yet.
        */
        const state = n === current ? "current" : n < current ? "done" : "ahead";
        const reachable = n <= reached;

        const body = (
          <>
            <span className="stepper-mark" aria-hidden>
              {state === "done" ? "✓" : n}
            </span>
            <span className="stepper-name">{label}</span>
          </>
        );

        const common = { className: "stepper-step", "data-state": state } as const;

        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined}>
            {reachable && state !== "current" && onGo && n <= 3 ? (
              <button type="button" onClick={() => onGo(n)} {...common}>
                {body}
              </button>
            ) : reachable && state !== "current" && planId ? (
              <Link href={`/plan/new?plan=${planId}&step=${n}`} {...common}>
                {body}
              </Link>
            ) : (
              <span {...common}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
