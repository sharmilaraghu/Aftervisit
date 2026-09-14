/**
 * One patient, for the doctor.
 *
 * The one place a doctor reads a running follow-up, in the order they need it:
 * what needs deciding, how the patient is doing, whether we are reaching them,
 * then the follow-up itself — what the calls set out to find out, each with the
 * words in the note it came from and the patient's latest answer.
 *
 * There is no plan to review. The doctor saved the note and pressed start; this
 * page is where they land, and it says plainly what was read from the note and
 * what code filled in.
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
import { CallLog } from "@/components/CallLog";
import { CallSchedule } from "@/components/CallSchedule";
import { getPatientDetail } from "@/lib/db/patients";
import { getPatientSummary } from "@/lib/db/summary";
import { getParameterGrid } from "@/lib/db/parameters";
import { getPlanForReview } from "@/lib/db/plans";
import { getLatestReading, getTopicFindings } from "@/lib/db/followup";
import { getTriage } from "@/lib/db/triage";
import { getWaitingVisits } from "@/lib/db/visits";
import { HEALTH_LABEL } from "@/lib/patients/labels";
import { languageLabel } from "@/lib/patients/languages";
import { maskPhone } from "@/lib/phone/normalize";
import { whatChanged } from "@/lib/patients/parameters";
import { readConfig } from "@/lib/config";
import { UNIT_LABEL } from "@/lib/plan/result-schema";
import { formatDay, formatStamp } from "@/lib/format";
import { localDate } from "@/lib/time/clock";

export const dynamic = "force-dynamic";

/* Why something the note asked about is not on the calls, in the doctor's terms. */
const DROPPED_WHY: Record<string, string> = {
  not_in_note: "these words were not found in your note",
  unrelated: "it did not match your words",
  guard: "it read as advice or an instruction, which the calls never carry",
  over_cap: "the calls follow up five things at most",
};

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
  searchParams: Promise<{ started?: string }>;
}) {
  const { patientId } = await params;
  const { started } = await searchParams;
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
  const topics = plan ? await getTopicFindings(plan.id, plan.watchPoints) : [];

  const live = detail.planStatus === "active" || detail.planStatus === "paused";
  const draft = detail.planStatus === "awaiting_approval";
  const firstName = patient.name.split(" ")[0];
  const openFlags = summary.escalations.filter((e) => e.status === "open" || e.status === "acknowledged");
  const waiting = openFlags[0];
  /* What made the call alarming — which of the doctor's own conditions it
     touched and the patient's words — lived only on the call page, so the
     decision block said "severe" without saying why. */
  const flagTriage = waiting?.callId ? await getTriage(waiting.callId) : null;
  const now = new Date();
  const nextCall = detail.calls
    .filter((c) => c.status === "scheduled" && c.scheduledFor > now)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())[0];
  const course = summary.courses.find((c) => c.planId === planId);

  /* Split once: what is still to ring leads the page; what already happened is the log. */
  const upcoming = detail.calls
    .filter((c) => c.status === "scheduled")
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  const history = detail.calls.filter((c) => c.status !== "scheduled");

  /*
   * The calling plan, counted by day rather than by attempt: a retry is the
   * same planned call trying again, not another call the doctor asked for —
   * and a try is an extra call, not a day of the plan at all.
   */
  const days = new Map<number, string[]>();
  for (const c of detail.calls.filter((x) => x.kind === "planned")) {
    days.set(c.occurrence, [...(days.get(c.occurrence) ?? []), c.status]);
  }
  const dayStates = [...days.values()];
  const toCome = dayStates.filter((s) => s.some((x) => ["scheduled", "claimed", "dialing"].includes(x))).length;
  const skipped = dayStates.filter((s) => s.every((x) => x === "skipped")).length;
  const done = dayStates.length - toCome - skipped;

  /* After a start the doctor's next move is the next patient. */
  const next = started
    ? (await getWaitingVisits()).find(
        (v) => v.patientId !== patient.id && v.visitDate <= localDate(new Date(), v.timezone),
      )
    : undefined;

  /*
   * Why nothing would ring, said at the moment the doctor believes it will.
   * The port refuses these dials anyway; this only stops the refusal being a
   * surprise tomorrow morning.
   */
  const config = readConfig();
  const blocked =
    patient.aiCallConsent !== "granted"
      ? `${firstName} has not agreed to automated calls on their record, so none will be placed until the desk records that they have.`
      : !config.liveCallsEnabled
        ? "Calls are switched off on this instance, so none will be placed."
        : !config.allowlistOpen && !config.callAllowlist.includes(patient.phoneE164)
          ? "This instance's dial allowlist does not include this number, so no call will be placed."
          : null;

  const peak = whatChanged(rows).changed[0];
  const fromNote = (field: "durationDays" | "startAfterDays" | "cadence" | "localTime") =>
    plan?.provenance[field] === "note" ? plan.scheduleQuotes[field] : undefined;

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
          {/* Not while the decision block is showing: it carries the same button. */}
          {!waiting ? (
            <Button variant="ghost" href={`tel:${patient.phoneE164}`} ariaLabel={`Phone ${patient.name} from your own phone`}>
              Phone {firstName} yourself
            </Button>
          ) : null}
        </div>
      </header>

      {started && plan && live ? (
        <div
          role="status"
          style={{
            margin: "0 0 calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 2)",
            background: blocked ? "var(--amber-wash)" : "var(--clear-wash)",
            boxShadow: `inset 0 0 0 1px var(--${blocked ? "amber" : "clear"})`,
            color: "var(--print)",
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Follow-up started.</strong>{" "}
            {detail.startsAt ? (
              <>
                First call <span className="mono">{formatStamp(detail.startsAt, patient.timezone)}</span> ·{" "}
              </>
            ) : null}
            {plan.durationDays === 1 && plan.startAfterDays > 0 ? (
              <>
                one call, <span className="mono">{plan.startAfterDays}</span> day{plan.startAfterDays === 1 ? "" : "s"} from now
                {fromNote("startAfterDays") ? " (from your note)." : "."}
              </>
            ) : (
              <>
                {(CADENCE[plan.cadence] ?? plan.cadence).toLowerCase()} for{" "}
                <span className="mono">{plan.durationDays}</span> day{plan.durationDays === 1 ? "" : "s"}
                {plan.startAfterDays > 0 ? <>, starting in <span className="mono">{plan.startAfterDays}</span> days</> : null}
                {fromNote("durationDays") ? " (from your note)." : " (the default — your note did not say how long)."}
              </>
            )}
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
          {blocked ? <p style={{ margin: "calc(var(--cell) * 1) 0 0" }}>{blocked}</p> : null}
        </div>
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
            {flagTriage && flagTriage.matchedConcerns.length > 0 ? (
              <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 15 }}>
                <span style={{ color: "var(--print-3)" }}>Matches your note: </span>
                <span style={{ color: "var(--print)", fontWeight: 600 }}>{flagTriage.matchedConcerns.join(" · ")}</span>
              </p>
            ) : null}
            {flagTriage && flagTriage.keyTerms.length > 0 ? (
              <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 15 }}>
                <span style={{ color: "var(--print-3)" }}>What they said: </span>
                <span style={{ color: "var(--print)" }}>
                  {flagTriage.keyTerms.map((t) => `“${t}”`).join(" · ")}
                </span>
              </p>
            ) : null}
            {openFlags.length > 1 ? (
              <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 14, color: "var(--print-2)" }}>
                {openFlags.length - 1} earlier flag{openFlags.length === 2 ? " is" : "s are"} also open — see the calls below.
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

      {/*
        When the assistant rings next, each call movable — and a call placed now.
        Up here rather than under the write-up: straight after a start, "when
        does it ring?" is the doctor's first question, and it used to be answered
        at the bottom of the page in a table nobody could change.
      */}
      {plan && live ? (
        <section id="schedule">
          <Panel title="Calling schedule" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
            <CallSchedule
              planId={plan.id}
              patientId={patient.id}
              patientName={patient.name}
              maskedPhone={maskPhone(patient.phoneE164)}
              language={languageLabel(patient.language)}
              timezone={patient.timezone}
              maxAttempts={plan.maxAttempts}
              upcoming={upcoming}
              paused={detail.planStatus === "paused"}
              blocked={blocked}
            />
          </Panel>
        </section>
      ) : null}

      {/* 4 — the follow-up itself: what the calls find out, and when. */}
      {plan && !draft ? (
        <section id="plan">
          <Panel title="The follow-up" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
            <div style={{ padding: "calc(var(--cell) * 3)" }}>
              <p className="measure" style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--print)" }}>
                {plan.goal}
              </p>
              <p className="mono" style={{ margin: "calc(var(--cell) * 1.5) 0 0", fontSize: 14, color: "var(--print)" }}>
                {CADENCE[plan.cadence] ?? plan.cadence} · {plan.localTime} · {plan.durationDays} day
                {plan.durationDays === 1 ? "" : "s"} · up to {plan.maxAttempts} tries a day
                {plan.startsAt && plan.endsAt
                  ? ` · ${formatDay(plan.startsAt, patient.timezone)} → ${formatDay(plan.endsAt, patient.timezone)}`
                  : ""}
              </p>
              <p style={{ margin: "calc(var(--cell) * 0.5) 0 0", fontSize: 13, color: "var(--print-3)" }}>
                {fromNote("startAfterDays") ? <>Wait from your note, &ldquo;{fromNote("startAfterDays")}&rdquo; · </> : null}
                {fromNote("durationDays") ? <>Length from your note, &ldquo;{fromNote("durationDays")}&rdquo;</> : "Length is the default"}
                {" · "}
                {fromNote("cadence") ? <>how often from your note, &ldquo;{fromNote("cadence")}&rdquo;</> : "how often is the default"}
                {" · "}
                {fromNote("localTime") ? <>time from your note, &ldquo;{fromNote("localTime")}&rdquo;</> : "time is the default"}
              </p>

              <h3 className="caps" style={{ margin: "calc(var(--cell) * 3) 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
                What the calls find out
              </h3>
              {topics.length > 0 ? (
                <ol style={{ margin: 0, paddingLeft: "calc(var(--cell) * 3)" }}>
                  {topics.map((t) => (
                    <li key={t.topic} style={{ marginBottom: "calc(var(--cell) * 1.75)", fontSize: 15, color: "var(--print)" }}>
                      <span style={{ fontWeight: 600 }}>{t.topic}</span>
                      <span style={{ display: "block", fontSize: 13, color: "var(--print-3)" }}>
                        From your note: &ldquo;{t.quote}&rdquo;
                      </span>
                      {t.value !== null || t.answer || t.patientWords ? (
                        <span className="measure" style={{ display: "block", marginTop: 4, fontSize: 14, lineHeight: 1.5 }}>
                          {t.value !== null ? (
                            <span className="mono" style={{ fontSize: 17, fontWeight: 700, marginRight: 8 }}>
                              {t.value}
                              {t.unit ? (t.unit === "score_0_10" ? "/10" : ` ${UNIT_LABEL[t.unit]}`) : ""}
                            </span>
                          ) : null}
                          {t.value !== null && t.answer ? " " : null}
                          {t.answer ?? ""}
                          {t.patientWords ? <> — &ldquo;{t.patientWords}&rdquo;</> : null}
                          {t.clarity === "unclear" ? " · unclear" : ""}
                          {t.at ? (
                            <span className="mono" style={{ color: "var(--print-3)" }}>
                              {" · "}
                              {formatStamp(t.at, patient.timezone)}
                            </span>
                          ) : null}
                          {t.callId ? (
                            <>
                              {" · "}
                              <Link href={`/calls/${t.callId}`} style={{ color: "var(--print)", textUnderlineOffset: 3 }}>
                                Read the call
                              </Link>
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <span style={{ display: "block", marginTop: 4, fontSize: 14, color: "var(--print-2)" }}>
                          Not discussed on a call yet
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="measure" style={{ margin: 0, fontSize: 14, color: "var(--print-2)" }}>
                  Your note named nothing specific, so the calls ask how {firstName} has been since the visit.
                </p>
              )}
              {plan.droppedTopics.length > 0 ? (
                <div className="measure" style={{ margin: "calc(var(--cell) * 1.5) 0 0", fontSize: 13, color: "var(--print-2)" }}>
                  <span className="caps" style={{ color: "var(--print-3)" }}>Not followed up</span>
                  <ul style={{ margin: "calc(var(--cell) * 0.5) 0 0", paddingLeft: "calc(var(--cell) * 3)" }}>
                    {plan.droppedTopics.map((d) => (
                      <li key={`${d.text}-${d.why}`}>
                        &ldquo;{d.quote || d.text}&rdquo; — {DROPPED_WHY[d.why] ?? "not followed up"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="measure" style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 13, color: "var(--print-3)" }}>
                The assistant asks in its own words. Every call also checks for anything urgent and whether{" "}
                {firstName} wants to speak to the care team.
              </p>

              {!live ? (
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

              {live ? (
                /*
                  What to do next with this follow-up, said plainly. Adding to it
                  re-reads the note onto the follow-up already running; a new
                  follow-up starts from a fresh visit and note, and starting it
                  ends this one; ending it stops the remaining calls.
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

          {/* Every call the assistant has made, dated. While the follow-up runs, the calls
              still to come are in the schedule above rather than repeated here. */}
          <Panel title={live ? "Calls placed" : "Calling plan"} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
            {detail.calls.length > 0 ? (
              <p style={{ margin: 0, padding: "calc(var(--cell) * 2) calc(var(--cell) * 3) 0", fontSize: 14, color: "var(--print-2)" }}>
                <span className="mono" style={{ color: "var(--print)" }}>{dayStates.length}</span> call
                {dayStates.length === 1 ? "" : "s"} planned ·{" "}
                <span className="mono" style={{ color: "var(--print)" }}>{done}</span> done ·{" "}
                <span className="mono" style={{ color: "var(--print)" }}>{toCome}</span>{" "}
                {detail.planStatus === "paused" ? "on hold while paused" : "to come"}
                {skipped > 0 ? (
                  <>
                    {" "}· <span className="mono" style={{ color: "var(--print)" }}>{skipped}</span> skipped
                  </>
                ) : null}
              </p>
            ) : null}
            {live && history.length === 0 ? (
              <p style={{ margin: 0, padding: "calc(var(--cell) * 2) calc(var(--cell) * 3) calc(var(--cell) * 3)", fontSize: 14, color: "var(--print-2)" }}>
                No calls have been placed yet. The schedule above shows when the first one rings.
              </p>
            ) : (
              <CallLog calls={live ? history : detail.calls} maxAttempts={detail.maxAttempts} timezone={patient.timezone} />
            )}
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
