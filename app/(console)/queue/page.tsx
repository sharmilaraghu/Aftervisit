/**
 * The clinician queue.
 *
 * Three things have to be on screen together or the queue is useless: which
 * rule fired, why that rule exists, and what the patient actually said. The
 * third one is the reason this is a queue and not an alert — a clinician is
 * reading evidence, not a verdict.
 */

import { Badge, Button, Panel } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import { ListFilter } from "@/components/ListFilter";
import { getQueue } from "@/lib/db/queries";
import { escalationRef, formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const queue = await getQueue();
  const paused = queue.filter((e) => e.pausedPlan).length;

  return (
    <div
      style={{
        maxWidth: 940,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
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
            ? "No rule has fired. Plans are running, and Care Loop will bring anything it cannot resolve here."
            : `${paused} of these paused the rest of the patient’s plan. Nothing resumes until a person decides — Care Loop routes, it does not rule.`}
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
      {queue.map((e) => (
        /*
          Wrapped rather than passing data-* to Panel: TypeScript does not
          type-check hyphenated JSX attributes, so they would compile fine and
          silently never reach the DOM.
        */
        <div
          key={e.id}
          data-row-id={e.id}
        >
        <Panel
          title={
            <span
              style={{
                display: "inline-flex",
                gap: "calc(var(--cell) * 1.5)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>{e.patientName}</span>
              <span className="mono" style={{ color: "var(--print-3)", letterSpacing: 0 }}>
                {maskPhone(e.phoneE164)}
              </span>
            </span>
          }
          aside={
            <span
              style={{ display: "inline-flex", gap: "calc(var(--cell) * 1)", alignItems: "center" }}
            >
              <span className="caps mono" style={{ color: "var(--print-3)" }}>
                {formatStamp(e.raisedAt, e.timezone)}
              </span>
              {/*
                What earns the danger strip is the plan actually being paused,
                not the escalation merely being urgent. They are usually the
                same, but only one of them is a fact about the patient's plan.
              */}
              {e.pausedPlan ? (
                <Badge tone="danger">Plan paused</Badge>
              ) : (
                <Badge tone="amber">Routine</Badge>
              )}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 1)",
                marginBottom: "calc(var(--cell) * 2.5)",
              }}
            >
              <Badge tone="plain">{e.ruleLabel}</Badge>
              <Badge tone="plain" quiet>
                {e.ruleId}
              </Badge>
              <Badge tone="plain" quiet>
                {escalationRef(e.ref)}
              </Badge>
            </div>

            {e.utterance ? (
              <>
                <p
                  className="caps"
                  style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}
                >
                  What the patient said
                </p>
                <blockquote
                  style={{
                    margin: "0 0 calc(var(--cell) * 2.5)",
                    padding: "0 0 0 calc(var(--cell) * 2)",
                    borderLeft: "1px solid var(--rule-ink)",
                    fontSize: 19,
                    lineHeight: 1.5,
                    color: "var(--print)",
                  }}
                >
                  &ldquo;{e.utterance}&rdquo;
                </blockquote>
              </>
            ) : (
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 2.5)",
                  padding: "calc(var(--cell) * 2)",
                  background: "var(--label-2)",
                  color: "var(--print-2)",
                  fontSize: 14,
                }}
              >
                Nothing was said. Every attempt ended without an answer, which
                is a signal in itself and the reason this is here.
              </p>
            )}

            <p
              className="caps"
              style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 0.75)" }}
            >
              Why it escalated
            </p>
            <p style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)" }}>
              {e.reason}
            </p>

            {e.callId ? (
              <p style={{ margin: "0 0 calc(var(--cell) * 2)" }}>
                <Button variant="onLabel" href={`/calls/${e.callId}`}>
                  Read the whole call
                </Button>
              </p>
            ) : null}

            <QueueActions
              escalationId={e.id}
              planId={e.planId}
              pausedPlan={e.pausedPlan}
            />
          </div>
        </Panel>
        </div>
      ))}
      </div>
    </div>
  );
}
