"use client";

/**
 * Where you are in the five steps, and the way back to any of them.
 *
 * A stepper that only reports position is a decoration. This one navigates:
 * steps 1 to 3 are panes of one form and switch in place, 4 and 5 are routes
 * because by then the draft is a row. `onGo` is how the client wizard hands
 * over its in-place switch; without it the completed steps are links.
 *
 * Steps ahead of you are never reachable. On steps 1 to 3 that is because the
 * form has not been submitted, and on 4 and 5 because there is nothing to show
 * until it has.
 */

import Link from "next/link";

export const WIZARD_STEPS = [
  "The patient and the note",
  "What to escalate on",
  "The schedule",
  "The questions",
  "Review and approve",
] as const;

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
    <ol
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "calc(var(--cell) * 0.5)",
        listStyle: "none",
        margin: "0 0 calc(var(--cell) * 2)",
        padding: 0,
      }}
    >
      {WIZARD_STEPS.map((label, i) => {
        const n = i + 1;
        const state = n === current ? "current" : n <= reached ? "done" : "ahead";

        const body = (
          <span
            className="caps"
            style={{
              display: "block",
              padding: "calc(var(--cell) * 1) calc(var(--cell) * 1.5)",
              background:
                state === "current" ? "var(--print)" : state === "done" ? "var(--label-2)" : "transparent",
              color:
                state === "current"
                  ? "var(--label)"
                  : state === "done"
                    ? "var(--print)"
                    : "var(--print-3)",
              boxShadow: state === "ahead" ? "inset 0 0 0 1px var(--rule-2)" : undefined,
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            <span className="mono">{n}</span> {label}
          </span>
        );

        if (state === "ahead" || state === "current") {
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined}>
              {body}
            </li>
          );
        }

        /* `onGo` only owns the three form panes. A reachable step behind a
           route is a link even when the form is what is on screen. */

        /* A completed step within the form switches panes; one behind a route
           navigates. Same control, and the difference is not the doctor's to
           care about. */
        return (
          <li key={label}>
            {onGo && n <= 3 ? (
              <button
                type="button"
                onClick={() => onGo(n)}
                style={{ all: "unset", cursor: "pointer" }}
              >
                {body}
              </button>
            ) : planId ? (
              <Link href={`/plan/new?plan=${planId}&step=${n}`} style={{ textDecoration: "none" }}>
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
