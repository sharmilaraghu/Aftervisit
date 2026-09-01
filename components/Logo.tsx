/**
 * The mark.
 *
 * Two ideas now, where there used to be three — the ring and the pulse became
 * one line:
 *
 * **The pulse ring.** A circle whose stroke flatlines across the top, breaks
 * into a QRS complex — the dip, the tall spike, the trough — and continues
 * round. Drawn in danger red, the one place red means alive rather than alarm
 * (DESIGN.md carves exactly this exception). The loop is the follow-up loop the
 * product is named for, and the heartbeat breaking its line is the patient
 * still answering. No arrowhead: a heartbeat needs no pointer to read as going
 * somewhere.
 *
 * **The cross.** Square, radius 0, on the same grid as everything else here.
 *
 * The animation is a bright writing-point riding the ring: it laps once and
 * comes to rest lit on the beat. It is an overlay — the base ring is complete
 * and static throughout, so with motion stripped (the reduced-motion block)
 * the mark loses nothing.
 *
 * Authored SVG, one stroke weight, no icon library, no image asset.
 */

/**
 * One path: 310° of arc (r 9.5 about 12,12) plus the QRS across the top. The
 * chord at y=3.4 sits below the arc's true crown, so the top visibly flatlines
 * into the beat. `pathLength` normalises to 100 so the sweep's dash arithmetic
 * is exact: the arc is ~77 units, the QRS ~23.
 */
const PULSE_RING =
  "M 16 3.4 A 9.5 9.5 0 1 1 8 3.4 L 10 3.4 L 10.6 4.3 L 11.6 0.9 L 12.8 4.8 L 13.6 3.4 L 16 3.4 Z";

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

      {/* The pulse ring — the base, complete and static. */}
      <path
        d={PULSE_RING}
        pathLength={100}
        stroke="var(--danger)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The cross. Two bars, square, radius 0 like everything in this world. */}
      <g fill="currentColor">
        <rect x="10.3" y="5.9" width="3.4" height="12.2" />
        <rect x="5.9" y="10.3" width="12.2" height="3.4" />
      </g>

      {/*
        The writing-point: the same path again, dashed down to the QRS's 22
        units, swept round by the keyframes and parked on the beat. Bench ink,
        because the mark only ever sits on graphite grounds — it reads as the
        monitor's bright pen on the red line.
      */}
      <path
        className="logo-sweep"
        d={PULSE_RING}
        pathLength={100}
        stroke="var(--bench-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="22 78"
        strokeDashoffset="22"
      />
    </svg>
  );
}
