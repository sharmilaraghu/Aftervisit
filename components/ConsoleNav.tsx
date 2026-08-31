"use client";

/**
 * The console's three sections, with the current one marked.
 *
 * A client component only because it needs the pathname — the rest of the top
 * bar stays a server component. Marking the current page is not decoration: the
 * nav previously rendered all three links byte-identically, with no
 * `aria-current` anywhere, so neither a sighted nor a screen-reader user could
 * tell which section they were in.
 *
 * The mark is a rule under the label, not a colour change. Amber here would
 * spend the view's one amber on chrome.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Two sections, not three. The dashboard was folded into the roster — they
 * answered the same question from the same query.
 */
const NAV = [
  ["Patients", "/patients"],
  ["Queue", "/queue"],
] as const;

export function ConsoleNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav style={{ display: "flex", gap: "calc(var(--cell) * 3)" }}>
      {NAV.map(([label, href]) => {
        // `/patients/pat_x/edit` is still the Patients section.
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className="caps"
            aria-current={current ? "page" : undefined}
            style={{
              color: current ? "var(--bench-ink)" : "var(--bench-ink-2)",
              textDecoration: "none",
              paddingBottom: "calc(var(--cell) * 0.5)",
              borderBottom: current
                ? "2px solid var(--bench-ink)"
                : "2px solid transparent",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
