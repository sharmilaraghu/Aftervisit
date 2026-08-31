/**
 * One patient.
 *
 * The roster answers "who needs me?"; this page answers "what happened?". So
 * the evidence is the spine of it: the week band, then every call that produced
 * it, in order, with what each one ended as. Numbers first, prose second.
 *
 * The note sits at the bottom rather than the top on purpose — it is the input
 * to the plan, and by the time you are on this page you are reading outcomes.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { PatientControls } from "@/components/PatientControls";
import { Badge, Button, Panel, WeekBand } from "@/components/ui";
import { getPatientDetail } from "@/lib/db/patients";
import { getParameterHistory } from "@/lib/db/parameters";
import { ParameterBand } from "@/components/ParameterBand";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/patients/labels";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import type { Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const CONSENT_LABEL: Record<string, string> = {
  granted: "Consented to AI calls",
  declined: "Declined AI calls",
  unknown: "Consent not asked",
};

const CONSENT_TONE: Record<string, Tone> = {
  granted: "clear",
  declined: "danger",
  unknown: "amber",
};

/** What an occurrence ended as, in words. `—` while it is still ahead of us. */
function outcomeLabel(status: string, outcome: string | null, failureCode: string | null) {
  if (outcome === "flagged") return "Red flag";
  if (outcome === "answered") return "Answered";
  if (outcome === "unmappable") return "Could not be mapped";
  if (outcome === "no_answer") return failureCode === "no_answer" ? "No answer" : "Failed";
  if (outcome === "refused") return "Refused";
  if (status === "skipped") return "Held";
  if (status === "scheduled") return "Scheduled";
  return status;
}

