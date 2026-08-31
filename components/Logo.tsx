/**
 * The mark.
 *
 * Three ideas, layered, and each is the product rather than decoration:
 *
 * **The loop, with direction.** Care Loop is named for a loop that runs until a
 * patient resolves or a clinician takes over. The ring carries a gap — the loop
 * is still open — and an arrowhead, so it reads as a cycle going somewhere
 * rather than a decorative circle. It turns slowly: the agent still working
 * while nobody watches.
 *
 * **The cross.** Square, radius 0, on the same grid as everything else here.
 *
 * **The trace.** A single ECG sweep across the cross, drawing left to right on a
 * loop, the way a monitor writes. This is the pulse — made literal, because a
 * follow-up product's whole subject is whether someone is still doing alright.
 *
 * Deliberately *not* taken from the reference that inspired it: gradients,
 * glass, drop shadows, rounded corners, and a pile of simultaneous metaphors
 * (cross plus stethoscope plus person plus arrows). Each is banned by this
 * design system, and together they are what makes an icon read as stock art. One
 * accent, flat fills, hard corners, two marks — the world this product already
 * lives in.
 *
 * Additive throughout: with every animation stripped the mark is a complete,
 * legible cross and trace inside an open ring, which is what a reduced-motion
 * reader gets.
 *
 * Authored SVG, one stroke weight, no icon library, no image asset.
 */

const R = 10.25;
const CIRCUMFERENCE = 2 * Math.PI * R; // 64.40

/** 50° of the ring left open, so the arrowhead has somewhere to point into. */
const GAP = CIRCUMFERENCE * 0.14;

/**
 * The ECG trace: flat, a small deflection, the tall spike, the deep trough,
 * flat again. Drawn wider than the cross so it crosses the whole mark.
 */
const TRACE = "3.8,12 8,12 9,10.4 10.2,12 11.2,6.6 12.6,16.6 13.6,12 15.6,12 20.2,12";

/** Path length of TRACE, measured once so the draw animation can be exact. */
const TRACE_LENGTH = 34;

export function Logo({
  size = 26,
  title = "Care Loop",
}: {
  size?: number;
  /** Null inside a link that already names the product, so it is not read twice. */
  title?: string | null;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flexShrink: 0 }}
    >
      {title ? <title>{title}</title> : null}

      {/* The loop: an open ring and the arrowhead that gives it direction. */}
      <g className="logo-loop">
        <circle
          cx="12"
          cy="12"
          r={R}
          stroke="var(--amber)"
          strokeWidth="1.6"
          strokeDasharray={`${CIRCUMFERENCE - GAP} ${GAP}`}
        />
        {/*
          Sits at the leading end of the arc, pointing the way the loop travels.
          Inside the rotating group, so it stays welded to the arc it belongs to.
        */}
        <polygon points="20.6,6.2 18.2,5.5 19.6,3.3" fill="var(--amber)" />
      </g>

      {/* The cross. Two bars, square, radius 0 like everything in this world. */}
      <g fill="currentColor">
        <rect x="10.3" y="5.9" width="3.4" height="12.2" />
        <rect x="5.9" y="10.3" width="12.2" height="3.4" />
      </g>

      {/*
        The trace, over the cross. Amber against the ink so it reads as the live
        thing on top of the clinical thing — the same relationship the reference
        got right, without borrowing anything else from it.
      */}
      <polyline
        className="logo-trace"
        points={TRACE}
        stroke="var(--amber)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${TRACE_LENGTH} ${TRACE_LENGTH}`}
      />
    </svg>
  );
}
