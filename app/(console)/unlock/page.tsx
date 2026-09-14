/**
 * The one door onto a deployment that can ring a real phone.
 *
 * proxy.ts sends every locked console request here. The page says why it is
 * locked — this console schedules real calls — and takes the passcode in a form
 * that belongs to the product, rather than the browser's own dialog, which could
 * say nothing and looked like an error.
 */

import { Button, Field, Notice, Panel, TextInput } from "@/components/ui";
import { readConfig } from "@/lib/config";

import { consoleUnlocked, lockConsole, unlockConsole } from "./actions";

export const dynamic = "force-dynamic";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ wrong?: string; next?: string }>;
}) {
  const { wrong, next } = await searchParams;
  const configured = Boolean(process.env.AFTER_VISIT_CONSOLE_PASSCODE);
  const unlocked = await consoleUnlocked();
  const { liveCallsEnabled, allowlistOpen } = readConfig();

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "calc(var(--cell) * 8) calc(var(--cell) * 3) calc(var(--cell) * 10)" }}>
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <h1 className="display" style={{ fontSize: "clamp(28px, 3.2vw, 40px)", margin: "0 0 calc(var(--cell) * 1)", color: "var(--bench-ink)" }}>
          {unlocked ? "The console is open" : "Unlock the console"}
        </h1>
        <p style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 15, lineHeight: 1.5 }}>
          {liveCallsEnabled && allowlistOpen
            ? "This instance places real calls, so the console sits behind a passcode."
            : "This instance cannot place calls, but the console still sits behind a passcode."}
        </p>
      </header>

      <Panel title={unlocked ? "This browser" : "Passcode"}>
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {!configured ? (
            <p style={{ margin: 0, color: "var(--print-2)", fontSize: 15, lineHeight: 1.5 }}>
              No <span className="mono">AFTER_VISIT_CONSOLE_PASSCODE</span> is set, so the console is open to
              whoever can reach it. That is fine on a laptop with calls locked; a public deployment with the
              allowlist open must set one.
            </p>
          ) : unlocked ? (
            <form action={lockConsole}>
              <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 15, lineHeight: 1.5 }}>
                This browser holds the console. Lock it when you are done, especially on a shared machine.
              </p>
              <Button variant="onLabel" type="submit">
                Lock this browser
              </Button>
            </form>
          ) : (
            <form action={unlockConsole}>
              <input type="hidden" name="next" value={next ?? ""} />
              {wrong ? (
                <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
                  <Notice tone="danger" label="Not unlocked">
                    That passcode did not match.
                  </Notice>
                </div>
              ) : null}
              <Field label="Username" htmlFor="unlock-user" hint="Any name. There are no accounts in this build; it only says who is at the desk.">
                <TextInput id="unlock-user" name="username" autoComplete="username" placeholder="judge" />
              </Field>
              <Field label="Passcode" htmlFor="unlock-pass" hint="From the testing instructions in the submission. It is the same passcode as Try a call.">
                <TextInput id="unlock-pass" name="password" type="password" autoComplete="current-password" required autoFocus mono />
              </Field>
              <Button type="submit">Unlock</Button>
            </form>
          )}
        </div>
      </Panel>
    </div>
  );
}
