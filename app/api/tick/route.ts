/**
 * The scheduler's door for a real cron.
 *
 * One of three honest triggers, all calling the same `tick()`. Guarded by a
 * shared secret because it is a public URL on a deployment with no auth: the
 * allowlist stops a stranger reaching an arbitrary number, but there is no
 * reason to let them drive the scheduler either.
 *
 * Returns the counters so a cron log says what actually happened, rather than
 * just 200.
 */

import { readConfig } from "@/lib/config";
import { tick } from "@/lib/schedule/tick";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { tickToken } = readConfig();

  // No token configured means the door is shut, not open. Failing closed is the
  // same stance the dial allowlist takes.
  if (!tickToken) {
    return Response.json(
      { error: "AFTER_VISIT_TICK_TOKEN is not set. The tick endpoint is closed." },
      { status: 503 },
    );
  }

  if (request.headers.get("x-after-visit-tick") !== tickToken) {
    return Response.json({ error: "Bad or missing x-after-visit-tick header." }, { status: 401 });
  }

  const result = await tick("cron");
  return Response.json(result, { status: result.error ? 500 : 200 });
}

export async function GET() {
  return Response.json(
    { error: "POST with an x-after-visit-tick header. GET does not run the scheduler." },
    { status: 405 },
  );
}
