"use client";

/**
 * The compile pull — the page's one authored moment.
 *
 * A doctor's note is flat text. Pulling the perforated tab restructures it in
 * place into what the product actually claims: seven dated, countable rows,
 * with the defaults stamped and marked, and the three rules that can never be
 * removed stuck on as strips. It is reversible, because the product's claim is
 * that the doctor stays the author.
 *
 * Motion is the thermal printer: rows arrive by feeding DOWN from above,
 * staggered, never by fading in place.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./ui";

const NOTE = `Asha K, 54. Started metformin 500mg BD today for new T2DM. Worried about side effects.

Follow up daily for a week — GI upset, whether she's actually taking it, any dizziness.

If she's vomiting or can't keep fluids down I want to know the same day. She's at work until 5 most days.

BP 138/86 today. Repeat U&Es and HbA1c in three months. Went through the sick-day rules with her.`;

/* Approved 16 Aug, so the window is the seven calendar days that follow. */
const DATES = ["17 Aug", "18 Aug", "19 Aug", "20 Aug", "21 Aug", "22 Aug", "23 Aug"];

/*
 * The answer set matters as much as the question. It is the visible evidence
 * that answers come back as typed slots rather than a summary, so it never gets
 * compressed away.
 */
const QUESTIONS = [
  { q: "Are you taking the metformin as prescribed?", a: "yes · no · partly" },
  { q: "Any stomach upset since we last spoke?", a: "none · mild · moderate · severe" },
  { q: "Any dizziness?", a: "yes · no" },
];

const LOCKED = [
  "patient_requests_clinician",
  "unmappable_response",
  "emergency_language",
];

const PULL_DISTANCE = 150;

