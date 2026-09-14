"use client";

/**
 * The console's rail.
 *
 * A dispensing sleeve is indexed by tabs down its edge, so the console is too.
 * The current section is marked with a filled ink block and a heavier label,
 * not a colour change — amber here would spend the view's one amber on chrome.
 *
 * **Collapsing.** The usual collapse-to-icons is unavailable here on purpose:
 * this world has no icon set, and inventing three glyphs to save 184px would
 * cost more than it saves. Collapsed, the rail becomes what it already claims
 * to be — a column of edge tabs, labels set vertically with `writing-mode`,
 * which is the same device the compile tab uses. Nothing is hidden behind a
 * tooltip and every section keeps its name.
 *
 * The choice is remembered per browser. It never syncs anywhere: which width a
 * clinician wants their nav is a fact about their screen, not about them.
 *
 * Marking the current page is not decoration: without `aria-current` neither a
 * sighted nor a screen-reader user can tell which section they are in.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Badge } from "@/components/ui";
import { Logo } from "@/components/Logo";

/**
 * The sections, grouped by who uses them.
 *
 * There are no logins, so the roles are made obvious the only way left: the
 * rail says who each section is for. Clinic staff register patients and book
 * their visits; the doctor sees the day's consultations and how every patient
 * on a follow-up is doing. Each screen serves one of them — the receptionist
 * never writes a note and the doctor never registers anyone.
 *
 * Unnumbered. The tabs were numbered once, and a console that numbers its
 * sections reads as a wizard telling a clinician how to do their job.
 *
 * `also` claims the routes a section owns without being named after them:
 * `/register` is still Patients, and a plan or a call is still a follow-up.
 */
const GROUPS = [
  {
    role: "Clinic staff",
    items: [{ label: "Patients", href: "/patients", also: ["/register"] }],
  },
  {
    role: "Doctor",
    items: [
      { label: "Consultations", href: "/consult", also: [] },
      { label: "Follow-ups", href: "/dashboard", also: ["/plans", "/calls", "/followups"] },
    ],
  },
  {
    /* One call on your own phone, behind a passcode. Named for who it is for, like the others. */
    role: "Judges",
    items: [{ label: "Try a call", href: "/try", also: [] }],
  },
] as const;

const STORAGE_KEY = "careloop.rail.collapsed";

/*
 * The rail's width is browser state, not React state, so it is read as an
 * external store rather than copied into `useState` from an effect.
 *
 * The copy was the obvious way to write it and it is wrong twice: setState in
 * an effect body causes the cascading render React now lints against, and two
 * open tabs would disagree until one was reloaded. Subscribing to `storage`
 * fixes both — a collapse in one tab moves the rail in the other.
 *
 * The server snapshot is `false` because the server has no localStorage, and
 * hydrating against anything else would flicker the rail to the other width on
 * every page load.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* Private mode, or storage disabled. Expanded is the safe default. */
    return false;
  }
}

export function SideNav({
  escalations,
  practiceName,
  clinicianName,
}: {
  escalations: number;
  practiceName: string;
  clinicianName: string;
}) {
  const pathname = usePathname() ?? "";
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const toggle = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1");
    } catch {
      /* The preference is a convenience; losing it must not break the nav. */
    }
    /* `storage` does not fire in the tab that wrote it, so this tab is told
       directly. Other tabs hear it from the event. */
    for (const listener of listeners) listener();
  };

  return (
    <nav
      aria-label="Console"
      className="rail"
      data-collapsed={collapsed ? "true" : undefined}
    >
      {/*
        Brand and control on one line. The toggle used to sit at the foot of the
        rail, which put the only way to reclaim 176px of screen below every
        section, past the practice block, in the corner a dev overlay covers.
        An affordance nobody finds is the same as one that does not exist.
      */}
      <div className="rail-head">
        <Link href="/consult" className="rail-brand">
          <Logo size={26} title={null} />
          <span className="rail-label">AfterVisit</span>
        </Link>

        <button
          type="button"
          className="rail-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand the navigation" : "Collapse the navigation"}
        >
          <span aria-hidden className="rail-chevron" />
        </button>
      </div>

      {/* One captioned list per role. No inline `display` on the lists: it
          overrode the stylesheet's phone layout and stacked the sections
          vertically, a quarter of every phone screen spent on navigation. */}
      <div className="rail-groups">
        {GROUPS.map(({ role, items }) => (
          <div key={role} className="rail-group">
            <p className="rail-group-label" id={`rail-${role.replace(/\s+/g, "-").toLowerCase()}`}>
              {role}
            </p>
            <ul
              style={{ listStyle: "none", margin: 0, padding: 0 }}
              aria-labelledby={`rail-${role.replace(/\s+/g, "-").toLowerCase()}`}
            >
              {items.map(({ label, href, also }) => {
                // `/patients/pat_x/edit` is still the Patients section.
                const current = [href, ...also].some(
                  (p) => pathname === p || pathname.startsWith(`${p}/`),
                );
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className="rail-link"
                      aria-current={current ? "page" : undefined}
                      data-current={current ? "true" : undefined}
                    >
                      <span className="rail-tab">{label}</span>
                      {href === "/dashboard" && escalations > 0 ? (
                        <span className="rail-count">
                          <Badge tone="danger">{escalations}</Badge>
                          {/* Or a screen reader hears "Follow-ups, 3" and no more. */}
                          <span className="sr-only"> waiting on a clinician</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* The practice and the clinician, at the foot of the rail. */}
      <div className="rail-foot">
        {/*
          The quiet ink clears 4.5:1 on `bench`, but the rail is the lighter
          `bench-2` ground, where it drops to 4.33:1 — so these two captions
          take the secondary ink instead.
        */}
        <p className="caps" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Practice
        </p>
        <p style={{ margin: "2px 0 calc(var(--cell) * 1.5)", color: "var(--bench-ink)", fontSize: 14 }}>
          {practiceName}
        </p>
        {/* Not "Signed in": there is no auth, and a caption that says there is
            implies a session someone could end. */}
        <p className="caps" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          Clinician
        </p>
        <p style={{ margin: "2px 0 0", color: "var(--bench-ink)", fontSize: 14 }}>{clinicianName}</p>
      </div>

    </nav>
  );
}
