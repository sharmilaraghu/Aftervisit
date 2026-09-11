/**
 * One visit: who this is, what they came in with, what came before, and the
 * box for the note.
 *
 * Side by side on a wide screen, so the complaint and the patient's history
 * stay in view while the note is written against them. A visit already written
 * up sends the doctor to its plan rather than showing a second, empty box —
 * the note exists, and this is where it went.
 *
 * The doctor's screen: no phone number. The front desk reads it from the
 * patient record; nobody dials from here.
 */

import { notFound, redirect } from "next/navigation";

import { Avatar, Badge, Breadcrumb, Panel } from "@/components/ui";
import { ConsultForm } from "@/components/ConsultForm";
import { getVisit } from "@/lib/db/visits";
import { getPatientSummary, type PatientSummary } from "@/lib/db/summary";
import { hasProvider } from "@/lib/plan/provider";
import { CONSENT_LABEL, CONSENT_TONE } from "@/lib/patients/labels";
import { languageLabel } from "@/lib/patients/languages";
import { formatCalendarDay, formatDay } from "@/lib/format";
import type { VisitKind, VisitStatus } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<VisitKind, string> = {
  consultation: "Consultation",
  post_op: "Post-operative follow-up",
};

const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  waiting: "Note due",
  seen: "Written up",
  cancelled: "Cancelled",
};

/** How an earlier follow-up ended, in a doctor's words — not the enum. */
function outcome(course: PatientSummary["courses"][number]): string {
  if (course.status === "active" || course.status === "paused") return "Still running";
  if (course.status === "awaiting_approval") return "Never approved";
  if (course.status === "cancelled") return "Cancelled";
  if (course.closeReason === "superseded") return "Replaced by a later plan";
  if (course.closeReason === "clinician_closed") return "Closed by you";
  return "Window closed";
}

/* Enough to decide with, not a record to read: the full history is one click
   away on the patient's page. */
const HISTORY_LIMIT = 3;

export default async function ConsultVisitPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  const visit = await getVisit(visitId);
  if (!visit || visit.patientArchived) notFound();
  if (visit.status === "seen" && visit.planId) redirect(`/plans/${visit.planId}`);

  const open = visit.status === "waiting";
  const history = (await getPatientSummary(visit.patientId)).courses.slice(0, HISTORY_LIMIT);

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <Breadcrumb
          items={[{ label: "Consultations", href: "/consult" }, { label: visit.patientName }]}
        />

        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1)",
            color: "var(--bench-ink)",
          }}
        >
          {visit.patientName}
        </h1>
        <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--bench-ink-2)", fontSize: 15 }}>
          <span className="mono">{visit.age}</span> · speaks {languageLabel(visit.language)}
        </p>

        {/* The patient's state first, as a stamp, then the facts about the
            visit. Under the name, not floated to the far edge of the page. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 1)",
            alignItems: "center",
          }}
        >
          <Badge tone="plain">{VISIT_STATUS_LABEL[visit.status]}</Badge>
          <Badge tone="plain" quiet>
            {KIND_LABEL[visit.kind]} · {formatCalendarDay(visit.visitDate)}
          </Badge>
          <Badge tone={CONSENT_TONE[visit.consent]} quiet>
            {CONSENT_LABEL[visit.consent]}
          </Badge>
        </div>
      </header>

      <div className="consult-grid">
        <div style={{ display: "grid", gap: "calc(var(--cell) * 2)" }}>
          <Panel title="What they came in with">
            <div
              style={{
                display: "flex",
                gap: "calc(var(--cell) * 2)",
                alignItems: "flex-start",
                padding: "calc(var(--cell) * 3)",
              }}
            >
              <Avatar name={visit.patientName} />
              <p
                style={{
                  margin: 0,
                  minWidth: 0,
                  fontSize: 15,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  color: "var(--print)",
                }}
              >
                {visit.reportedSymptoms}
              </p>
            </div>
            <p
              style={{
                margin: 0,
                padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 3)",
                borderTop: "1px solid var(--rule-2)",
                color: "var(--print-3)",
                fontSize: 13,
              }}
            >
              The front desk&rsquo;s words. Context only: the questions are grounded in your
              note alone.
            </p>
          </Panel>

          {/*
            What came before, for a returning patient — the reason a doctor
            would otherwise open the record in another tab. Earlier follow-ups,
            how each ended, and what the doctor wrote when they closed it.
          */}
          {history.length > 0 ? (
            <Panel
              title="Earlier follow-ups"
              aside={
                <span className="caps mono" style={{ color: "var(--print-3)" }}>
                  {history.length}
                </span>
              }
            >
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {history.map((course, i) => (
                  <li
                    key={course.planId}
                    style={{
                      padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 3)",
                      borderTop: i > 0 ? "1px solid var(--rule-2)" : undefined,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: "calc(var(--cell) * 1)",
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
                        {course.reason}
                      </span>
                      <Badge tone="plain" quiet>
                        {outcome(course)}
                      </Badge>
                    </div>
                    <p className="mono" style={{ margin: "2px 0 0", fontSize: 12, color: "var(--print-3)" }}>
                      {course.startsAt ? formatDay(course.startsAt, visit.timezone) : "never started"}
                      {course.closedAt ? ` → ${formatDay(course.closedAt, visit.timezone)}` : ""}
                      {course.calls > 0 ? ` · ${course.reached} of ${course.calls} calls answered` : ""}
                    </p>
                    {course.closingSummary ? (
                      <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 14, lineHeight: 1.5, color: "var(--print)" }}>
                        {course.closingSummary}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div>
          {/*
            Said before the doctor writes, not after they approve. A plan for a
            patient without consent is allowed — the desk may record it later —
            but every call it schedules is refused until then, and learning that
            at the approve button costs the doctor the note they just wrote.
            Blue, not amber or red: it informs, and nobody is at risk.
          */}
          {open && visit.consent !== "granted" ? (
            <p
              role="note"
              style={{
                margin: "0 0 calc(var(--cell) * 2)",
                padding: "calc(var(--cell) * 2)",
                background: "var(--info-wash)",
                boxShadow: "inset 0 0 0 1px var(--info)",
                color: "var(--print)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              <strong>
                {visit.consent === "declined"
                  ? "This patient declined automated calls."
                  : "Consent to automated calls is not recorded."}
              </strong>{" "}
              You can write the note and review the plan, but nothing will dial until the
              front desk records that the patient agreed.
            </p>
          ) : null}
          {open ? (
            <ConsultForm visitId={visit.id} kind={visit.kind} canCompile={hasProvider()} />
          ) : (
            <Panel title="Not open">
              <p
                className="measure"
                style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}
              >
                {visit.status === "cancelled"
                  ? "This visit was cancelled."
                  : "This visit was written up, but its plan is gone. Book another visit from the patient's record."}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
