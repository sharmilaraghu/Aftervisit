/**
 * Follow-ups — how each patient on a plan is doing, in the order to look.
 *
 * The doctor's view: condition, not logistics. The rendering lives in
 * `TodayList`; this page reads the rows and frames them. It used to carry the
 * agent's next call and a Register button — the first is the agent's
 * business, the second the front desk's, and neither is what a doctor opens
 * this page to learn.
 *
 * `TickPoller` still mounts here: in a browser it is what drives the scheduler.
 */

import { Panel } from "@/components/ui";
import { TickPoller } from "@/components/TickPoller";
import { TodayList } from "@/components/TodayList";
import { readConfig } from "@/lib/config";
import { getToday } from "@/lib/db/dashboard";
import { formatStamp } from "@/lib/format";
import { PRACTICE_TIMEZONE } from "@/lib/patients/timezones";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const { rows, clearedToday } = await getToday();
  const attention = rows.filter((r) => r.status === "needs_attention").length;

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: PRACTICE_TIMEZONE }).format(
      new Date(),
    ),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "calc(var(--cell) * 4) calc(var(--cell) * 4) calc(var(--cell) * 8)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 2)",
          marginBottom: "calc(var(--cell) * 3)",
        }}
      >
        <div>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: "0 0 calc(var(--cell) * 1)",
              color: "var(--bench-ink)",
            }}
          >
            {greeting}, {readConfig().clinicianName}.
          </h1>
          <p style={{ margin: 0, color: "var(--bench-ink-2)" }}>
            {rows.length === 0
              ? "No one is on a follow-up yet."
              : attention > 0
                ? `${attention} ${attention === 1 ? "patient needs" : "patients need"} your attention.`
                : "Nobody needs your attention right now."}
          </p>
        </div>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "calc(var(--cell) * 2)",
            alignItems: "center",
          }}
        >
          <span className="caps mono" style={{ color: "var(--bench-ink-3)" }}>
            {formatStamp(new Date(), PRACTICE_TIMEZONE)}
          </span>
          <TickPoller enabled={readConfig().liveCallsEnabled} />
        </span>
      </header>

      {rows.length === 0 ? (
        <Panel title="Nobody yet">
          <p style={{ margin: 0, padding: "calc(var(--cell) * 3)", color: "var(--print-2)" }}>
            A patient appears here once you approve a plan from their consultation.
          </p>
        </Panel>
      ) : (
        <TodayList rows={rows} clearedToday={clearedToday} />
      )}
    </div>
  );
}
