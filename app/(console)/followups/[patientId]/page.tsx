/**
 * One patient, for the doctor.
 *
 * The follow-up used to live on two screens: the plan page (built to approve a
 * draft, and after approval still printing provenance badges and a coverage
 * check) and the patient record (filed under the front desk, with the
 * escalation halfway down and a link that sent the doctor to the whole list).
 * This is the one place a doctor reads a running follow-up, in the order they
 * need it: what needs deciding, how the patient is doing, whether we are
 * reaching them, then the plan itself.
 *
 * The desk keeps its own record at /patients/[id] — contact, calls, stop,
 * delete — without the clinical content or the decisions.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Breadcrumb, Button, Panel, WeekBand } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import { CloseFile } from "@/components/CloseFile";
import { AmendNote } from "@/components/AmendNote";
import { EscalationSetup } from "@/components/EscalationSetup";
import { HowTheyAreDoing } from "@/components/HowTheyAreDoing";
import { getPatientDetail } from "@/lib/db/patients";
import { getPatientSummary } from "@/lib/db/summary";
import { getParameterGrid } from "@/lib/db/parameters";
import { getPlanForReview } from "@/lib/db/plans";
import { getLatestReading } from "@/lib/db/followup";
import { getWaitingVisits } from "@/lib/db/visits";
import { HEALTH_LABEL } from "@/lib/patients/labels";
import { languageLabel } from "@/lib/patients/languages";
import { OBSERVED_QUESTION_IDS } from "@/lib/plan/universal-questions";
import { whatChanged } from "@/lib/patients/parameters";
import { formatDay, formatStamp } from "@/lib/format";
import { localDate } from "@/lib/time/clock";

export const dynamic = "force-dynamic";

const CADENCE: Record<string, string> = {
  daily: "Daily",
  every_other_day: "Every other day",
  weekly: "Weekly",
};

export default async function FollowUpPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ approved?: string }>;
}) {
  const { patientId } = await params;
  const { approved } = await searchParams;
  const detail = await getPatientDetail(patientId);
  if (!detail) notFound();

  const { patient } = detail;
  const planId = detail.planId;
  const [summary, rows, plan, reading] = await Promise.all([
    getPatientSummary(patientId),
    planId ? getParameterGrid(planId) : Promise.resolve([]),
    planId ? getPlanForReview(planId) : Promise.resolve(null),
    planId ? getLatestReading(planId) : Promise.resolve(null),
  ]);

  const live = detail.planStatus === "active" || detail.planStatus === "paused";
  const draft = detail.planStatus === "awaiting_approval";
  const firstName = patient.name.split(" ")[0];
  const waiting = summary.escalations.find((e) => e.status === "open" || e.status === "acknowledged");
  const now = new Date();
  const nextCall = detail.calls
    .filter((c) => c.status === "scheduled" && c.scheduledFor > now)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())[0];
  const course = summary.courses.find((c) => c.planId === planId);

  /* After an approval the doctor's next move is the next patient. */
  const next = approved
    ? (await getWaitingVisits()).find(
        (v) => v.patientId !== patient.id && v.visitDate <= localDate(new Date(), v.timezone),
      )
    : undefined;

  const questions = (plan?.questions ?? []).filter(
    (q) => q.guardStatus === "approved" && !OBSERVED_QUESTION_IDS.has(q.questionId),
  );
  const peak = whatChanged(rows).changed[0];

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <Breadcrumb items={[{ label: "Follow-ups", href: "/dashboard" }, { label: patient.name }]} />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "calc(var(--cell) * 2)",
          }}
        >
          <div>
            <h1
              className="display"
              style={{ fontSize: "clamp(28px, 3.2vw, 40px)", margin: "0 0 calc(var(--cell) * 1)", color: "var(--bench-ink)" }}
            >
              {patient.name}
            </h1>
            {/* No phone number printed: the doctor rings from their own phone. */}
            <p style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center", margin: 0, color: "var(--bench-ink-2)", fontSize: 15 }}>
              <span>
                <span className="mono">{patient.age}</span> · speaks {languageLabel(patient.language)}
                {detail.reason ? <> · {detail.reason}</> : null}
              </span>
              {/* Quiet: the decision block below is this page's one red. */}
              {detail.health ? (
                <Badge tone="plain" quiet>
                  {HEALTH_LABEL[detail.health]}
                </Badge>
              ) : null}
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
            {draft && planId ? (
              <Button variant="primary" href={`/plans/${planId}`}>
                Review and approve
              </Button>
            ) : null}
            {/* Not while the decision block is showing: it carries the same button. */}
            {!waiting ? (
              <Button variant="ghost" href={`tel:${patient.phoneE164}`} ariaLabel={`Phone ${patient.name} from your own phone`}>
                Phone {firstName} yourself
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {approved && detail.startsAt ? (
        <p
          role="status"
          style={{
            margin: "0 0 calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 2)",
            background: "var(--clear-wash)",
            boxShadow: "inset 0 0 0 1px var(--clear)",
            color: "var(--print)",
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          <strong>The follow-up has started.</strong> The first call goes out{" "}
          <span className="mono">{formatStamp(detail.startsAt, patient.timezone)}</span>. Nothing rings before then.
          {next ? (
            <>
              {" "}
              <Link href={`/consult/${next.id}`} style={{ color: "var(--print)", fontWeight: 700, textUnderlineOffset: 3 }}>
                Next patient: {next.patientName}
              </Link>
            </>
          ) : (
            " Nobody else is waiting for a note."
          )}
        </p>
      ) : null}

      {/* 1 — what needs deciding. The page's one red, and only when it exists. */}
      {waiting && planId ? (
        <Panel title="Needs your decision" band="danger" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3) calc(var(--cell) * 3) calc(var(--cell) * 2)" }}>
            <p className="measure" style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--print)" }}>
              {waiting.summary ?? waiting.ruleLabel}
            </p>
            {reading?.quote && reading.quoteCallId === waiting.callId ? (
              <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 15, color: "var(--print-2)" }}>
                In their words: &ldquo;{reading.quote}&rdquo;
              </p>
            ) : null}
            <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 13, color: "var(--print-3)" }}>
              {/* "Read by the assistant" names where the flag came from, not why. */}
              {waiting.ruleLabel === "Read by the assistant" ? "" : `${waiting.ruleLabel} · `}
              raised <span className="mono">{formatStamp(waiting.raisedAt, patient.timezone)}</span>
              {waiting.urgent ? " · calls paused until you decide" : ""}
              {waiting.callId ? (
                <>
                  {" · "}
                  <Link href={`/calls/${waiting.callId}`} style={{ color: "var(--print)", textUnderlineOffset: 3 }}>
                    Read the call
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <div style={{ borderTop: "1px solid var(--rule)", padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)" }}>
            <QueueActions
              escalationId={waiting.id}
              planId={planId}
              patientName={patient.name}
              phoneE164={patient.phoneE164}
              pausedPlan={detail.planStatus === "paused"}
              status={waiting.status}
              planLive={live}
            />
          </div>
        </Panel>
      ) : null}

      {/* 2 — how they are doing. */}
      {planId && reading && !draft ? (
        <HowTheyAreDoing
          rows={rows}
          reading={reading}
          timezone={patient.timezone}
          summaryShownAbove={Boolean(waiting?.summary && waiting.summary === reading.conditionSummary)}
        />
      ) : null}

      {/* 3 — whether we are reaching them, in one line. */}
      {planId && !draft ? (
        <section
          className="sheet"
          aria-label="Contact"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "calc(var(--cell) * 2) calc(var(--cell) * 4)",
            padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
            marginBottom: "calc(var(--cell) * 2)",
          }}
        >
          <WeekBand week={detail.week} />
          <span style={{ fontSize: 14, color: "var(--print-2)" }}>
            Last spoke{" "}
            <span className="mono" style={{ color: "var(--print)" }}>
              {detail.lastHeard ? formatStamp(detail.lastHeard, patient.timezone) : "—"}
            </span>
          </span>
          <span style={{ fontSize: 14, color: "var(--print-2)" }}>
            Next call{" "}
            <span className="mono" style={{ color: "var(--print)" }}>
              {detail.planStatus === "paused"
                ? "none — paused"
                : nextCall
                  ? formatStamp(nextCall.scheduledFor, patient.timezone)
                  : live
                    ? "none scheduled"
                    : "— follow-up ended"}
            </span>
          </span>
        </section>
      ) : null}

      {/* 4 — the plan itself, one line, opened on demand. */}
      {plan ? (
        <section id="plan">
          <Panel title="The plan" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
            <div style={{ padding: "calc(var(--cell) * 3)" }}>
              <p className="mono" style={{ margin: 0, fontSize: 14, color: "var(--print)" }}>
                {CADENCE[plan.cadence] ?? plan.cadence} · {plan.localTime} · up to {plan.maxAttempts} tries a day
                {plan.startsAt && plan.endsAt
                  ? ` · ${formatDay(plan.startsAt, patient.timezone)} → ${formatDay(plan.endsAt, patient.timezone)}`
                  : ""}
              </p>

              {!live && !draft ? (
                /* A finished course, in one assembled line, then how it resolved. */
                <div style={{ marginTop: "calc(var(--cell) * 2)" }}>
                  <p style={{ margin: 0, fontSize: 15, color: "var(--print)" }}>
                    Finished · reached on <span className="mono">{detail.contacted}</span> of{" "}
                    <span className="mono">{detail.due}</span> days
                    {peak ? (
                      <>
                        {" "}· {peak.to} on{" "}
                        <span className="mono">
                          {peak.since.date ? formatDay(peak.since.date, patient.timezone) : `call ${peak.since.occurrence}`}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {course?.closingSummary ? (
                    <p className="measure" style={{ margin: "calc(var(--cell) * 1.5) 0 0", paddingLeft: "calc(var(--cell) * 1.5)", borderLeft: "2px solid var(--rule)", fontSize: 14, lineHeight: 1.6, color: "var(--print)" }}>
                      {course.closingSummary}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <details className="disclosure" style={{ marginTop: "calc(var(--cell) * 2.5)" }}>
                <summary>
                  What it asks · <span className="mono">{questions.length}</span> questions
                </summary>
                <ol style={{ margin: "calc(var(--cell) * 1.5) 0 0", paddingLeft: "calc(var(--cell) * 3)" }}>
                  {questions.map((q) => (
                    <li key={q.id} style={{ marginBottom: "calc(var(--cell) * 1)", fontSize: 14, color: "var(--print)" }}>
                      {q.prompt}
                      {q.anchorQuote ? (
                        <span style={{ display: "block", fontSize: 13, color: "var(--print-3)" }}>
                          From your note: &ldquo;{q.anchorQuote}&rdquo;
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </details>

              {live ? (
                /*
                  What to do next with this follow-up, said plainly rather than
                  folded under "Manage this follow-up". Adding to it recompiles
                  the questions onto the plan already running; a new follow-up
                  starts from a fresh visit and note, and approving it ends this
                  one; ending it stops the remaining calls.
                */
                <div style={{ display: "grid", gap: "calc(var(--cell) * 2)", justifyItems: "start", marginTop: "calc(var(--cell) * 2.5)" }}>
                  <AmendNote planId={plan.id} live />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
                    <Button variant="onLabel" href={`/register?patient=${patient.id}`}>
                      Start a new follow-up
                    </Button>
                    <CloseFile planId={plan.id} patientId={patient.id} patientName={patient.name} finished={false} />
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>

          {live ? (
            <Panel title="When to escalate" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
              <EscalationSetup planId={plan.id} escalationNote={plan.escalationNote} terms={plan.redFlagTerms} live />
            </Panel>
          ) : null}
        </section>
      ) : (
        <Panel title="No follow-up yet" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}>
            A follow-up starts from a consultation note. Book a visit from the desk record, then
            write the note from Consultations.
          </p>
        </Panel>
      )}

      {/* 5 — the note, folded; 6 — earlier courses. */}
      {summary.notes.length > 0 ? (
        <details className="disclosure sheet" style={{ padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)", marginBottom: "calc(var(--cell) * 2)" }}>
          <summary style={{ color: "var(--print-2)", fontWeight: 600 }}>
            Your note · <span className="mono">{formatDay(summary.notes[0].createdAt, patient.timezone)}</span>
          </summary>
          <p className="measure" style={{ margin: "calc(var(--cell) * 1.5) 0 0", whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.6, color: "var(--print)" }}>
            {summary.notes[0].body}
          </p>
        </details>
      ) : null}

      {detail.priorPlans.length > 0 ? (
        <Panel title="Earlier follow-ups">
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {detail.priorPlans.map((p, i) => {
              const c = summary.courses.find((x) => x.planId === p.id);
              return (
                <li key={p.id} style={{ padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 3)", borderTop: i > 0 ? "1px solid var(--rule-2)" : undefined }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--print)" }}>{p.reason}</span>{" "}
                  <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                    {p.startsAt ? formatDay(p.startsAt, patient.timezone) : "never started"}
                    {p.closedAt ? ` → ${formatDay(p.closedAt, patient.timezone)}` : ""}
                    {c && c.calls > 0 ? ` · ${c.reached} of ${c.calls} calls answered` : ""}
                  </span>
                  {c?.closingSummary ? (
                    <p className="measure" style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--print)" }}>
                      {c.closingSummary}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
