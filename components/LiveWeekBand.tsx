"use client";

/**
 * A week band that shows the moment a day changes.
 *
 * The scheduler dials on its own and the console polls, so a cell can go from
 * `scheduled` to `answered` while a clinician is looking straight at it — and
 * until now it simply *was* different on the next render. Nothing on the screen
 * said the agent had just done something.
 *
 * This remembers the week it last drew and applies `strip-in` to the cells that
 * actually changed. It is the one piece of motion in the console that carries
 * information rather than decorating: it is the product's central claim,
 * animated exactly when it becomes true.
 *
 * Additive and safe by construction — the band renders complete on first paint,
 * the first render animates nothing (there is no previous week to differ from),
 * and the global reduced-motion block collapses the animation to nothing while
 * leaving every cell in its final state.
 */

import { useEffect, useRef, useState } from "react";

import { WeekBand } from "@/components/ui";

export function LiveWeekBand({ week }: { week: readonly string[] }) {
  const previous = useRef<readonly string[] | null>(null);
  const [changed, setChanged] = useState<number[]>([]);

  useEffect(() => {
    const before = previous.current;
    previous.current = week;
    /* First paint has nothing to compare against, and a page load is not an
       event — animating there would be an entrance, not a signal. */
    if (!before) return;

    const moved = week
      .map((state, i) => (before[i] !== undefined && before[i] !== state ? i : -1))
      .filter((i) => i >= 0);
    if (moved.length === 0) return;

    setChanged(moved);
    const clear = setTimeout(() => setChanged([]), 700);
    return () => clearTimeout(clear);
  }, [week]);

  return <WeekBand week={week} animate={changed} />;
}
