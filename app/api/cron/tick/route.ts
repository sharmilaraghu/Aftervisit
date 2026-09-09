/**
 * The scheduler's door for a platform cron.
 *
 * `POST /api/tick` is the generic entrance for any scheduler that can set a
 * header. Vercel's cannot: it issues a plain `GET` and authenticates with
 * `Authorization: Bearer $CRON_SECRET`. So rather than teach the POST route to
 * answer GET — putting a mutation behind the one method that is supposed to be
 * safe to retry, prefetch and crawl — this is a second entrance with its own
 * secret, calling the same `tick()`.
 *
 * **Why this route exists at all.** Nothing ran the scheduler on a deployment.
 * `POST /api/tick` had no caller but a shell script on a laptop, and the only
 * other trigger was a 15-second poller that mounts on `/dashboard` and needs a
 * human keeping that tab open. A product whose whole claim is that the agent
 * owns the workflow cannot have its workflow stop when someone closes a
 * browser.
 *
 * **One honest limitation.** Vercel's Hobby plan runs crons at most once a day,
 * which is enough to prove the mechanism and not enough to drive a follow-up
 * schedule. On that plan the poller is still what moves a demo along; a Pro
 * deployment, or any external cron pointed at `POST /api/tick`, gets real
 * minute-level scheduling.
 */

import { readConfig } from "@/lib/config";
import { tick } from "@/lib/schedule/tick";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { cronSecret } = readConfig();

  /* No secret configured means the door is shut, not open — the same stance
     `/api/tick` takes, and for the same reason: this is a public URL. */
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET is not set. The cron endpoint is closed." },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Bad or missing Authorization header." }, { status: 401 });
  }

  const result = await tick("cron");
  return Response.json(result, { status: result.error ? 500 : 200 });
}
