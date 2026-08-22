/**
 * The clinician queue.
 *
 * Three things have to be on screen together or the queue is useless: which
 * rule fired, why that rule exists, and what the patient actually said. The
 * third one is the reason this is a queue and not an alert — a clinician is
 * reading evidence, not a verdict.
 */

import { Badge, Button, Panel } from "@/components/ui";
import { ESCALATIONS, PATIENTS, displayPhone } from "@/lib/fixtures";

export default function QueuePage() {
  const urgent = ESCALATIONS.filter((e) => e.urgent).length;

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
          {ESCALATIONS.length} waiting on a clinician.
        </h1>
        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          {urgent} of these paused the rest of the patient&rsquo;s plan. Nothing
          resumes until a person decides — Care Loop routes, it does not rule.
        </p>
      </header>

      {ESCALATIONS.map((e) => {
        const patient = PATIENTS.find((p) => p.id === e.patientId);
        return (
          <Panel
            key={e.id}
            title={
              <span
                style={{
                  display: "inline-flex",
                  gap: "calc(var(--cell) * 1.5)",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{e.patient}</span>
                <span className="mono" style={{ color: "var(--print-3)", letterSpacing: 0 }}>
                  {patient ? displayPhone(patient.phone) : ""}
                </span>
              </span>
            }
            aside={
              <span style={{ display: "inline-flex", gap: "calc(var(--cell) * 1)", alignItems: "center" }}>
                <span className="caps mono" style={{ color: "var(--print-3)" }}>
                  {e.raisedAt}
                </span>
                {e.urgent ? (
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
                  {e.rule}
                </Badge>
                <Badge tone="plain" quiet>
                  {e.id}
                </Badge>
              </div>

              {e.utterance ? (
                <>
                  <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}>
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

              <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 0.75)" }}>
                Why it escalated
              </p>
              <p style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)" }}>
                {e.reason}
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
                <Button variant="primary" disabled>
                  Resume the plan
                </Button>
                <Button variant="onLabel" disabled>
                  Close it out
                </Button>
                <span
                  className="caps"
                  style={{ alignSelf: "center", color: "var(--print-3)" }}
                >
                  Not wired up yet
                </span>
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
