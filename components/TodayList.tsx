"use client";

/**
 * Follow-ups: how each patient is doing, as a list you scan.
 *
 * Condition, not logistics. The rows used to carry the call ladder — last call,
 * attempt 2 of 3, a failure code, the next call time, "4d quiet" — so the
 * doctor's first screen answered "how is she?" with a timetable. That detail
 * still lives on the patient record's Calls panel. Here a row is: how she is,
 * who, and the one clause that says why — in her own words when there are any.
 *
 * The one silence that matters is kept, as a status: a patient nobody has
 * reached is "Needs attention: not heard from in 4 days", a clinical fact, not
 * a scheduling line.
 *
 * One row is open at a time, and the page opens on the most urgent patient:
 * the first thing a doctor sees is the person who needs them, with the action
 * already in reach — and one open row means one amber button on the page.
 *
 * No phone number is printed. A patient who needs attention can be rung from
 * the doctor's own phone (`tel:`), and nobody else's number reaches this page.
 */

import { useState } from "react";

import { Badge, Button, type Tone } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import { CloseFile } from "@/components/CloseFile";
import type { TodayRow } from "@/lib/db/dashboard";
import { CLINICAL_STATUS_LABEL, type ClinicalStatus } from "@/lib/triage/status";
import { formatStamp } from "@/lib/format";

/** Red for attention only. Finished and drafts inform; no word yet is quiet. */
const STATUS_TONE: Record<ClinicalStatus, Tone> = {
  needs_attention: "danger",
  finished: "info",
  no_concerns: "clear",
  no_word_yet: "plain",
};

/** A draft is a decision waiting on the doctor, not a clinical state. */
const isDraft = (row: TodayRow) => row.planStatus === "awaiting_approval";

/**
 * The one clause the closed row shows.
 *
 * The patient's own words first: they are short, they are evidence. Then the
 * condition summary, cut at its first sentence. Then the reason for the status,
 * so a row is never blank.
 */
function lede(row: TodayRow): string {
  if (row.quote) return row.quote;
  if (row.conditionSummary) {
    const first = row.conditionSummary.split(/(?<=\.)\s/)[0] ?? row.conditionSummary;
    return first.length > 96 ? `${first.slice(0, 95).trimEnd()}…` : first;
  }
  return row.statusReason;
}

