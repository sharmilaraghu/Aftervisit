/**
 * Said out loud when the scheduler has stopped and calls are waiting.
 *
 * Care Loop dials on a tick, and a tick only happens because something asks for
 * one — a cron, an open console tab, an approval. When whatever was asking goes
 * away, calls stop being placed and every screen looks exactly like a quiet day.
 * That is the failure this product exists to catch, aimed at itself.
 *
 * Deliberately not a permanent "last run" readout. An infrastructure heartbeat
 * on a clinical screen was tried once and removed as noise, and that was right:
 * a doctor does not need to know the scheduler is healthy, only that it is not.
 * So this appears when both halves are true — calls are due, and nothing has
 * run — and is silent the rest of the time.
 */

import { Badge } from "@/components/ui";

/** Three missed runs of a five-minute cron. One slow tick stays quiet. */
const STALE_AFTER_MINUTES = 15;

export function SchedulerWarning({
  overdueCalls,
  minutesSinceTick,
  liveCallsEnabled,
}: {
  overdueCalls: number;
  /** Measured in the data layer — a clock read during render is impure. */
  minutesSinceTick: number | null;
  /** No CALL-E key means nothing could be dialled anyway; silence is honest. */
  liveCallsEnabled: boolean;
}) {
  if (!liveCallsEnabled || overdueCalls === 0) return null;

  const minutes = minutesSinceTick;
  if (minutes !== null && minutes < STALE_AFTER_MINUTES) return null;

  const since =
    minutes === null
      ? "The scheduler has never run."
      : minutes < 120
        ? `Nothing has run the scheduler for ${minutes} minutes.`
        : `Nothing has run the scheduler for ${Math.floor(minutes / 60)} hours.`;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "calc(var(--cell) * 1.5)",
        padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 4)",
        background: "var(--danger-wash)",
        borderBottom: "1px solid var(--danger)",
        color: "var(--print)",
      }}
    >
      <Badge tone="danger">Not calling</Badge>
      <span style={{ fontSize: 14, lineHeight: 1.5 }}>
        {/* The fact first, then the number, then where to look. A doctor reads
            the first clause; whoever runs the deployment reads the rest. */}
        <strong>
          {overdueCalls} {overdueCalls === 1 ? "call is" : "calls are"} due and{" "}
          {overdueCalls === 1 ? "has" : "have"} not been placed.
        </strong>{" "}
        {since} Calls are dialled by a cron against <span className="mono">/api/tick</span>,
        or by this console with a tab open. See DEPLOYMENT.md.
      </span>
    </div>
  );
}
