/**
 * The console — an `Operate` surface.
 *
 * Same world as the landing page, inverted: out here the visitor is working,
 * not being persuaded, so the label stock fills the viewport and the bench
 * survives only as chrome. The dial state is stated in the top bar on every
 * page, because a console that can phone people should never make you guess
 * whether it currently can.
 */

import { readConfig } from "@/lib/config";
import { TopBar } from "@/components/ui";

export default function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const config = readConfig();

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar
        live={config.liveCallsEnabled}
        armed={config.callAllowlist.length}
      />

      {/* The console runs on fixtures. Say so rather than implying a database. */}
      <div
        style={{
          background: "var(--amber)",
          color: "var(--print)",
          borderBottom: "1px solid var(--amber-deep)",
        }}
      >
        {/*
          An honesty statement is a sentence, not a field label. It gets set as
          one — tracked caps at 11px is where this kind of notice goes to die.
        */}
        <p
          style={{
            maxWidth: "var(--maxw)",
            margin: "0 auto",
            padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 3)",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          <strong>Demo data.</strong> The database and scheduler are not built
          yet, so nothing on these pages is live and no call can be placed from
          here.
        </p>
      </div>

      <main style={{ flex: 1, background: "var(--bench)" }}>{children}</main>
    </div>
  );
}
