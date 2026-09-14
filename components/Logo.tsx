/**
 * The mark.
 *
 * A ring with a pulse beating across it. The ring is the follow-up loop the
 * product is named for; the beat inside it is the patient still answering.
 *
 * The ring and the flatline take `currentColor`, so the mark's structure
 * belongs to the chrome around it. The beat is amber — the product's carrying
 * colour — because it is the one part of the mark that is alive, and a mark
 * with no colour at all disappeared into the masthead.
 *
 * No red: red in this product means danger, and nothing that is not dangerous
 * gets to borrow it. No cross either — a red cross on white is the protected
 * Red Cross emblem, and the cross read as generic medical clip-art regardless.
 *
 * The animation is a bright point riding the beat: it runs the trace once and
 * comes to rest lit on the spike. It is an overlay — the base pulse is complete
 * and legible throughout, so with motion stripped (the reduced-motion block)
 * the mark loses nothing.
 *
 * Authored SVG, one stroke weight, no icon library, no image asset.
 */

/** Flatline, beat, flatline — held inside the ring (r 9.5 spans x 2.5–21.5 at y 12). */
const PULSE = "M 6 12 H 9.4 L 10.6 9 L 12.4 15.6 L 13.6 12 H 18";

export function Logo({
  size = 26,
  title = "AfterVisit",
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

      {/* The loop — structural, so it takes the ink of the chrome around it. */}
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />

      {/*
        A bright point that travels the loop once per cycle and parks at the
        top. The ring is the follow-up week; the point advancing it is the week
        advancing. Path travel, not in-place motion, so the Advance Rule holds.
      */}
      <circle
        className="logo-orbit"
        cx="12"
        cy="12"
        r="9.5"
        pathLength={100}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="16 84"
        strokeDashoffset="34"
        opacity="0.55"
      />

      {/*
        The pulse, in amber — the product's carrying colour, and the one live
        thing in the mark. A stroke, never a fill: the One Amber Rule governs
        amber-filled actions, and this is not an action.
      */}
      <path
        d={PULSE}
        pathLength={100}
        stroke="var(--amber)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/*
        The writing-point: the same trace again, dashed to a short bright
        segment, run along the line by the keyframes and parked on the spike —
        the beat that just fired on a monitor.
      */}
      <path
        className="logo-sweep"
        d={PULSE}
        pathLength={100}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="26 74"
        strokeDashoffset="56"
      />
    </svg>
  );
}
