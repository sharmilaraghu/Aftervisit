/**
 * Today — who needs a call back, in the order they need it.
 *
 * One question, one list. The rendering lives in `TodayList`; this page reads
 * the rows and frames them. It carried the whole row markup once, and the row
 * has an opened state, which is the sort of thing a server component cannot
 * hold and should not be shaped around.
 *
 * Every patient appears, not every escalation. A patient nobody has managed to
 * reach has no escalation to their name, and losing them is the exact failure
 * this product exists to catch.
 */

import { Button, Panel } from "@/components/ui";
import { TickPoller } from "@/components/TickPoller";
import { TodayList } from "@/components/TodayList";
import { readConfig } from "@/lib/config";
import { getToday } from "@/lib/db/dashboard";
import { formatStamp } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const rows = await getToday();

  /*
   * The practice's zone, taken from the patients it actually follows. There is
   * no practice record to read one from, and hardcoding London was wrong for
   * every deployment that is not in London — including this one.
   */
  const practiceZone = rows[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const waiting = rows.filter((r) => r.escalationId !== null).length;
  const hour = new Date().getHours();
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
              ? "No patients yet."
              : waiting > 0
                ? `${waiting} ${waiting === 1 ? "patient needs" : "patients need"} a call back.`
                : "Nothing is waiting on you."}
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
            {/* The practice's own clock. A console that prints London time to a
                clinic in Chennai is telling them the wrong hour on every page. */}
            {formatStamp(new Date(), practiceZone)}
          </span>
          <TickPoller enabled={readConfig().liveCallsEnabled} />
          <Button variant="primary" href="/plan/new">
            Add a patient
          </Button>
        </span>
      </header>

      {rows.length === 0 ? (
        <Panel title="Nobody yet">
          <p style={{ margin: 0, padding: "calc(var(--cell) * 3)", color: "var(--print-2)" }}>
            Add a patient to write their note and approve a follow-up plan.
          </p>
        </Panel>
      ) : (
        <TodayList rows={rows} />
      )}
    </div>
  );
}