function outcomeTone(outcome: string | null): { tone: Tone; quiet: boolean } {
  if (outcome === "flagged") return { tone: "danger", quiet: false };
  if (outcome === "answered") return { tone: "clear", quiet: true };
  if (outcome === "unmappable" || outcome === "no_answer") return { tone: "amber", quiet: true };
  return { tone: "plain", quiet: true };
}

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  const detail = await getPatientDetail(id);
  if (!detail) notFound();

  const parameters = await getParameterHistory(id);

  const { patient, calls } = detail;
  const rate = detail.due === 0 ? null : Math.round((detail.contacted / detail.due) * 100);

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Button variant="ghost" href="/patients">
            All patients
          </Button>
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "calc(var(--cell) * 3)",
          }}
        >
          <div>
            <h1
              className="display"
              style={{
                fontSize: "clamp(28px, 3.6vw, 44px)",
                margin: "0 0 calc(var(--cell) * 1)",
                color: "var(--bench-ink)",
              }}
            >
              {patient.name}
            </h1>
            <p
              className="mono"
              style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 14 }}
            >
              {patient.age} · {maskPhone(patient.phoneE164)} · {patient.timezone}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1)",
              alignItems: "center",
            }}
          >
            {patient.archivedAt ? <Badge tone="plain" quiet>Archived</Badge> : null}
            <Badge tone={CONSENT_TONE[patient.aiCallConsent]} quiet>
              {CONSENT_LABEL[patient.aiCallConsent]}
            </Badge>
            {detail.health ? (
              <Badge
                tone={HEALTH_TONE[detail.health]}
                quiet={detail.health === "completed"}
              >
                {HEALTH_LABEL[detail.health]}
              </Badge>
            ) : (
              <Badge tone="plain" quiet>
                No plan yet
              </Badge>
            )}
          </div>
        </div>
      </header>

      {created ? (
        <p
          style={{
            margin: "0 0 calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 2)",
            background: "var(--clear-wash)",
            boxShadow: "inset 0 0 0 1px var(--clear)",
            color: "var(--print)",
            fontSize: 15,
          }}
        >
          <strong>{patient.name} added.</strong> They will not be called until a
          follow-up plan has been written and you have approved it.
        </p>
      ) : null}

      {/*
        The next step, stated as an action rather than left for the doctor to
        deduce. This page used to offer only Edit and Archive — so a patient
        with no plan was a dead end, and the compile flow was reachable only by
        typing a URL.
      */}
      {!patient.archivedAt && !detail.planId ? (
        <Panel title="No plan yet" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p
              className="measure"
              style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)", fontSize: 15 }}
            >
              Nobody is following {patient.name} up. Write the note from the
              consultation and Care Loop will compile it into a plan you can read,
              edit and approve.
            </p>
            <Button variant="primary" href={`/patients/${patient.id}/new-plan`}>
              Write the follow-up note
            </Button>
          </div>
        </Panel>
      ) : null}

      {!patient.archivedAt && detail.planStatus === "awaiting_approval" && detail.planId ? (
        <Panel title="Waiting on you" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p
              className="measure"
              style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)", fontSize: 15 }}
            >
              A plan has been compiled for {patient.name} but no call is scheduled
              until you approve it.
            </p>
            <Button variant="primary" href={`/plans/${detail.planId}`}>
              Review and approve the plan
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="The week"
        aside={
          detail.reason ? (
            <span style={{ color: "var(--print-3)", fontSize: 13 }}>{detail.reason}</span>
          ) : undefined
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
            <WeekBand week={detail.week} />
          </div>

          <dl
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 5)",
              margin: 0,
            }}
          >
            {[
              ["Contact rate", rate === null ? "—" : `${rate}%`],
              ["Reached", `${detail.contacted}/${detail.due}`],
              [
                "Quiet for",
                detail.quietFor === null
                  ? "—"
                  : detail.quietFor === 0
                    ? "heard today"
                    : `${detail.quietFor}d`,
              ],
              [
                "Last heard",
                detail.lastHeard ? formatStamp(detail.lastHeard, patient.timezone) : "—",
              ],
              ["In queue", String(detail.openTotal)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="caps" style={{ color: "var(--print-3)" }}>
                  {label}
                </dt>
                <dd
                  className="mono"
                  style={{ margin: 0, fontSize: 20, color: "var(--print)", lineHeight: 1.3 }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      {detail.planId ? (
        <Panel
          title="The plan"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {detail.planStatus}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <dl
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 5)",
                margin: "0 0 calc(var(--cell) * 3)",
              }}
            >
              {[
                ["Cadence", `Daily · ${detail.durationDays} days`],
                ["Local time", `${detail.localTime} ${patient.timezone}`],
                ["Attempts", `Up to ${detail.maxAttempts} per day`],
                [
                  "Window",
                  detail.startsAt && detail.endsAt
                    ? `${formatStamp(detail.startsAt, patient.timezone)} → ${formatStamp(detail.endsAt, patient.timezone)}`
                    : "Not approved yet",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="caps" style={{ color: "var(--print-3)" }}>
                    {label}
                  </dt>
                  <dd
                    className="mono"
                    style={{ margin: 0, fontSize: 14, color: "var(--print)", lineHeight: 1.4 }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <p style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-3)", fontSize: 13 }}>
              The follow-up window is calendar-anchored from approval, not seven
              completed contacts. A retry may land after the end date; a new
              day&rsquo;s call may not.
            </p>

            <Button variant="onLabel" href={`/plans/${detail.planId}`}>
              See the whole plan
            </Button>
          </div>
        </Panel>
      ) : null}

      {detail.planId ? (
        <Panel
          title="What they said"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {parameters.rows.length} questions
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <ParameterBand rows={parameters.rows} occurrences={parameters.occurrences} />
        </Panel>
      ) : null}

      {detail.quality.slots > 0 ? (
        <Panel
          title="How the agent did"
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <dl
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 5)",
                margin: "0 0 calc(var(--cell) * 2)",
              }}
            >
              {[
                [
                  "Unclear answers",
                  `${detail.quality.unclear}/${detail.quality.slots}`,
                  detail.quality.unclear > 0,
                ],
                [
                  "Finished the call",
                  detail.quality.taskJudged === 0
                    ? "—"
                    : `${detail.quality.taskCompleted}/${detail.quality.taskJudged}`,
                  detail.quality.taskJudged > detail.quality.taskCompleted,
                ],
                [
                  "Raised something unasked",
                  `${detail.quality.raisedSomething}/${detail.quality.answered}`,
                  detail.quality.raisedSomething > 0,
                ],
              ].map(([label, value, flagged]) => (
                <div key={String(label)}>
                  <dt className="caps" style={{ color: "var(--print-3)" }}>
                    {label}
                  </dt>
                  <dd
                    className="mono"
                    style={{
                      margin: 0,
                      fontSize: 20,
                      lineHeight: 1.3,
                      color: flagged ? "var(--danger)" : "var(--print)",
                    }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              These describe the agent, not the patient. A rising unclear count
              usually means a question is worded badly — which is the doctor's to
              fix, and invisible without saying so.
            */}
            <p style={{ margin: 0, color: "var(--print-3)", fontSize: 13, maxWidth: "62ch" }}>
              These are about the call, not the patient. Unclear answers usually mean
              a question needs rewording. &ldquo;Finished the call&rdquo; is CALL-E&rsquo;s own
              verdict — anything short of every call raises an escalation, because an
              agent that skipped a question and recorded an answer anyway cannot be relied on.
            </p>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Calls"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {calls.length} rows
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        {calls.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: "calc(var(--cell) * 3)",
              color: "var(--print-2)",
              fontSize: 14,
            }}
          >
            No calls yet. Occurrences appear here the moment a plan is approved,
            dated, one row per day — before anything is dialled.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, fontSize: 14 }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                  {["Day", "Attempt", "Outcome", "What they said", "When"].map((h) => (
                    <th
                      key={h}
                      className="caps"
                      style={{
                        textAlign: "left",
                        padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                        color: "var(--print-3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const tone = outcomeTone(c.outcome);
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                      <td
                        className="mono"
                        style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}
                      >
                        {/* The call record exists; it was simply never linked. */}
                        <Link
                          href={`/calls/${c.id}`}
                          style={{
                            color: "var(--print)",
                            textDecoration: "underline",
                            textUnderlineOffset: 3,
                            textDecorationColor: "var(--rule)",
                          }}
                        >
                          {c.occurrence}
                        </Link>
                      </td>
                      <td
                        className="mono"
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          color: c.attempt > 1 ? "var(--print)" : "var(--print-3)",
                        }}
                      >
                        {c.attempt} of {detail.maxAttempts}
                      </td>
                      <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                        <Badge tone={tone.tone} quiet={tone.quiet}>
                          {outcomeLabel(c.status, c.outcome, c.failureCode)}
                        </Badge>
                      </td>
                      {/*
                        CALL-E writes this on every call, in the patient's own
                        words. It sat in the database unread while this table
                        showed two timestamps instead.
                      */}
                      <td
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          color: "var(--print-2)",
                          maxWidth: 420,
                        }}
                      >
                        {c.recap ?? <span style={{ color: "var(--print-3)" }}>—</span>}
                        {c.whatElse ? (
                          <span
                            style={{
                              display: "block",
                              marginTop: "calc(var(--cell) * 0.75)",
                              color: "var(--print)",
                            }}
                          >
                            <Badge tone="amber" quiet>
                              Also raised
                            </Badge>{" "}
                            {c.whatElse}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="mono"
                        style={{
                          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                          color: "var(--print-3)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatStamp(c.finishedAt ?? c.scheduledFor, patient.timezone)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {detail.noteBody ? (
        <Panel title="The note this came from" style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p
              className="mono"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "var(--print-2)",
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {detail.noteBody}
            </p>
          </div>
        </Panel>
      ) : null}

      {!patient.archivedAt ? (
        <PatientControls
          id={patient.id}
          name={patient.name}
          hasPendingCalls={calls.some((c) =>
            ["scheduled", "claimed", "dialing"].includes(c.status),
          )}
        />
      ) : (
        <p style={{ margin: 0, color: "var(--bench-ink-3)", fontSize: 14 }}>
          This patient is archived. Their history is kept; nothing will be dialled.
        </p>
      )}
    </div>
  );
}
