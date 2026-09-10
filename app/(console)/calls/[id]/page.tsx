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

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Panel } from "@/components/ui";
import { failureReason, networkRefused } from "@/lib/calle/failure";
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

/**
 * Whether two sentences are saying the same thing.
 *
 * Word overlap, not string equality: the model writes "Nobody spoke on this
 * call. It is not possible to assess…" as the summary and "Nobody spoke on this
 * call, so it is not possible to assess…" as the reason, which differ by a
 * comma and a conjunction and read as a rendering fault.
 */
function nearlySame(a: string, b: string | null): boolean {
  if (!b) return false;
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z']+/g) ?? []);
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size) > 0.8;
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
          <Link href={`/patients/${call.patientId}`} className="backlink">
            Back to {call.patientName}
          </Link>
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

      {/*
        What the network did.

        A real call came back 480 and this page said "No answers were extracted
        from this call" — true, and useless. The patient never heard a ring, and
        a clinician reading "no answer" would reasonably conclude she chose not
        to pick up. Those need opposite responses.
      */}
      {failureReason(call.failureCode) ? (
        <Panel
          title={networkRefused(call.failureCode) ? "This call never rang" : "Nobody answered"}
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {call.failureCode}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <p
            className="measure"
            style={{ margin: 0, padding: "calc(var(--cell) * 3)", color: "var(--print)" }}
          >
            {failureReason(call.failureCode)}
          </p>
        </Panel>
      ) : null}

      {call.escalations.length > 0 ? (
        <Panel
          title="Escalated"
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
                <p className="measure" style={{ margin: 0, color: "var(--print-2)", fontSize: 14 }}>
                  {e.reason}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Answers"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {networkRefused(call.failureCode)
              ? "did not connect"
              : call.resultStatus === "null_result"
                ? "no result"
                : `${call.slots.length} answers`}
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        {/*
          A refused call still comes back with a full result object, every key
          filled in as unknown — so this table printed eight rows of "could not
          be mapped" for a call that never rang. That reads as "we asked and
          could not understand her", which is a claim about the patient, on a
          call she never received. They are placeholders, not answers, and the
          honest thing is to show none of them.
        */}
        {call.slots.length === 0 || networkRefused(call.failureCode) ? (
          <p
            style={{
              margin: 0,
              padding: "calc(var(--cell) * 3)",
              color: "var(--print-2)",
              fontSize: 14,
            }}
          >
            {networkRefused(call.failureCode)
              ? "The call never connected, so there was nothing to record. See above for what the network reported."
              : call.failureCode === "no_answer"
                ? "Nobody answered, so there is nothing to record. That is itself the signal — three of these in a row raises an escalation."
                : "No answers were extracted from this call."}
          </p>
        ) : (
          /*
            A table, not eight stacked blocks.
            Each answer was a heading, a prompt, a value and a quote in its own
            bordered card — about 95px for a yes. Eight of those made this page
            six thousand pixels tall for a call that lasted fifty-four seconds.
            The question, what was recorded, and whether it could be mapped are
            three columns, and the words the patient used sit under the row they
            belong to.
          */
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                  {["Asked", "Recorded", ""].map((h, i) => (
                    <th
                      key={h || i}
                      className="caps"
                      style={{
                        textAlign: "left",
                        padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)",
                        color: "var(--print-3)",
                        fontWeight: 700,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {call.slots.map((slot) => {
                  const tone = SLOT_TONE[slot.status] ?? SLOT_TONE.refused;
                  return (
                    <tr key={slot.questionId} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                      <td
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          color: "var(--print-2)",
                          fontSize: 14,
                          verticalAlign: "top",
                        }}
                      >
                        {/*
                          The wording the patient heard. The slug that used to
                          head this row — reached_patient, taking_as_prescribed —
                          is an internal identifier and had no business on a
                          clinical screen.
                        */}
                        {slot.prompt ?? slot.questionId}
                        {slot.utterance ? (
                          <blockquote
                            style={{
                              margin: "calc(var(--cell) * 0.75) 0 0",
                              padding: "0 0 0 calc(var(--cell) * 1.5)",
                              borderLeft: "2px solid var(--rule-2)",
                              color: "var(--print)",
                              fontSize: 15,
                            }}
                          >
                            &ldquo;{slot.utterance}&rdquo;
                          </blockquote>
                        ) : null}
                      </td>
                      <td
                        className="mono"
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          color: "var(--print)",
                          fontSize: 15,
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        {slotValue(slot)}
                      </td>
                      <td
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          verticalAlign: "top",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {/* Green on every answered row is a wall of green. The
                            status is only worth a badge when it is not "answered". */}
                        {slot.status === "answered" ? null : (
                          <Badge tone={tone.tone} quiet={tone.quiet}>
                            {tone.label}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          title="Assessment"
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
                className="measure"
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

            {/*
              The reason is why it was routed, and on a call nobody answered the
              model writes very nearly the summary again — two sentences saying
              one thing, which reads like a bug rather than a rationale. Printed
              only when it is actually saying something else.
            */}
            {/*
              The reason says why this was routed to a person, which is exactly
              what the escalation panel at the top of the page already says —
              usually in the same words, because both come from the same triage
              row. Printed only when there is no escalation to have said it.
            */}
            {triage.reason &&
            call.escalations.length === 0 &&
            !nearlySame(triage.reason, triage.summary) ? (
              <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14, lineHeight: 1.5 }}>
                {triage.reason}
              </p>
            ) : null}

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

      {call.transcript && call.transcript.length > 0 ? (
        <Panel title="The whole call" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {call.transcript.map((turn, i) => (
              <p
                key={i}
                className="measure"
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

      {call.summary || call.evidence?.length || call.completionConfidence ? (
        <Panel
          title="Platform check"
          aside={
            call.taskCompleted === null ? undefined : (
              <Badge tone={call.taskCompleted ? "clear" : "amber"} quiet>
                {call.taskCompleted ? "Reached an end state" : "Did not finish"}
              </Badge>
            )
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          {/*
            Shut by default. This is CALL-E's own read of the call, and it sat
            open underneath ours — two machines assessing one conversation, in
            full, one after the other. Our verdict leads; theirs is a check you
            can pull up when the two might disagree.
          */}
          <details className="disclosure">
            <summary
              className="caps"
              style={{
                cursor: "pointer",
                padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
                color: "var(--print-2)",
              }}
            >
              What the platform made of it
            </summary>
          <div style={{ padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 3)" }}>
            {call.summary ? (
              <p
                className="measure"
                style={{ margin: 0, color: "var(--print)", fontSize: 15, lineHeight: 1.55 }}
              >
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
                <ul className="measure" style={{ margin: 0, paddingLeft: "calc(var(--cell) * 2.5)" }}>
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
          </details>
        </Panel>
      ) : null}


      {call.transcriptGuardFindings && call.transcriptGuardFindings.length > 0 ? (
        <Panel
          title="Guard check"
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

      {/*
        Shut by default.
        The script is twelve hundred words and it was printed in full at the
        foot of every call, so the page ran to eight screens and the transcript
        — the thing a clinician opens this page for — was a strip at the top of
        a wall of prompt. It stays reachable in one click because "what was it
        actually told to say" is a real question, just not the first one.
      */}
      {call.task ? (
        <Panel title="The script">
          <details className="disclosure">
            <summary
              className="caps"
              style={{
                cursor: "pointer",
                padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
                color: "var(--print-2)",
              }}
            >
              Show the script
            </summary>
            <div
              style={{
                padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 3)",
              }}
            >
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
          </details>
        </Panel>
      ) : null}
    </div>
  );
}
