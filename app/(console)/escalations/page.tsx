/**
 * The escalation queue.
 *
 * Three things have to be on screen together or an escalation is useless: which
 * rule fired, why that rule exists, and what the patient actually said. The
 * third is why this is a queue and not an alert — a clinician reads evidence
 * and decides; Care Loop routes, it never rules.
 *
 * The overview shows the top of this list. This page is the whole of it, with a
 * filter, for the morning where there are eleven.
 */

import { EscalationCard } from "@/components/EscalationCard";
import { ListFilter } from "@/components/ListFilter";
import { Badge } from "@/components/ui";
import { getQueue, getResolvedQueue, type QueueRow } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * One band of the queue.
 *
 * The list arrives already ranked, but five identical sheets refuse to say so —
 * a clinician had to read all five to rediscover an order the query had
 * established. The split is the one distinction that changes what happens next:
 * a paused plan is not dialling anybody until a person decides.
 */
function QueueBand({
  title,
  blurb,
  tone,
  rows,
}: {
  title: string;
  blurb: string;
  tone: "danger" | "plain";
  rows: QueueRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="queue-group">
      <h2>
        <span className="caps" style={{ color: "var(--bench-ink)" }}>
          {title}
        </span>
        <Badge tone={tone} quiet={tone !== "danger"}>
          {rows.length}
        </Badge>
        <span className="roster-group-blurb">{blurb}</span>
      </h2>
      <div>
        {rows.map((e) => (
          <EscalationCard key={e.id} e={e} />
        ))}
      </div>
    </section>
  );
}

export default async function EscalationsPage() {
  const [queue, resolved] = await Promise.all([getQueue(), getResolvedQueue(10)]);
  /* Filtered, never re-sorted — `getQueue` already orders each band correctly. */
  const pausedRows = queue.filter((e) => e.pausedPlan);
  const runningRows = queue.filter((e) => !e.pausedPlan);
  const paused = pausedRows.length;

  return (
    <div
      style={{
        maxWidth: 944,
        margin: "0 auto",
        padding: "calc(var(--cell) * 4) calc(var(--cell) * 4) calc(var(--cell) * 8)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          {queue.length === 0
            ? "Nothing is waiting."
            : `${queue.length} waiting on a clinician.`}
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          {queue.length === 0
            ? "No rule has fired. Plans are running, and anything Care Loop cannot resolve arrives here."
            : `${paused} of these paused the rest of the patient’s plan. Nothing resumes until a person decides.`}
        </p>
      </header>

      {queue.length > 3 ? (
        <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <ListFilter
            targetId="queue"
            placeholder="Find a patient or rule"
            urgentLabel="paused plans"
            items={queue.map((e) => ({
              id: e.id,
              text: `${e.patientName} ${e.ruleLabel} ${e.ruleId}`,
              urgent: e.pausedPlan,
            }))}
          />
        </div>
      ) : null}

      <div id="queue">
        <QueueBand
          title="Paused the plan"
          blurb="Nothing resumes until you decide."
          tone="danger"
          rows={pausedRows}
        />
        <QueueBand
          title="Raised while the plan kept running"
          blurb="A rule fired; the follow-up is still dialling."
          tone="plain"
          rows={runningRows}
        />
      </div>

      {/*
        What has already been dealt with.

        Acting on a card used to remove it and all its evidence from the console
        permanently, so "what happened with her last week?" had no answer
        anywhere. These are the same rows after the fact, carrying what the
        clinician wrote at the time — and they are shut by default, because this
        is a worklist first and a record second.
      */}
      {resolved.length > 0 ? (
        <details className="roster-group" style={{ marginTop: "calc(var(--cell) * 4)" }}>
          <summary>
            <span className="caps" style={{ color: "var(--bench-ink)" }}>
              Already dealt with
            </span>
            <Badge tone="plain" quiet>
              {resolved.length}
            </Badge>
            <span className="roster-group-blurb">
              The last {resolved.length} you closed, and what you wrote at the time.
            </span>
          </summary>
          <div>
            {resolved.map((e) => (
              <EscalationCard key={e.id} e={e} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
