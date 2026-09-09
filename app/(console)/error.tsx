"use client";

/**
 * When a console page cannot load.
 *
 * There was no boundary at all: every page is `force-dynamic` with no Suspense,
 * so a database that stopped answering — seven queries in one `Promise.all` on
 * the overview — put a clinician on Next's default error screen. That screen
 * tells them nothing, and on a deployed instance it is the first thing a
 * stranger sees.
 *
 * It names what is likely wrong and offers the one useful action. It does not
 * print the stack: this console appears in a published video and on a public
 * URL, and a stack trace is the sort of thing that carries a connection string.
 */

import { Button } from "@/components/ui";

export default function ConsoleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "calc(var(--cell) * 10) calc(var(--cell) * 3)",
      }}
    >
      <h1
        className="display"
        style={{
          fontSize: "clamp(28px, 3.6vw, 44px)",
          margin: "0 0 calc(var(--cell) * 2)",
          color: "var(--bench-ink)",
        }}
      >
        This page could not load.
      </h1>
      <p
        className="measure"
        style={{ margin: "0 0 calc(var(--cell) * 4)", color: "var(--bench-ink-2)" }}
      >
        Care Loop reads everything on this screen from the database on every
        request, so the usual cause is that the database did not answer. Nothing
        has been changed, and the scheduler is unaffected — no call was placed
        or missed because of this.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="ghost" href="/patients">
          Back to the patients
        </Button>
      </div>
    </div>
  );
}
