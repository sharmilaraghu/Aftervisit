/**
 * Try a call — for judges.
 *
 * The fastest honest way to hear Aftervisit: a first name, a number, a language,
 * and if you like a consultation note to follow up on. The real script rings
 * that phone now, and nothing is saved. It sits behind a passcode like the
 * cron door does, because there is no login and this page can reach a phone.
 *
 * Said plainly at the top that this is not the product: the product is a
 * follow-up the assistant owns for days. This is one call of it.
 */

import { InstantCall } from "@/components/InstantCall";
import { Panel } from "@/components/ui";
import { readConfig } from "@/lib/config";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";

export const dynamic = "force-dynamic";

export default function TryPage() {
  const config = readConfig();

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <h1
          className="display"
          style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--bench-ink)" }}
        >
          Try a call.
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)", lineHeight: 1.6 }}>
          Your first name, your number and a language — and, if you like, a consultation note for
          the assistant to follow up on. The real Aftervisit script rings your phone now, and
          nothing is saved.
        </p>
      </header>

      <Panel title="This is one call, not the workflow" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
        <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3)", fontSize: 14, lineHeight: 1.6, color: "var(--print-2)" }}>
          In Aftervisit a doctor writes the note after a consultation and presses <strong>Save and start
          follow-up</strong>. The assistant then owns the follow-up for days: it schedules the calls,
          retries the ones nobody answers, reads every call, and brings the patient back to a doctor
          when something is wrong. This page lets you hear one of those calls on your own phone.
        </p>
      </Panel>

      {!config.liveCallsEnabled ? (
        <Panel title="Calls are off">
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14, color: "var(--print-2)" }}>
            No CALL-E key is set on this instance, so nothing can be dialled.
          </p>
        </Panel>
      ) : !config.tryPasscode ? (
        <Panel title="Locked">
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14, color: "var(--print-2)" }}>
            No passcode is set on this instance (<span className="mono">CARELOOP_TRY_PASSCODE</span>), so
            this page stays shut.
          </p>
        </Panel>
      ) : (
        <InstantCall languages={LANGUAGE_OPTIONS.map(({ value, label }) => ({ value, label }))} practiceName={config.practiceName} />
      )}
    </div>
  );
}
