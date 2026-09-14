"use client";

/**
 * The hero — the claim, the door, the pipeline, and the artifact.
 *
 * It is a client component for one reason: pulling the tab performs stages 01
 * and 02 of the pipeline listed beside it, and the list says so. That is the
 * page's only state, and it is the motion worth having — a mark that acts out
 * the product beats a mark that merely moves.
 */

import { useCallback, useState } from "react";

import { CompileSheet } from "@/components/CompileSheet";
import { Badge } from "@/components/ui";

/*
 * The four stages the agent owns. Numbered because the order is the
 * information: this is a pipeline, and each stage's output is the next one's
 * input. `done` marks the stages the compile pull actually performs.
 */
const STAGES = [
  {
    title: "Read the note",
    body: "A free-text note becomes a goal and what to find out, each tied to your own words, on a dated schedule.",
    done: true,
  },
  {
    title: "Save and start",
    body: "One button. The calls are on the calendar, and four escalation rules can never be removed — by you or the model.",
    done: true,
  },
  {
    title: "It runs the week",
    body: "The agent dials around the patient's day, speaks their language, and retries the calls nobody answers.",
    done: false,
  },
  {
    /*
     * This said "a pure rule engine escalates — no model required", which was
     * the architecture before triage and is now the opposite of the truth: a
     * model reads the transcript and decides, and four pure rules stand under
     * it as a floor. The floor is the claim worth making — it is what makes
     * "an outage cannot silence a patient who asked for a person" checkable.
     */
    title: "Drift gets caught",
    body: "A model reads the transcript and decides. Four pure rules stand under it, so an outage still cannot silence a patient who asked for a person.",
    done: false,
  },
];

export function Hero() {
  const [compiled, setCompiled] = useState(false);
  /* Stable identity, so CompileSheet's effect does not re-fire every render. */
  const onOpenChange = useCallback((open: boolean) => setCompiled(open), []);

  return (
    <div
      className="hero-grid"
      style={{
        flex: 1,
        width: "100%",
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3)",
        display: "grid",
        gap: "calc(var(--cell) * 4) calc(var(--cell) * 5)",
        /* Items sit at the top of their row; the sheet re-centres itself over
           the two it spans. Centring everything put the left column's slack in
           the middle, as a hole between the lede and the pipeline. */
        alignItems: "start",
      }}
    >
      {/* ------------------------------------------------------------- intro */}
      <div className="hero-intro">
        <h1
          className="display"
          style={{
            fontSize: "clamp(40px, 5.2vw, 68px)",
            margin: "0 0 calc(var(--cell) * 2.5)",
            color: "var(--bench-ink)",
          }}
        >
          Every patient followed up. Without the recall list.
        </h1>

        <p
          className="measure"
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: "var(--bench-ink-2)",
            margin: "0 0 calc(var(--cell) * 3)",
          }}
        >
          Write the note you already write and press save. Care Loop reads what
          you want to know, and it phones your patient for as long as you said
          — escalating the ones who need you, and catching the one who quietly
          stops answering.
        </p>

      </div>

      {/*
        The pipeline. Its own grid area rather than a tail on the intro, so a
        phone can put the artifact *above* it: stacked, a visitor otherwise met
        four paragraphs of explanation before reaching the thing being
        explained, ~1000px down, and most never got there.
      */}
      <div className="hero-stages">
        <ol
          className="stage-row"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
          }}
        >
          {STAGES.map((stage, i) => {
            /* The pull performs the first two stages. Saying so turns a
               generic how-it-works list into a live state display. */
            const performed = compiled && stage.done;
            return (
              <li
                key={stage.title}
                style={{
                  borderTop: `1px solid ${
                    performed ? "var(--clear)" : "var(--bench-line-strong)"
                  }`,
                  paddingTop: "calc(var(--cell) * 1.25)",
                  transition: "border-color 240ms ease-out",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--cell)",
                    marginBottom: "calc(var(--cell) * 0.5)",
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: performed ? "var(--clear)" : "var(--bench-ink-3)",
                      transition: "color 240ms ease-out",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="caps" style={{ margin: 0, color: "var(--bench-ink)" }}>
                    {stage.title}
                  </h2>
                  {performed && (
                    <Badge
                      tone="clear"
                      quiet
                      style={{ animation: "strip-in 420ms cubic-bezier(0.16,1,0.3,1) both" }}
                    >
                      Done
                    </Badge>
                  )}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--bench-ink-2)",
                  }}
                >
                  {stage.body}
                </p>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ------------------------------------------------------------- sheet */}
      <div
        className="hero-sheet"
        style={{ display: "flex", flexDirection: "column", gap: "calc(var(--cell) * 1.5)" }}
      >
        {/* The product, running. Not a screenshot of it. */}
        <CompileSheet onOpenChange={onOpenChange} />

        {/*
          The tab is the page's whole argument and nothing else announced it.
          The line stays at both states rather than disappearing, so the height
          is stable and the way back out is as visible as the way in.
        */}
        <p
          aria-live="polite"
          style={{
            margin: 0,
            display: "flex",
            alignItems: "baseline",
            gap: "calc(var(--cell) * 1.5)",
            fontSize: 15,
            lineHeight: 1.5,
            color: "var(--bench-ink-2)",
          }}
        >
          <span className="caps" style={{ color: "var(--amber)" }}>
            Try it
          </span>
          {compiled
            ? "Pull the tab back to see the doctor's original note."
            : "Pull the amber tab to turn this note into a follow-up."}
        </p>
      </div>
    </div>
  );
}
