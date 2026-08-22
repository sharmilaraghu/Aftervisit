"use client";

/**
 * Advances its children like paper coming out of a thermal printer, once, when
 * the block first reaches the viewport.
 *
 * The rows are visible by default and the animation is only ever *added* — a
 * page whose content depends on an observer firing is a page that ships blank
 * when the observer does not.
 */

import { useEffect, useRef } from "react";

export function FeedIn({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.fed = "true";
            io.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <tbody ref={ref} className="feed-rows">
      {children}
    </tbody>
  );
}
