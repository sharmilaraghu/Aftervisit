/**
 * One patient, for the front desk.
 *
 * Contact details, consent, when the next call goes out, the call log, and the
 * controls that are the desk's to use — edit, book a visit, stop calls, delete.
 * The clinical reading of the follow-up (how the patient is doing, what they
 * answered, what needs deciding) is the doctor's, at /followups/[id]; here an
 * open escalation is one line saying it is with the doctor, with no content a
 * receptionist might pass on and no control to close it.
 */

import { notFound } from "next/navigation";

import { CallLog } from "@/components/CallLog";
import { PatientControls } from "@/components/PatientControls";
import { Badge, Breadcrumb, Button, Panel } from "@/components/ui";
import { getPatientDetail } from "@/lib/db/patients";
import { getPatientSummary } from "@/lib/db/summary";
import { readConfig } from "@/lib/config";
import { CONSENT_LABEL, CONSENT_TONE, HEALTH_LABEL } from "@/lib/patients/labels";
import { formatDay, formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import { languageLabel } from "@/lib/patients/languages";

export const dynamic = "force-dynamic";

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

  const summary = await getPatientSummary(id);
  const { patient, calls } = detail;
  const live = detail.planStatus === "active" || detail.planStatus === "paused";
  const editable = !patient.archivedAt;
  const waiting = summary.escalations.find((e) => e.status === "open" || e.status === "acknowledged");
  const now = new Date();
  const nextCall = calls
    .filter((c) => c.status === "scheduled" && c.scheduledFor > now)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())[0];

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <Breadcrumb items={[{ label: "Patients", href: "/patients" }, { label: patient.name }]} />
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
              style={{ fontSize: "clamp(28px, 3.2vw, 40px)", margin: "0 0 calc(var(--cell) * 1)", color: "var(--bench-ink)" }}
            >
              {patient.name}
            </h1>
            <p style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 15 }}>
              <span className="mono">{patient.age}</span> ·{" "}
              <span className="mono">{maskPhone(patient.phoneE164)}</span> · {patient.timezone} ·{" "}
              {languageLabel(patient.language)}
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1)", alignItems: "center" }}>
            {patient.archivedAt ? <Badge tone="plain" quiet>Archived</Badge> : null}
            <Badge tone={CONSENT_TONE[patient.aiCallConsent]} quiet>
              {CONSENT_LABEL[patient.aiCallConsent]}
            </Badge>
            {/* Quiet: the desk reads the state, it does not act on it. */}
            <Badge tone="plain" quiet>
              {detail.health ? HEALTH_LABEL[detail.health] : "No plan yet"}
            </Badge>
          </div>
        </div>

        {editable ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", marginTop: "calc(var(--cell) * 2.5)" }}>
            {!live && detail.planStatus !== "awaiting_approval" ? (
              <Button variant="primary" href={`/register?patient=${patient.id}`}>
                {detail.planId ? "Book another visit" : "Book a visit"}
              </Button>
            ) : null}
            <Button variant="ghost" href={`tel:${patient.phoneE164}`}>
              Phone {patient.name.split(" ")[0]} yourself
            </Button>
            <Button variant="ghost" href={`/patients/${patient.id}/edit`}>
              Edit
            </Button>
          </div>
        ) : null}
      </header>

      {created ? (
        <p
          role="status"
          style={{
            margin: "0 0 calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 2)",
            background: "var(--clear-wash)",
            boxShadow: "inset 0 0 0 1px var(--clear)",
            color: "var(--print)",
            fontSize: 15,
          }}
        >
          <strong>{patient.name} added.</strong> They will not be called until a follow-up plan
          has been written and the doctor has approved it.
        </p>
      ) : null}

      {/* The follow-up, as the desk needs it: what, when, and who has it. */}
      <Panel title="Follow-up" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
        <dl
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 2) calc(var(--cell) * 5)",
            margin: 0,
            padding: "calc(var(--cell) * 3)",
          }}
        >
          {([
            ["Following up on", detail.reason ?? "No plan yet", false],
            [
              "Next call",
              detail.planStatus === "paused"
                ? "none — paused"
                : nextCall
                  ? formatStamp(nextCall.scheduledFor, patient.timezone)
                  : live
                    ? "none scheduled"
                    : "—",
              true,
            ],
            [
              "Window",
              detail.startsAt && detail.endsAt
                ? `${formatDay(detail.startsAt, patient.timezone)} → ${formatDay(detail.endsAt, patient.timezone)}`
                : detail.planStatus === "awaiting_approval"
                  ? "waiting for the doctor's approval"
                  : "—",
              true,
            ],
          ] as [string, string, boolean][]).map(([label, value, mono]) => (
            <div key={label}>
              <dt className="caps" style={{ color: "var(--print-3)", marginBottom: 2 }}>
                {label}
              </dt>
              <dd className={mono ? "mono" : undefined} style={{ margin: 0, fontSize: 15, color: "var(--print)" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {/* One line, no clinical content: the doctor decides this, not the desk. */}
        {waiting ? (
          <p
            style={{
              margin: 0,
              padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 3)",
              borderTop: "1px solid var(--rule)",
              background: "var(--label-2)",
              fontSize: 14,
              color: "var(--print)",
            }}
          >
            With {readConfig().clinicianName} since{" "}
            <span className="mono">{formatDay(waiting.raisedAt, patient.timezone)}</span>
            {detail.planStatus === "paused" ? " — calls are paused until the doctor decides." : "."}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Calls"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {calls.length} {calls.length === 1 ? "call" : "calls"}
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 3)" }}
      >
        {/* Outcomes only: what the patient said is the doctor's to read. */}
        <CallLog calls={calls} maxAttempts={detail.maxAttempts} timezone={patient.timezone} showSaid={false} />
      </Panel>

      {editable ? (
        <PatientControls
          id={patient.id}
          name={patient.name}
          hasPendingCalls={calls.some((c) => ["scheduled", "claimed", "dialing"].includes(c.status))}
          planId={detail.planId}
          paused={detail.planStatus === "paused"}
          pausedReason={detail.pausedReason}
          escalationOpen={Boolean(waiting)}
        />
      ) : (
        <span style={{ color: "var(--bench-ink-3)", fontSize: 14 }}>
          Archived. History kept, nothing dialled.
        </span>
      )}
    </div>
  );
}