export function CompileSheet({
  onOpenChange,
}: {
  /** Lets the page mark the pipeline stages this pull just performed. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [pulled, setPulled] = useState(false);
  /*
   * The invitation runs until the first touch and never returns. Nothing else
   * on the page says this sheet is live, and the page's whole argument is
   * behind the pull — but a control that keeps waving after you have used it
   * is nagging, not inviting.
   */
  const [touched, setTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);
  /* A real drag ends in pointerup; the click that follows it must not re-toggle. */
  const swallowClick = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startX.current = e.clientX;
    setDragging(true);
    setTouched(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (startX.current === null) return;
      const dx = e.clientX - startX.current;
      const raw = pulled ? 1 + dx / PULL_DISTANCE : dx / PULL_DISTANCE;
      setDrag(Math.max(0, Math.min(1, raw)));
    },
    [pulled],
  );

  const onPointerUp = useCallback(() => {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    if (drag !== 0) {
      swallowClick.current = true;
      setPulled(drag > 0.5);
      setDrag(0);
    }
    // It never moved, so it was a click. Let the click handler toggle it.
  }, [drag]);

  const onClick = useCallback(() => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    setPulled((v) => !v);
  }, []);

  const progress = dragging ? drag : pulled ? 1 : 0;
  const open = progress > 0.5;

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  return (
    <div style={{ display: "flex", alignItems: "stretch", maxWidth: 560, width: "100%" }}>
      <div
        className="sheet"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "calc(var(--cell) * 3)",
          /*
             No minimum height. Matching the note state to the compiled state's
             592px was tried and is worse: it buys a jump-free pull at the cost
             of ~250px of blank stock, and empty white reads far louder than
             the bench margin it replaces. The note is now long enough to fill
             a sheet honestly, and the pull expands it — an expansion the
             reader caused, which is the one kind that needs no apology.
          */
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--cell)",
            borderBottom: "1px solid var(--rule-ink)",
            paddingBottom: "calc(var(--cell) * 1.25)",
            marginBottom: "calc(var(--cell) * 2)",
          }}
        >
          <span className="caps" style={{ color: "var(--print)" }}>
            {open ? "Follow-up plan · awaiting approval" : "Consultation note"}
          </span>
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {open ? "PLAN-0041" : "16 Aug"}
          </span>
        </div>

        {!open && (
          <div
            key="note"
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              animation: "feed 380ms cubic-bezier(0.16, 1, 0.3, 1) both",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: 13,
                lineHeight: 1.8,
                color: "var(--print-2)",
                whiteSpace: "pre-line",
              }}
            >
              {NOTE}
            </p>

            {/* A note is signed. The sign-off keeps the sheet's foot from
                reading as blank stock while the plan state is this tall. */}
            <div
              style={{
                marginTop: "auto",
                paddingTop: "calc(var(--cell) * 1.5)",
                borderTop: "1px solid var(--rule)",
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--cell)",
              }}
            >
              <span className="caps" style={{ color: "var(--print-3)" }}>
                Signed · Dr Rao
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
                Bridgeview Family Practice
              </span>
            </div>
          </div>
        )}

        {open && (
          <div key="plan" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {/* What the note said, compiled — and what code filled in for it. */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "calc(var(--cell) * 0.75)",
                marginBottom: "calc(var(--cell) * 2)",
                animation: "feed 340ms cubic-bezier(0.16, 1, 0.3, 1) both",
              }}
            >
              <span className="mono" style={{ fontSize: 13, color: "var(--print)" }}>
                Daily · 7 days · 17:30 Asia/Kolkata
              </span>
              <Badge tone="info" quiet>
                Time defaulted
              </Badge>
            </div>

            {/* The claim, made literal: seven dated rows. */}
            <ol
              style={{
                listStyle: "none",
                margin: "0 0 calc(var(--cell) * 2)",
                padding: 0,
                borderTop: "1px solid var(--rule)",
              }}
            >
              {DATES.map((date, i) => (
                <li
                  key={date}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto auto",
                    alignItems: "center",
                    gap: "calc(var(--cell) * 1.5)",
                    padding: "calc(var(--cell) * 0.6) 0",
                    borderBottom: "1px solid var(--rule-2)",
                    animation: "feed 340ms cubic-bezier(0.16, 1, 0.3, 1) both",
                    animationDelay: `${60 + i * 45}ms`,
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="mono" style={{ fontSize: 13, color: "var(--print)" }}>
                    {date}
                  </span>
                  <span className="mono" style={{ fontSize: 13, color: "var(--print-2)" }}>
                    17:30
                  </span>
                  <span className="caps" style={{ color: "var(--print-3)" }}>
                    Scheduled
                  </span>
                </li>
              ))}
            </ol>

            <ol
              style={{
                listStyle: "none",
                margin: "0 0 calc(var(--cell) * 2)",
                padding: 0,
              }}
            >
              {QUESTIONS.map((item, i) => (
                <li
                  key={item.q}
                  style={{
                    display: "flex",
                    gap: "calc(var(--cell) * 1.5)",
                    padding: "calc(var(--cell) * 0.5) 0",
                    fontSize: 13,
                    color: "var(--print-2)",
                    animation: "feed 340ms cubic-bezier(0.16, 1, 0.3, 1) both",
                    animationDelay: `${400 + i * 45}ms`,
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
                    Q{i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {item.q}
                    <span
                      className="mono"
                      style={{ display: "block", fontSize: 11, color: "var(--print-3)" }}
                    >
                      {item.a}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 0.75)",
                alignItems: "center",
                marginBottom: "calc(var(--cell) * 2)",
                animation: "strip-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both",
                animationDelay: "540ms",
              }}
            >
              <span className="caps" style={{ color: "var(--print-3)" }}>
                Cannot be removed
              </span>
              {LOCKED.map((rule) => (
                <Badge key={rule} tone="plain">
                  {rule}
                </Badge>
              ))}
            </div>

            {/* Every dispensing label carries one. */}
            <div
              className="barcode"
              aria-hidden
              style={{ marginTop: "auto", opacity: 0.85 }}
            />
          </div>
        )}
      </div>

      {/* The perforated tab. Drag it, click it, or focus it and press Enter. */}
      <button
        type="button"
        className={touched ? "pull-tab" : "pull-tab tab-invite"}
        onFocus={() => setTouched(true)}
        aria-pressed={open}
        aria-label={
          open ? "Pull back to the consultation note" : "Pull to compile the note into a plan"
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        style={{
          flex: "0 0 auto",
          width: "calc(var(--cell) * 7)",
          border: "none",
          borderRadius: "0 var(--radius-tab) var(--radius-tab) 0",
          /*
             Amber. Label stock was tried and is the reason nobody found this:
             a grey tab on a white sheet reads as part of the sheet, and the
             page's entire argument is behind it. Amber is this product's
             action colour, and a pull tab is the one piece of material on the
             page you are meant to grab.
             Print ink was tried too and fails twice over: 1.6:1 against the
             bench, and `.perf` punches its holes in the bench colour, so on
             ink they read at 1.15:1 as smudges rather than light through paper.
          */
          background: open ? "var(--amber-deep)" : "var(--amber)",
          color: open ? "var(--label)" : "var(--print)",
          boxShadow: "var(--lift)",
          cursor: "grab",
          touchAction: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `translateX(${progress * 6}px)`,
          transition: dragging
            ? "none"
            : "transform 260ms cubic-bezier(0.16,1,0.3,1), background 200ms ease-out",
        }}
      >
        <span
          className="caps perf"
          style={{
            writingMode: "vertical-rl",
            letterSpacing: "0.24em",
            paddingLeft: "calc(var(--cell) * 2)",
            backgroundPosition: "left top",
            backgroundSize: "calc(var(--cell) * 1.5) calc(var(--cell) * 1.5)",
          }}
        >
          {open ? "Pull back" : "Pull to compile"}
        </span>
      </button>
    </div>
  );
}
