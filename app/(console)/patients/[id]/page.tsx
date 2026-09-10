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

import { CallLog } from "@/components/CallLog";
import { PatientControls } from "@/components/PatientControls";
import { TreatmentControls } from "@/components/TreatmentControls";
import { AmendNote } from "@/components/AmendNote";
import { QueueActions } from "@/components/QueueActions";
import { ParameterGrid } from "@/components/ParameterGrid";
import { Badge, Button, Panel } from "@/components/ui";
import { getPatientDetail } from "@/lib/db/patients";
import { getPatientSummary } from "@/lib/db/summary";
import { getParameterGrid } from "@/lib/db/parameters";
import { PatientSummary } from "@/components/PatientSummary";
import {
  CONSENT_LABEL,
  CONSENT_TONE,
  HEALTH_LABEL,
  HEALTH_TONE,
} from "@/lib/patients/labels";
import { formatDay, formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

export const dynamic = "force-dynamic";

/** One note, as written. Repeated for the folded ones, so they read the same. */
function Note({
  note,
  timezone,
}: {
  note: { id: string; createdAt: Date; body: string; escalationNote: string | null };
  timezone: string;
}) {
  return (
    <div style={{ padding: "calc(var(--cell) * 3)", borderTop: "1px solid var(--rule)" }}>
      <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
        {formatDay(note.createdAt, timezone)}
      </p>
      <p
        className="mono measure"
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          color: "var(--print-2)",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        {note.body}
      </p>
      {note.escalationNote ? (
        <p style={{ margin: "calc(var(--cell) * 1.5) 0 0", color: "var(--print-2)", fontSize: 14 }}>
          <span className="caps" style={{ color: "var(--print-3)" }}>Escalate to me if</span>{" "}
          {note.escalationNote}
        </p>
      ) : null}
    </div>
  );
}


export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; approved?: string }>;
}) {
  const { id } = await params;
  const { created, approved } = await searchParams;
  const detail = await getPatientDetail(id);
  if (!detail) notFound();

  const summary = await getPatientSummary(id);
  /* Only for the current course: a grid spanning two plans would put two
     different sets of questions on one axis. */
  const parameters = detail.planId ? await getParameterGrid(detail.planId) : [];

  const { patient, calls } = detail;

  const planLive = ["active", "paused"].includes(detail.planStatus ?? "");
  const editable = !patient.archivedAt;

  /*
   * One primary action, chosen by state.
   *
   * It used to be a whole Panel each — "No plan yet" and "Waiting on you" —
   * wrapping a sentence and a button, above a sheet that says the same thing
   * in a badge. The button is the only part a doctor uses.
   */
  const primary =
    !editable
      ? null
      : detail.planStatus === "awaiting_approval" && detail.planId
        ? { href: `/plans/${detail.planId}`, label: "Review and approve" }
        : planLive
          ? null
          : {
              href: `/plan/new?patient=${patient.id}`,
              label: detail.planId ? "Start another follow-up" : "Write the follow-up note",
            };

  /* The newest escalation still open. The rest keep the link to Today. */
  const waiting = summary.escalations.find(
    (e) => e.status === "open" || e.status === "acknowledged",
  );

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
          <Link href="/patients" className="backlink">
            All patients
          </Link>
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
              {patient.age} · {maskPhone(patient.phoneE164)} · {patient.timezone} · {patient.language}
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

        {/*
          The actions, beside the name they act on.
          They were scattered across four panels and the page foot — the one
          primary buried inside a sheet at the top, Edit 1,800px below it. What
          is irreversible stays at the foot; what is navigation lives here.
        */}
        {editable ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              marginTop: "calc(var(--cell) * 2.5)",
            }}
          >
            {primary ? (
              <Button variant="primary" href={primary.href}>
                {primary.label}
              </Button>
            ) : null}
            {/*
              The doctor's own phone. `tel:` was on Today and nowhere here,
              though the number is printed two lines up — so the one screen that
              holds everything about a patient could not ring them.
            */}
            <Button variant="ghost" href={`tel:${patient.phoneE164}`}>
              Call {patient.name.split(" ")[0]}
            </Button>
            {detail.planId ? (
              <Button variant="ghost" href={`/plans/${detail.planId}`}>
                The whole plan
              </Button>
            ) : null}
            <Button variant="ghost" href={`/patients/${patient.id}/edit`}>
              Edit
            </Button>
          </div>
        ) : null}
      </header>

      {/*
        The acknowledgement approval never had.
        
        It used to return quietly: the panel unmounted, the headline mutated,
        and the page shrank under a doctor sitting at the bottom of it. This
        says what happened, names the first call in the patient's own zone, and
        lands them where the dated rows actually are.
      */}
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
          <span className="mono">{formatStamp(detail.startsAt, patient.timezone)}</span>, and
          every call it will place is listed below. Nothing rings before then.
        </p>
      ) : null}

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
        Where things stand — and, folded into the same sheet, what the plan is
        set to and what to do about anything waiting.

        This was three sheets: a one-line "Follow-up ended" panel wrapping a
        button, this one, and a "The plan" panel wrapping one more button and a
        badge. `COMPLETED` was printed three times on one screen — the header
        badge, a panel title and the plan's own badge — and the actions were
        more chrome than content.
      */}
      <PatientSummary
        summary={summary}
        timezone={patient.timezone}
        quietFor={detail.quietFor}
        lastHeard={detail.lastHeard}
        week={detail.week}
        reason={detail.reason}
        planLine={
          detail.planId ? (
            <>
              Daily · {detail.localTime} {patient.timezone} · up to {detail.maxAttempts}/day
              {detail.startsAt && detail.endsAt
                ? ` · ${formatDay(detail.startsAt, patient.timezone)} → ${formatDay(detail.endsAt, patient.timezone)}`
                : " · not approved yet"}
            </>
          ) : undefined
        }
        escalationActions={
          waiting && detail.planId ? (
            <QueueActions
              escalationId={waiting.id}
              planId={detail.planId}
              patientName={patient.name}
              pausedPlan={waiting.urgent}
              status={waiting.status}
              planLive={planLive}
            />
          ) : undefined
        }
        footer={
          detail.planId && planLive && editable ? (
            <>
              <TreatmentControls
                planId={detail.planId}
                patientId={patient.id}
                patientName={patient.name}
              />
              {/*
                Reviewing a patient mid-course and wanting one more thing
                watched is not a new episode. A second plan would dial the same
                person twice a day — and cannot exist anyway, since one live
                plan per patient is a unique index. This adds to the note the
                questions were compiled from, so the addition is grounded the
                same way everything else is.
              */}
              <AmendNote planId={detail.planId} live />
            </>
          ) : (
            /* How it resolved, on the episode it belongs to. It moves down to
               "Earlier follow-ups" only once a newer plan exists. */
            (() => {
              const course = summary.courses.find((c) => c.planId === detail.planId);
              return course?.closingSummary ? (
                <p
                  style={{
                    margin: 0,
                    paddingLeft: "calc(var(--cell) * 1.5)",
                    borderLeft: "2px solid var(--rule-2)",
                    color: "var(--print)",
                    fontSize: 14,
                    lineHeight: 1.6,
                    maxWidth: "72ch",
                  }}
                >
                  {course.closingSummary}
                </p>
              ) : undefined;
            })()
          )
        }
      />

      {/*
        The treatment record.
        Superseded and finished plans used to disappear from the console
        completely — their calls were retained and their result schema frozen at
        approval so they would stay readable, and nothing read them. "What were
        we treating in August" is a question a doctor asks, and until now this
        product could not answer it.
      */}
      {detail.priorPlans.length > 0 ? (
        <Panel
          title="Earlier follow-ups"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {detail.priorPlans.length}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {detail.priorPlans.map((p) => {
              const course = summary.courses.find((c) => c.planId === p.id);
              return (
              <li
                key={p.id}
                style={{
                  padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 2.5)",
                  borderBottom: "1px solid var(--rule-2)",
                }}
              >
               <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "calc(var(--cell) * 2)",
                }}
               >
                <Link
                  href={`/plans/${p.id}`}
                  style={{
                    color: "var(--print)",
                    fontWeight: 700,
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    textDecorationColor: "var(--rule)",
                  }}
                >
                  {p.reason}
                </Link>
                {/* Why it ended, not just that it did. `superseded` and
                    `clinician_closed` are different clinical facts. */}
                <Badge tone="plain" quiet>
                  {p.closeReason === "superseded"
                    ? "Replaced by a later plan"
                    : p.closeReason === "clinician_closed"
                      ? "Finished by you"
                      : p.closeReason === "duration_elapsed"
                        ? "Window closed"
                        : p.status}
                </Badge>
                {/* What the course actually achieved. The rows were retained
                    and the result schema frozen at approval precisely so a
                    superseded plan stayed readable, and nothing read it. */}
                {course && course.calls > 0 ? (
                  <span className="mono" style={{ fontSize: 13, color: "var(--print-2)" }}>
                    {course.reached}/{course.calls} answered
                  </span>
                ) : null}
                <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                  {p.startsAt ? formatDay(p.startsAt, patient.timezone) : "never started"}
                  {p.closedAt ? ` → ${formatDay(p.closedAt, patient.timezone)}` : ""}
                </span>
               </div>

                {/*
                  How it resolved, in the clinician's own words.
                  The reason this record exists: everything else on the row is
                  machinery — how many calls, which dates, why it stopped — and
                  none of it says whether the patient got better. It is printed
                  rather than hidden behind the link, because a doctor seeing
                  this patient again needs it before they decide anything.
                */}
                {course?.closingSummary ? (
                  <p
                    style={{
                      margin: "calc(var(--cell) * 1) 0 0",
                      paddingLeft: "calc(var(--cell) * 1.5)",
                      borderLeft: "2px solid var(--rule-2)",
                      color: "var(--print)",
                      fontSize: 14,
                      lineHeight: 1.6,
                      maxWidth: "72ch",
                    }}
                  >
                    {course.closingSummary}
                  </p>
                ) : null}
              </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}


      {/*
        What they said, before the calls that produced it.

        The week band two panels up says whether we reached her; this says
        whether the thing we were watching moved. Until now the product could
        answer the first question and not the second — which is the one a course
        of follow-up exists to ask.
      */}
      {parameters.length > 0 ? (
        <Panel
          title="Day by day"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {parameters.length} {parameters.length === 1 ? "parameter" : "parameters"}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <ParameterGrid rows={parameters} />
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
        <CallLog calls={calls} maxAttempts={detail.maxAttempts} timezone={patient.timezone} />
      </Panel>

      {summary.notes.length > 0 ? (
        <Panel
          title={summary.notes.length === 1 ? "The note" : "Notes"}
          aside={
            summary.notes.length > 1 ? (
              <span className="caps mono" style={{ color: "var(--print-3)" }}>
                {summary.notes.length}
              </span>
            ) : undefined
          }
          style={{ marginBottom: "calc(var(--cell) * 3)" }}
        >
          {/*
            All of them, newest first. One note can produce several plan
            versions and a patient can have several courses of treatment, and
            only the current plan's note was ever reachable — so the reason a
            follow-up was started three weeks ago simply vanished. `idx_notes_patient`
            was built for exactly this read and nothing performed it.
          */}
          {summary.notes.slice(0, 1).map((n) => (
            <Note key={n.id} note={n} timezone={patient.timezone} />
          ))}

          {/*
            The rest folded away. An amendment appends rather than replaces, so
            two near-identical notes print in full one under the other — ~250px
            each of the same paragraph, on a page a doctor opens to read
            outcomes.
          */}
          {summary.notes.length > 1 ? (
            <details className="disclosure">
              <summary>
                {summary.notes.length - 1} earlier{" "}
                {summary.notes.length === 2 ? "note" : "notes"}
              </summary>
              {summary.notes.slice(1).map((n) => (
                <Note key={n.id} note={n} timezone={patient.timezone} />
              ))}
            </details>
          ) : null}
        </Panel>
      ) : null}

      {!patient.archivedAt ? (
        <PatientControls
          id={patient.id}
          name={patient.name}
          hasPendingCalls={calls.some((c) =>
            ["scheduled", "claimed", "dialing"].includes(c.status),
          )}
          planId={detail.planId}
          paused={detail.planStatus === "paused"}
          pausedReason={detail.pausedReason}
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 2)",
            alignItems: "center",
          }}
        >
          <span style={{ color: "var(--bench-ink-3)", fontSize: 14, maxWidth: "56ch" }}>
            Archived. History kept, nothing dialled.
          </span>
        </div>
      )}
    </div>
  );
}