function Row({
  row,
  open,
  onToggle,
}: {
  row: TodayRow;
  open: boolean;
  onToggle: () => void;
}) {
  const draft = isDraft(row) && row.status !== "needs_attention";
  const tone: Tone = draft ? "info" : STATUS_TONE[row.status];
  const label = draft ? "Plan to review" : CLINICAL_STATUS_LABEL[row.status];
  const firstName = row.name.split(" ")[0];
  const live = row.planStatus === "active" || row.planStatus === "paused";

  return (
    <li style={{ borderBottom: "1px solid var(--rule-2)", background: "var(--label)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="today-row">
        <span style={{ width: "calc(var(--cell) * 21)", flexShrink: 0 }}>
          <Badge tone={tone} quiet={tone !== "danger"}>
            {label}
          </Badge>
        </span>

        <span className="today-name" style={{ width: "calc(var(--cell) * 20)", flexShrink: 0 }}>
          {row.name}
          <span className="mono today-age"> {row.age}</span>
        </span>

        <span className="today-lede" style={{ color: "var(--print-2)" }}>
          {lede(row)}
        </span>
      </button>

      {open ? (
        <div className="today-open">
          <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
            {row.statusReason}
          </p>

          {/* How she is doing, in the last reading's words. A draft has none yet. */}
          {!draft ? (
            <p className="measure today-summary">
              {row.conditionSummary ??
                "No reading yet — nothing has been heard from this patient on this follow-up."}
            </p>
          ) : null}
          {row.summaryUnavailable ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", fontSize: 13, color: "var(--print-2)" }}>
              The latest call could not be read by the assistant
              {row.conditionSummary ? ", so the summary above is older than it" : ""}. Read the
              call yourself.
            </p>
          ) : null}
          {row.conditionSummaryAt ? (
            <p className="mono" style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 12, color: "var(--print-3)" }}>
              As of {formatStamp(row.conditionSummaryAt, row.timezone)}
            </p>
          ) : null}

          {row.matchedConcerns.length > 0 ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 14 }}>
              <span style={{ color: "var(--print-3)", fontWeight: 600 }}>Matched your note: </span>
              <span style={{ color: "var(--print)" }}>{row.matchedConcerns.join(" · ")}</span>
            </p>
          ) : null}

          {/*
            What the doctor can do, by status: attend to someone in trouble,
            approve a plan waiting on them, review a follow-up that is running,
            or close the file of someone who is done. Nothing about the call
            schedule.
          */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
            {row.status === "needs_attention" && !row.escalationId && row.emergencyPhone ? (
              <Button
                variant="primary"
                href={`tel:${row.emergencyPhone}`}
                ariaLabel={`Phone ${row.name} from your own phone`}
              >
                Phone {firstName} yourself
              </Button>
            ) : null}

            {draft ? (
              <Button variant="primary" href={`/plans/${row.planId}`}>
                Review and approve
              </Button>
            ) : null}

            {row.status === "finished" ? (
              <>
                <CloseFile planId={row.planId} patientId={row.patientId} patientName={row.name} finished />
                <Button variant="onLabel" href={`/register?patient=${row.patientId}`}>
                  Restart follow-up
                </Button>
              </>
            ) : null}

            {!draft && (row.status === "no_concerns" || row.status === "no_word_yet") ? (
              <Button variant="onLabel" href={`/plans/${row.planId}`}>
                Review follow-up
              </Button>
            ) : null}

            {row.status === "no_concerns" && live ? (
              <CloseFile planId={row.planId} patientId={row.patientId} patientName={row.name} finished={false} />
            ) : null}

            {row.lastCallId ? (
              <Button variant="onLabel" href={`/calls/${row.lastCallId}`}>
                Read the call
              </Button>
            ) : null}
            <Button variant="onLabel" href={`/patients/${row.patientId}`}>
              Patient record
            </Button>
          </div>

          {row.escalationId ? (
            <div className="today-queue">
              <QueueActions
                escalationId={row.escalationId}
                planId={row.planId}
                patientName={row.name}
                phoneE164={row.emergencyPhone ?? undefined}
                pausedPlan={row.pausedPlan}
                status={row.escalationStatus ?? "open"}
                planLive={live}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/*
 * The bands, in the order the doctor should look. A patient in trouble comes
 * first, always; a plan waiting for approval is next — it is the doctor's
 * decision, but nobody is in trouble while it waits.
 */
const BANDS: { key: string; label: string; tone: string; match: (r: TodayRow) => boolean }[] = [
  {
    key: "needs_attention",
    label: "Needs attention",
    tone: "needs",
    match: (r) => r.status === "needs_attention",
  },
  {
    key: "approval",
    label: "Waiting for your approval",
    tone: "finished",
    match: (r) => r.status !== "needs_attention" && isDraft(r),
  },
  {
    key: "finished",
    label: "Finished — close the file or restart",
    tone: "finished",
    match: (r) => r.status === "finished",
  },
  {
    key: "no_word_yet",
    label: "No word yet",
    tone: "waiting",
    match: (r) => r.status === "no_word_yet" && !isDraft(r),
  },
  {
    key: "no_concerns",
    label: "No concerns raised",
    tone: "running",
    match: (r) => r.status === "no_concerns",
  },
];

export function TodayList({ rows, clearedToday }: { rows: TodayRow[]; clearedToday: number }) {
  /* One open row, starting on the most urgent patient. */
  const [openId, setOpenId] = useState<string | null>(
    () => rows.find((r) => r.status === "needs_attention")?.patientId ?? null,
  );

  return (
    /*
      `minmax(0, 1fr)`, not `1fr`. A grid item's default `min-width: auto`
      refuses to shrink below its content, so a long clause pushed the whole
      sheet wider than the phone and the page scrolled sideways.
    */
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "calc(var(--cell) * 2)",
      }}
    >
      {BANDS.map(({ key, label, tone, match }) => {
        const group = rows.filter(match);
        if (group.length === 0) return null;
        return (
          <section key={key} className="sheet">
            <h2 className="today-band" data-tone={tone}>
              <span className="today-band-label">{label}</span>
              <span className="mono today-band-count">{group.length}</span>
            </h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {group.map((row) => (
                <Row
                  key={row.patientId}
                  row={row}
                  open={openId === row.patientId}
                  onToggle={() => setOpenId((id) => (id === row.patientId ? null : row.patientId))}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* A cleared board reads as work done rather than as an empty screen. */}
      {clearedToday > 0 ? (
        <footer className="sheet perf-x today-foot">
          <span className="today-foot-end">
            <span className="mono">{clearedToday}</span>{" "}
            {clearedToday === 1 ? "escalation" : "escalations"} settled today
          </span>
        </footer>
      ) : null}
    </div>
  );
}
