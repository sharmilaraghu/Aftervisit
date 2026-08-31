/**
 * Running the scheduler from a page load.
 *
 * One of the three honest triggers. It is bounded on purpose: a page render
 * must not block on eight minutes of phone calls, so this claims at most one
 * call and lets the next visit — or the cron, or the poller — take the rest.
 *
 * The alternative that was rejected: a self-perpetuating `after()` +
 * `setTimeout` chain. It looks like a background worker, dies silently with the
 * process, and reads as a lie the moment someone asks what is running it.
 * Three visible triggers calling one function is the honest version.
 */

import { readConfig } from "@/lib/config";
import { hasDatabase } from "@/lib/db/client";
import { tick, type TickResult } from "@/lib/schedule/tick";

/**
 * Run one bounded pass, and never throw into a page render.
 *
 * A scheduler failure must not blank the console — a clinician still needs to
 * see the roster. Failures land in `tick_runs.error` where they can be read.
 */
export async function runTickOnPageLoad(): Promise<TickResult | null> {
  if (!hasDatabase()) return null;

  // Nothing can be dialled without a key, so there is no point holding the
  // render open to find that out.
  if (!readConfig().liveCallsEnabled) return null;

  try {
    /*
     * Bounded and non-blocking. With `waitMs` unset the tick reconciles whatever
     * CALL-E has already finished, closes elapsed plans, dials at most one due
     * call, and returns — it never waits for a call to complete.
     */
    return await tick("page", { limit: 1 });
  } catch {
    return null;
  }
}
