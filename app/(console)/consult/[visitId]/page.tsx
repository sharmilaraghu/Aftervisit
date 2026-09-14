/**
 * One visit: who this is, what they came in with, what came before, and the
 * box for the note.
 *
 * The note is the page's one task, so it takes the wide column and the focus.
 * The front desk's words sit beside it under a blue band — context someone else
 * supplied, not a grounding source — and a returning patient's earlier
 * follow-ups sit under that. A visit already written up sends the doctor to its
 * plan rather than showing a second, empty box.
 *
 * The doctor's screen: no phone number and no consent banner. Both are the
 * front desk's; the form says in one clause whether calls are waiting on
 * consent, and the approve screen says it again where it decides anything.
 */

import { notFound, redirect } from "next/navigation";

import { Badge, Breadcrumb, Panel, type Tone } from "@/components/ui";
import { ConsultForm } from "@/components/ConsultForm";
import { getVisit } from "@/lib/db/visits";
import { getPatientSummary, type PatientSummary } from "@/lib/db/summary";
import { hasProvider } from "@/lib/plan/provider";
import { languageLabel } from "@/lib/patients/languages";
import { formatCalendarDay, formatDay } from "@/lib/format";
import type { VisitKind } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<VisitKind, string> = {
  consultation: "Consultation",
  post_op: "Post-operative follow-up",
};

/** How an earlier follow-up ended, in a doctor's words — and its colour. */
function outcome(course: PatientSummary["courses"][number]): { label: string; tone: Tone } {
  if (course.status === "active" || course.status === "paused") return { label: "Still running", tone: "info" };
  if (course.status === "awaiting_approval") return { label: "Never approved", tone: "plain" };
  if (course.status === "cancelled") return { label: "Cancelled", tone: "plain" };
  if (course.closeReason === "superseded") return { label: "Replaced by a later plan", tone: "plain" };
  if (course.closeReason === "clinician_closed") return { label: "Closed by you", tone: "clear" };
  return { label: "Finished", tone: "clear" };
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
  const language = languageLabel(visit.language);

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <Breadcrumb
          items={[{ label: "Consultations", href: "/consult" }, { label: visit.patientName }]}
        />

        <h1
          className="display"
          style={{
            fontSize: "clamp(26px, 2.6vw, 34px)",
            margin: "0 0 calc(var(--cell) * 1)",
            color: "var(--bench-ink)",
          }}
        >
          {visit.patientName}
        </h1>
        {/* One line of facts. "Note due" went: the page is the note. */}
        <p
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "calc(var(--cell) * 1.5)",
            margin: 0,
            color: "var(--bench-ink-2)",
            fontSize: 15,
          }}
        >
          <span>
            <span className="mono">{visit.age}</span> · speaks {language}
          </span>
          <Badge tone={visit.kind === "post_op" ? "info" : "plain"} quiet>
            {KIND_LABEL[visit.kind]} · <span className="mono">{formatCalendarDay(visit.visitDate)}</span>
          </Badge>
          {visit.status === "no_show" ? (
            <Badge tone="plain">Didn&rsquo;t turn up</Badge>
          ) : null}
        </p>
      </header>

      <div className="consult-grid">
        <div style={{ display: "grid", gap: "calc(var(--cell) * 2)" }}>
          <Panel title="Front desk · What they came in with" band="info">
            <p
              style={{
                margin: 0,
                padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3)",
                fontSize: 15,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                color: "var(--print)",
              }}
            >
              {visit.reportedSymptoms}
            </p>
            <p
              style={{
                margin: 0,
                padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 3)",
                borderTop: "1px solid var(--rule-2)",
                color: "var(--print-3)",
                fontSize: 13,
              }}
            >
              Context only. What the calls find out comes from your note alone.
            </p>
          </Panel>

          {/*
            What came before, for a returning patient — the reason a doctor
            would otherwise open the record in another tab.
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
                {history.map((course, i) => {
                  const end = outcome(course);
                  return (
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
                        <Badge tone={end.tone} quiet>
                          {end.label}
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
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div>
          {open ? (
            <ConsultForm
              visitId={visit.id}
              kind={visit.kind}
              canCompile={hasProvider()}
              language={language}
              consent={visit.consent}
            />
          ) : (
            <Panel title="Not open">
              <p
                className="measure"
                style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}
              >
                {visit.status === "cancelled"
                  ? "This visit was cancelled."
                  : visit.status === "no_show"
                    ? "Marked as didn't turn up. If they arrived after all, put them back on the list from Consultations."
                    : "This visit was written up, but its plan is gone. Book another visit from the patient's record."}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
