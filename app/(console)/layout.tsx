/**
 * The console — an `Operate` surface.
 *
 * Same world as the landing page, inverted: out here the visitor is working,
 * not being persuaded, so the label stock fills the viewport and the bench
 * survives as the rail.
 *
 * The rail is the sleeve's edge tabs. It replaced a top-bar nav because the
 * console grew a third section and horizontal tabs stop scaling there — and
 * because a rail can carry a live count against the section it belongs to.
 *
 * There is no standing status strip above the work. It carried a permanent
 * "Calls live" badge, which is the third piece of chrome this console has now
 * shed for the same reason: it said the same thing on every page, so it stopped
 * being read. Whether a call will actually be placed is stated where it changes
 * a decision — on the approval screen, beside the button that causes it.
 */

import { SideNav } from "@/components/SideNav";
import { getDashboardStats } from "@/lib/db/calls";
import { readConfig } from "@/lib/config";
import { SchedulerWarning } from "@/components/SchedulerWarning";

export default async function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const stats = await getDashboardStats();
  const { practiceName, clinicianName, liveCallsEnabled } = readConfig();

  return (
    <div className="console-shell">
      <SideNav
        escalations={stats.openEscalations}
        practiceName={practiceName}
        clinicianName={clinicianName}
        lockable={Boolean(process.env.AFTER_VISIT_CONSOLE_PASSCODE)}
      />

      <main style={{ minWidth: 0 }}>
        <SchedulerWarning
          overdueCalls={stats.overdueCalls}
          minutesSinceTick={stats.minutesSinceTick}
          liveCallsEnabled={liveCallsEnabled}
        />
        {children}
      </main>
    </div>
  );
}
