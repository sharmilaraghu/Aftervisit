"use client";

/**
 * The third honest trigger: the console asks the scheduler to run, after paint.
 *
 * The page renders from the database immediately and this fires afterwards, so
 * a phone call never sits inside a render. That was not a theoretical concern —
 * the dashboard once took sixteen and a half minutes to return because the
 * render awaited a call.
 *
 * Deliberately *not* a self-perpetuating `after()` + `setTimeout` chain on the
 * server. That would look like a background worker, die silently with the
 * process, and read as a lie the moment someone asked what was running it. This
 * runs in a tab a person has open, and stops when they close it — which is
 * exactly what it looks like.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { runTickAction, type TickSummary } from "@/app/(console)/tick-action";

export function TickPoller({
  everyMs = 15_000,
  enabled,
}: {
  everyMs?: number;
  /** False when no CALL-E key is set — there is nothing for a tick to do. */
  enabled: boolean;
}) {
  const router = useRouter();
  const [last, setLast] = useState<TickSummary | null>(null);
  // A tick can outlast its interval. Overlapping requests would just contend
  // for the same lease, so one is skipped rather than queued.
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function runTick() {
      if (running.current) return;
      running.current = true;
      try {
        const result = await runTickAction();
        if (cancelled || result.skipped) return;

        setLast(result);
        // Only refresh when something actually moved. A poll that changed
        // nothing must not re-render the page under the clinician's cursor.
        if (result.dialed || result.finished || result.escalated) router.refresh();
      } catch {
        // A failed poll is not worth telling anyone about; the next one is
        // seconds away and `tick_runs.error` holds anything that matters.
      } finally {
        running.current = false;
      }
    }

    runTick();
    const id = setInterval(runTick, everyMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, everyMs, router]);

  if (!enabled || !last) return null;

  const moved = last.dialed + last.finished + last.escalated;
  if (moved === 0) return null;

  return (
    <p
      role="status"
      className="caps mono"
      style={{ margin: 0, color: "var(--bench-ink-3)", fontSize: 11 }}
    >
      {last.dialed ? `${last.dialed} dialled · ` : ""}
      {last.finished ? `${last.finished} finished · ` : ""}
      {last.escalated ? `${last.escalated} escalated` : ""}
    </p>
  );
}
