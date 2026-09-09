/**
 * One call.
 *
 * The evidence page. Typed answers first, because that is what the rules read;
 * the patient's own words beside each one, because that is what a clinician
 * actually needs to judge it; then the full transcript, and finally the exact
 * script that was sent.
 *
 * The script being on this page matters more than it looks. "What did the agent
 * actually say to my patient?" is a question a doctor is entitled to ask, and
 * the answer is stored before the dial rather than reconstructed after it.
 */

import { notFound } from "next/navigation";

import { Badge, Button, Panel } from "@/components/ui";
import { getCall } from "@/lib/db/calls";
import { getTriage } from "@/lib/db/triage";
import { escalationRef, formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import type { Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const SLOT_TONE: Record<string, { tone: Tone; quiet: boolean; label: string }> = {
  answered: { tone: "clear", quiet: true, label: "Answered" },
  unmappable: { tone: "amber", quiet: false, label: "Could not be mapped" },
  missing: { tone: "amber", quiet: true, label: "Never answered" },
  refused: { tone: "plain", quiet: true, label: "Refused" },
};

function slotValue(slot: {
  valueBool: boolean | null;
  valueNumber: number | null;
  valueText: string | null;
}): string {
  if (slot.valueBool !== null) return slot.valueBool ? "yes" : "no";
  if (slot.valueNumber !== null) return String(slot.valueNumber);
  if (slot.valueText !== null) return slot.valueText;
  return "—";
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [call, triage] = await Promise.all([getCall(id), getTriage(id)]);
  if (!call) notFound();

  const isAgent = (speaker: string) =>
    ["agent", "assistant", "bot", "ai"].includes(speaker.toLowerCase());

  return (
    <div
      style={{
        maxWidth: 940,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Button variant="ghost" href={`/patients/${call.patientId}`}>
            Back to {call.patientName}
          </Button>
        </p>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          Day {call.occurrence}, attempt {call.attempt} of {call.maxAttempts}.
        </h1>
        <p className="mono" style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 14 }}>
          {maskPhone(call.phoneE164)} · {formatStamp(call.scheduledFor, call.timezone)}
          {call.calleCallId ? ` · ${call.calleCallId}` : ""}
        </p>
      </header>

      {call.refusalReason ? (
        <Panel
          title="This call was refused"
          aside={<Badge tone="danger">{call.refusalReason.replace(/_/g, " ")}</Badge>}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: 0, color: "var(--print)" }}>{call.refusalDetail}</p>
          </div>
        </Panel>
      ) : null}

      {call.escalations.length > 0 ? (
        <Panel
          title="What it escalated"
          aside={<Badge tone="danger">{call.escalations.length}</Badge>}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {call.escalations.map((e) => (
              <div key={e.id} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "calc(var(--cell) * 0.75)",
                    marginBottom: "calc(var(--cell) * 0.75)",
                  }}
                >
                  <Badge tone={e.urgent ? "danger" : "amber"}>{e.ruleLabel}</Badge>
                  <Badge tone="plain" quiet>
                    {escalationRef(e.ref)}
                  </Badge>
                </div>
                <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14 }}>{e.reason}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="What it heard"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {call.resultStatus === "null_result" ? "no result" : `${call.slots.length} answers`}
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        {call.slots.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: "calc(var(--cell) * 3)",
              color: "var(--print-2)",
              fontSize: 14,
            }}
          >
            {call.failureCode === "no_answer"
              ? "Nobody answered, so there is nothing to record. That is itself the signal — three of these in a row raises an escalation."
              : "No answers were extracted from this call."}
          </p>
        ) : (
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {call.slots.map((slot) => {
              const tone = SLOT_TONE[slot.status] ?? SLOT_TONE.refused;
              return (
                <div
                  key={slot.questionId}
                  style={{
                    paddingBottom: "calc(var(--cell) * 2)",
                    marginBottom: "calc(var(--cell) * 2)",
                    borderBottom: "1px solid var(--rule-2)",
                  }}
                >
                  <p
                    className="caps"
                    style={{
                      margin: "0 0 calc(var(--cell) * 0.75)",
                      color: "var(--print-3)",
                      display: "flex",
                      gap: "calc(var(--cell) * 1)",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    {slot.questionId}
                    <Badge tone={tone.tone} quiet={tone.quiet}>
                      {tone.label}
                    </Badge>
                  </p>

                  {slot.prompt ? (
                    <p style={{ margin: "0 0 calc(var(--cell) * 0.75)", color: "var(--print-2)", fontSize: 14 }}>
                      {slot.prompt}
                    </p>
                  ) : null}

                  <p
                    className="mono"
                    style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print)", fontSize: 16 }}
                  >
                    {slotValue(slot)}
                  </p>

                  {/*
                    The patient's own words, beside the typed value. This pairing
                    is the point of the page: a clinician can see what was
                    recorded and judge for themselves whether it is right.
                  */}
                  {slot.utterance ? (
                    <blockquote
                      style={{
                        margin: 0,
                        padding: "0 0 0 calc(var(--cell) * 2)",
                        borderLeft: "1px solid var(--rule-ink)",
                        fontSize: 17,
                        lineHeight: 1.5,
                        color: "var(--print)",
                      }}
                    >
                      &ldquo;{slot.utterance}&rdquo;
                    </blockquote>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/*
        The calling platform's own read of the call, written to these columns on
        every call since the port was built and rendered nowhere — `summary`
        was selected and dropped, `evidence` and `completion_confidence` were
        never even read back.
        It is shown as evidence and labelled as the platform's, not ours: no
        rule reads it, and a clinician should know which sentences came from a
        model rather than from the patient.
      */}
      {/*
        The assistant's reading, which until now was written to `call_triage` on
        every finished call and shown nowhere — `getTriage` existed with no
        callers at all. Only severity, summary and quote ever escaped, copied
        onto the escalation, so `matchedConcerns` (which of the doctor's *own*
        conditions this call touched) and `keyTerms` were read by nothing.

        Above the platform's own summary, because this is the one a clinician
        acts on. Attributed in the title, never spoken in the product's voice.
      */}
      {triage ? (
        <Panel
          title="What the assistant made of it"
          aside={
            <Badge
              tone={
                triage.verdict === "severe"
                  ? "danger"
                  : triage.verdict === "escalate"
                    ? "amber"
                    : "clear"
              }
              quiet={triage.verdict === "low"}
            >
              {triage.verdict === "severe"
                ? "Severe"
                : triage.verdict === "escalate"
                  ? "Needs review"
                  : "Routine"}
            </Badge>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {triage.status === "ok" ? null : (
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 2)",
                  padding: "calc(var(--cell) * 2)",
                  background: "var(--amber-wash)",
                  boxShadow: "inset 0 0 0 1px var(--amber)",
                  color: "var(--print)",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                This call could not be read automatically, so it was queued
                unjudged rather than passed over. The locked conditions that run
                without a model still applied.
              </p>
            )}

            {triage.summary ? (
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 2)",
                  color: "var(--print)",
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                {triage.summary}
              </p>
            ) : null}

            <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14, lineHeight: 1.5 }}>
              {triage.reason}
            </p>

            {triage.matchedConcerns.length > 0 ? (
              <p
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "calc(var(--cell) * 1)",
                  alignItems: "baseline",
                  margin: "calc(var(--cell) * 2) 0 0",
                }}
              >
                <span className="caps" style={{ color: "var(--print-3)" }}>
                  Touched what you asked about
                </span>
                {triage.matchedConcerns.map((c) => (
                  <Badge key={c} tone="amber" quiet>
                    {c}
                  </Badge>
                ))}
              </p>
            ) : null}

            {triage.keyTerms.length > 0 ? (
              <p
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "calc(var(--cell) * 1)",
                  alignItems: "baseline",
                  margin: "calc(var(--cell) * 1.5) 0 0",
                }}
              >
                <span className="caps" style={{ color: "var(--print-3)" }}>
                  Words it picked out
                </span>
                {triage.keyTerms.map((t) => (
                  <Badge key={t} tone="plain" quiet>
                    {t}
                  </Badge>
                ))}
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {call.summary || call.evidence?.length || call.completionConfidence ? (
        <Panel
          title="What the call platform reported"
          aside={
            call.taskCompleted === null ? undefined : (
              <Badge tone={call.taskCompleted ? "clear" : "amber"} quiet>
                {call.taskCompleted ? "Reached an end state" : "Did not finish"}
              </Badge>
            )
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {call.summary ? (
              <p style={{ margin: 0, color: "var(--print)", fontSize: 15, lineHeight: 1.55 }}>
                {call.summary}
              </p>
            ) : null}

            {call.evidence?.length ? (
              <>
                <p
                  className="caps"
                  style={{
                    color: "var(--print-3)",
                    margin: "calc(var(--cell) * 2.5) 0 calc(var(--cell) * 1)",
                  }}
                >
                  What it based that on
                </p>
                <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 2.5)" }}>
                  {call.evidence.map((item, i) => (
                    <li
                      key={i}
                      style={{ color: "var(--print-2)", fontSize: 14, lineHeight: 1.5 }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {call.completionConfidence ? (
              <p
                className="mono"
                style={{
                  margin: "calc(var(--cell) * 2.5) 0 0",
                  paddingTop: "calc(var(--cell) * 1.5)",
                  borderTop: "1px solid var(--rule-2)",
                  color: "var(--print-3)",
                  fontSize: 11,
                }}
              >
                confidence {call.completionConfidence.label} ·{" "}
                {Math.round(call.completionConfidence.score * 100)}%
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {call.transcript && call.transcript.length > 0 ? (
        <Panel title="The whole call" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {call.transcript.map((turn, i) => (
              <p
                key={i}
                style={{
                  margin: "0 0 calc(var(--cell) * 1.5)",
                  color: isAgent(turn.speaker) ? "var(--print-3)" : "var(--print)",
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                <span className="caps mono" style={{ marginRight: "calc(var(--cell) * 1.5)" }}>
                  {isAgent(turn.speaker) ? "Agent" : "Patient"} · {turn.offsetSeconds}s
                </span>
                {turn.text}
              </p>
            ))}
          </div>
        </Panel>
      ) : null}

      {call.transcriptGuardFindings && call.transcriptGuardFindings.length > 0 ? (
        <Panel
          title="The guard flagged what the agent said"
          aside={<Badge tone="danger">{call.transcriptGuardFindings.length}</Badge>}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 14 }}>
              Checked after the call, on the agent&rsquo;s own turns only. What the
              patient said is never flagged — that is the disclosure this system exists for.
            </p>
            {call.transcriptGuardFindings.map((f, i) => (
              <p key={i} style={{ margin: "0 0 calc(var(--cell) * 1)", fontSize: 14 }}>
                <Badge tone="danger" quiet>
                  {f.category.replace(/_/g, " ")}
                </Badge>{" "}
                <span style={{ color: "var(--print)" }}>&ldquo;{f.match}&rdquo;</span>
              </p>
            ))}
          </div>
        </Panel>
      ) : null}

      {call.task ? (
        <Panel title="Exactly what it was told to say">
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p
              className="mono"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "var(--print-2)",
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {call.task}
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
