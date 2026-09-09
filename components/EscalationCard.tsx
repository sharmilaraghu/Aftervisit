/**
 * One escalation, as a clinician needs to read it.
 *
 * Three things have to be on screen together or an escalation is useless: which
 * rule fired, why that rule exists, and what the patient actually said. The
 * third is why this is a queue entry and not an alert — a clinician is reading
 * evidence and making the call, not being handed a verdict.
 *
 * **What is deliberately not at the top.** The card used to open with three
 * strips in a row: `RED FLAG TERM HEARD`, `red_flag_term_heard`, and
 * `ESC-0044`. The first two are the same fact in two registers, and the third
 * is a reference number — so the most prominent position on the card, the one a
 * doctor reads first, was spent saying one thing three times. The slug and the
 * reference are forensic: they matter when someone reconciles a record later,
 * never when deciding what to do about a patient who is vomiting. They sit at
 * the foot now, in the quiet ink, beside the timestamp they belong with.
 *
 * What replaced them is what a doctor needed and could not get: what this
 * patient is being followed up *for*. The card named a person and quoted them
 * with no clinical context at all.
 *
 * Extracted so the console's home and the full queue render the same object.
 * They used to be two hand-maintained copies of the same card, which is how the
 * two surfaces drift apart.
 */

import Link from "next/link";

import { Badge, Panel } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import type { QueueRow } from "@/lib/db/queries";
import { escalationRef, formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

/** What resolving actually did, in words. */
const RESOLUTION_LABEL: Record<string, string> = {
  resumed: "Handled · follow-up restarted",
  no_action: "Handled · follow-up kept running",
  closed: "Follow-up ended",
  contacted_patient: "Handled · patient contacted",
};

export function EscalationCard({ e }: { e: QueueRow }) {
  const resolved = e.status === "resolved";
  /* Only what the headline does not already say. When the headline *is* the
     floor hit, repeating it under "Rules that fired" is the same sentence
     twice in two registers. */
  const otherHits = (e.floorHits ?? []).filter((h) => h.ruleId !== e.ruleId);
  return (
    <div data-row-id={e.id}>
      <Panel
        headingLevel={3}
        title={
          <span
            style={{
              display: "inline-flex",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            {/* The patient is the thing you want, so the patient is the link. */}
            <Link
              href={`/patients/${e.patientId}`}
              style={{
                color: "var(--print)",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                textDecorationColor: "var(--rule)",
                whiteSpace: "nowrap",
              }}
            >
              {e.patientName}
            </Link>
            <span className="mono" style={{ color: "var(--print-3)", letterSpacing: 0 }}>
              {e.age} · {maskPhone(e.phoneE164)}
            </span>
          </span>
        }
        aside={
          <span style={{ display: "inline-flex", gap: "calc(var(--cell) * 1)", alignItems: "center" }}>
            {/*
              The model's degree, when a model ran. It sits beside the plan
              state rather than replacing it: one says how bad this looks, the
              other says whether the follow-up has stopped, and a clinician
              needs both.
            */}
            {resolved ? (
              <Badge tone="plain" quiet>
                Resolved
              </Badge>
            ) : e.severity === "severe" ? (
              <Badge tone="danger">Severe</Badge>
            ) : e.severity === "escalate" ? (
              <Badge tone="amber" quiet>
                Needs review
              </Badge>
            ) : null}
            {resolved ? null : e.pausedPlan ? (
              <Badge tone="danger">Plan paused</Badge>
            ) : (
              <Badge tone="amber" quiet>
                Routine
              </Badge>
            )}
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {/* One strip, in words, and what the plan is for — so the quote below
              has something to mean. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "calc(var(--cell) * 1.5)",
              marginBottom: "calc(var(--cell) * 2.5)",
            }}
          >
            <Badge tone="plain">{e.ruleLabel}</Badge>
            {e.planReason ? (
              <span style={{ color: "var(--print-2)", fontSize: 14 }}>
                Following up on {e.planReason.toLowerCase()}
              </span>
            ) : null}
          </div>

          {/*
            What the model made of the call. Above the quote, because it is the
            thing a doctor reads first — and clearly attributed, so nobody
            mistakes a model's sentence for the patient's.
          */}
          {e.summary ? (
            <>
              <p
                className="caps"
                style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}
              >
                What the assistant made of it
              </p>
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 2)",
                  color: "var(--print)",
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                {e.summary}
              </p>
            </>
          ) : null}

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
                  margin: "0 0 calc(var(--cell) * 2)",
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
                margin: "0 0 calc(var(--cell) * 2)",
                padding: "calc(var(--cell) * 2)",
                background: "var(--label-2)",
                color: "var(--print-2)",
                fontSize: 14,
              }}
            >
              Nothing was said. Every attempt ended without an answer, which is a
              signal in itself and the reason this is here.
            </p>
          )}

          {/* Why it fired, and the way to the evidence behind it. One sentence
              and one link, rather than a labelled section and a button. */}
          <p
            style={{
              margin: "0 0 calc(var(--cell) * 2.5)",
              color: "var(--print-2)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {e.reason}
            {e.callId ? (
              <>
                {" "}
                <Link
                  href={`/calls/${e.callId}`}
                  style={{ color: "var(--print)", textUnderlineOffset: 3 }}
                >
                  Read the whole call
                </Link>
              </>
            ) : null}
          </p>

          {/* The floor's own hits, listed on the row rather than raised beside
              it. One call used to produce three cards saying overlapping
              things; a clinician takes one action per call. */}
          {otherHits.length > 0 ? (
            <p
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 1)",
                alignItems: "baseline",
                margin: "0 0 calc(var(--cell) * 2.5)",
              }}
            >
              <span className="caps" style={{ color: "var(--print-3)" }}>
                Also caught
              </span>
              {otherHits.map((h) => (
                <Badge key={h.ruleId} tone={h.urgent ? "danger" : "plain"} quiet={!h.urgent}>
                  {h.label}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>

        {resolved ? (
          <div
            style={{
              padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
              background: "var(--label-2)",
              borderTop: "1px solid var(--rule)",
            }}
          >
            <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 0.75)", color: "var(--print-3)" }}>
              {RESOLUTION_LABEL[e.resolution ?? ""] ?? "Resolved"}
              {e.resolvedBy ? ` · ${e.resolvedBy}` : ""}
              {e.resolvedAt ? ` · ${formatStamp(e.resolvedAt, e.timezone)}` : ""}
            </p>
            {e.resolutionNote ? (
              <p style={{ margin: 0, color: "var(--print)", fontSize: 15, lineHeight: 1.5 }}>
                {e.resolutionNote}
              </p>
            ) : (
              <p style={{ margin: 0, color: "var(--print-3)", fontSize: 14 }}>
                No note was written.
              </p>
            )}
          </div>
        ) : (
          <QueueActions
            escalationId={e.id}
            planId={e.planId}
            patientName={e.patientName}
            pausedPlan={e.pausedPlan}
            status={e.status}
          />
        )}

        <div style={{ padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)" }}>

          {/*
            The audit trail, at the foot and in the quiet ink. Deleting it would
            be deleting the paper trail; leaving it on top was making a doctor
            read a slug before they could read their patient.
          */}
          <p
            className="mono"
            style={{
              margin: 0,
              color: "var(--print-3)",
              fontSize: 11,
            }}
          >
            {escalationRef(e.ref)} · {e.ruleId} · raised{" "}
            {formatStamp(e.raisedAt, e.timezone)}
          </p>
        </div>
      </Panel>
    </div>
  );
}
