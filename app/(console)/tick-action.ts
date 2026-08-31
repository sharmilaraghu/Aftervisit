"use server";

/**
 * The console's own way to run the scheduler.
 *
 * Separate from `POST /api/tick` on purpose. That endpoint is a public URL on a
 * deployment with no auth, so it is guarded by a shared secret — and a browser
 * cannot hold that secret. A Server Action is same-origin and carries Next's
 * own CSRF protection, so the console needs no token to ask for a tick.
 *
 * Same `tick()` underneath. Three triggers, one function.
 */

import { readConfig } from "@/lib/config";
import { hasDatabase } from "@/lib/db/client";
import { tick } from "@/lib/schedule/tick";

export interface TickSummary {
  claimed: number;
  dialed: number;
  finished: number;
  escalated: number;
  skipped?: boolean;
}

export async function runTickAction(): Promise<TickSummary> {
  const idle: TickSummary = { claimed: 0, dialed: 0, finished: 0, escalated: 0, skipped: true };

  if (!hasDatabase()) return idle;
  // Nothing can be dialled without a key, so there is nothing for a tick to do.
  if (!readConfig().liveCallsEnabled) return idle;

  try {
    // No `waitMs`: dial and return. Finishing the call is the reconciler's job
    // on a later poll, once CALL-E reports a terminal state.
    const result = await tick("poller", { limit: 2 });
    return {
      claimed: result.claimed,
      dialed: result.dialed,
      finished: result.finished,
      escalated: result.escalated,
      skipped: result.skipped,
    };
  } catch {
    // A failed poll is not worth surfacing; `tick_runs.error` holds anything
    // that matters and the next poll is seconds away.
    return idle;
  }
}
