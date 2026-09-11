# Running the scheduler

Care Loop schedules a call the moment a plan is approved, and dials it when a **tick**
runs. Those are two different jobs, and only the second one needs anything from you.

`approvePlan()` expands the plan into dated `scheduled_calls` rows immediately. Nothing
about that needs configuring. But a row sitting in the table is not a call: a tick has to
claim it and dial it, and a tick only happens because something asks for one.

## The three triggers

| Trigger | How | Unattended? |
|---|---|---|
| The console | `TickPoller` on `/dashboard`, every 15s | No — needs a tab open |
| Approval | `approvePlanAction` runs one bounded tick | No — only at that moment |
| **A cron** | `POST /api/tick` or `GET /api/cron/tick` | **Yes. This is the one that matters** |

Without a cron, calls are placed only while somebody has the console open. That is fine
for a demo and wrong for a deployment.

## The 90-minute rule

`MAX_CALL_DELAY_MINUTES = 90`. A call more than 90 minutes late is **retired, not dialled**
— deliberately, so an instance that was down overnight cannot wake up and phone someone at
03:00.

**This single number decides how often your cron must run.** Any gap longer than 90 minutes
means due calls are silently skipped. Five minutes gives a wide margin.

---

## Local, before you deploy

The point is to prove calls dial with **no browser tab open**.

1. Set `CARELOOP_TICK_TOKEN` in `.env` (`openssl rand -hex 32`).
2. `./start.sh --ticker`

That starts a loop POSTing `/api/tick` every 10 seconds. The banner should read
*Scheduler poll loop: every 10s* — if it says *"--ticker needs CARELOOP_TICK_TOKEN.
Skipping the poll loop"*, the variable is not set. Next reads `.env` at boot, so restart
after changing it.

Then approve a plan whose first call is a minute or two out, **close every browser tab**,
and watch the dev log. `POST /api/tick 200` every 10 seconds, and the call placed without
the console open.

**Testing the scheduler without spending call budget:**

- **Leave `CALLE_API_KEY` unset.** Ticks still claim rows and refuse the dial with
  `missing_api_key` on the record. Proves the timing, the claim and the 90-minute window;
  nothing rings.
- **For the rest of the loop** — transcript, extraction, triage, severity — use the fake
  CALL-E server, which injects a fake port into `tick()` so no code path can reach the
  network even with a key set.

Rehearsing a whole week: set `Clock` to *a clinical day per minute* on wizard step 3. With a
10-second ticker the days and the retry ladder run in minutes. **A 5-minute production cron
cannot serve that** — the demo clock and a real deployment are different modes.

---

## Vercel

### Hobby

**Hobby runs crons at most once a day**, and Vercel *fails the deployment* on a sub-daily
expression rather than quietly downgrading it — `*/5 * * * *` returns *"Hobby accounts are
limited to daily cron jobs."* So `vercel.json` declares `0 9 * * *`, which deploys on every
plan. Hobby timing is also only accurate to the hour (±59 min), so that tick lands
somewhere between 09:00 and 09:59.

One daily tick is a safety net, not a scheduler: with a 90-minute tolerance nearly every
call would still be retired as `too_late`.

The scheduler on Hobby is an external cron, hitting the same door `--ticker` uses:

```
POST https://<your-host>/api/tick
Header: x-careloop-tick: <CARELOOP_TICK_TOKEN>
Every 5 minutes
```

**cron-job.org** (free) is the reliable option:

1. Create a job, URL `https://<your-host>/api/tick`
2. Method **POST**
3. Add a header — key `x-careloop-tick`, value your `CARELOOP_TICK_TOKEN`
4. Schedule: every 5 minutes
5. Save, then **Test run** — a healthy tick returns `200` with the counters as JSON.
   `503` means `CARELOOP_TICK_TOKEN` is unset on the deployment; `401` means the header
   value does not match it.

**GitHub Actions** is wired as a fallback in `.github/workflows/tick.yml`. Set two
repository secrets — `CARELOOP_TICK_URL` and `CARELOOP_TICK_TOKEN` — and it runs every five
minutes. Its scheduler is best-effort and drifts several minutes under load, which is
harmless here since the tolerance is 90 minutes; it also stops after 60 days with no push
to the default branch, which is why it is the fallback and not the primary.

Whichever you use, **one is enough**. Two crons ticking at once are safe — every claim is a
single conditional `UPDATE … RETURNING`, so a call is dispatched once — but the second one
buys nothing.

### Pro

Change the schedule in `vercel.json` back to `*/5 * * * *`, set `CRON_SECRET` in the Vercel
dashboard, and Vercel injects it as `Authorization: Bearer …` automatically. Nothing else
to do, and no external cron is needed.

## Environment

| Variable | Needed for | If unset |
|---|---|---|
| `CARELOOP_TICK_TOKEN` | `POST /api/tick` — the external cron **and** `--ticker` | Endpoint returns 503 |
| `CRON_SECRET` | `GET /api/cron/tick` — Vercel's own cron | Endpoint returns 503 |
| `CARELOOP_PUBLIC_URL` | Handing CALL-E a `webhookUrl` | No callback; results wait for the next tick |
| `CARELOOP_WEBHOOK_TOKEN` | The webhook receiver, and the URL above | Receiver returns 503 |
| `CARELOOP_CALL_ALLOWLIST` | **Set it in production** | There is no auth: anyone who can load the console can cause a dial |
| `CALLE_API_KEY` | Dialling at all | Every dial refused `missing_api_key` |
| `OPENAI_API_KEY` | The note compiler and call triage | Compiling refused; every finished call escalated unjudged |

`CARELOOP_PUBLIC_URL` and `CARELOOP_WEBHOOK_TOKEN` are a pair — both, or no webhook is sent
at all. With them, a finished call lands in seconds; without them the reconciler picks it up
on the next tick. The reconciler is the guarantee, the webhook is the latency.

## Verifying a deployment

```bash
curl -sS -X POST https://<host>/api/tick -H "x-careloop-tick: $CARELOOP_TICK_TOKEN"
```

Expect a JSON body of counters. `401` means the token does not match; `503` means it is not
set on the server.

Then approve a plan with a call due now and confirm it dials with no console open.

## "It is past the call time and nothing happened"

Two rows answer it. First, is the call actually due and unclaimed:

```sql
select occurrence, attempt, status, scheduled_for,
       scheduled_for <= now() as due_now, calle_call_id, refusal_reason
from scheduled_calls
where plan_id = '<plan id>'
order by occurrence, attempt;
```

Then, has anything run the scheduler:

```sql
select trigger, started_at, finished_at, claimed, dialed, refused, error
from tick_runs order by started_at desc limit 5;
```

- **Due call + old last tick** → nothing is dispatching. Start a cron, or open the console.
- **`status = 'skipped'`, `skip_reason = 'too_late'`** → the 90-minute window closed. The
  cron is too slow or was down.
- **`refusal_reason`** set → the dial was refused on purpose. `no_consent` is the usual one,
  and it is the gate working.
- **Plan not `active`** → a paused or completed plan dials nothing, by design.

The console warns about the first of these by itself: when calls are due and nothing has
ticked for 15 minutes, a strip appears saying so. It stays silent otherwise, so it means
something when it shows.
