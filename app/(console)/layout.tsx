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

  /*
   * The honesty line, and it has to keep pace with the build. Saying "the
   * scheduler is not built" after it was built is the same failure as claiming
   * it works before it did — so the sentence is derived from configuration
   * rather than typed as a fact that goes stale.
   */
  /*
   * Derived, never typed as a fact. An earlier version asserted "seeded demo
   * data, every patient here is fictional" — which became false the moment a
   * real patient was added, and a stale honesty notice is worse than none.
   * What this says now is only what configuration can prove.
   */
  const notice = config.liveCallsEnabled
    ? config.allowlistOpen
      ? "Prototype — not for real patient data. The dial allowlist is OPEN: any number on an approved plan can be called, without anyone pressing a button."
      : config.callAllowlist.length > 0
      ? `Prototype — not for real patient data. The scheduler is armed: ${config.callAllowlist.length} number${config.callAllowlist.length === 1 ? "" : "s"} can be dialled without anyone pressing a button.`
      : "Prototype — not for real patient data. The scheduler is running, but the dial allowlist is empty, so every call will be refused with a visible reason."
    : "Prototype — not for real patient data. No CALL-E key is set, so nothing can be dialled from here.";

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar
        live={config.liveCallsEnabled}
        armed={config.callAllowlist.length}
      />

      <div
        style={{
          /*
            The quiet variant, not the filled one. This notice is inert — it
            says the same thing on every page and never changes while you work —
            and a full-amber band across the whole console would spend the one
            amber every view is allowed on chrome rather than on the action.
          */
          background: "var(--amber-wash)",
          color: "var(--print)",
          borderBottom: "1px solid var(--amber)",
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
          {notice}
        </p>
      </div>

      <main style={{ flex: 1, background: "var(--bench)" }}>{children}</main>
    </div>
  );
}
