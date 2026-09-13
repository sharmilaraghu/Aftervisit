"use client";

/**
 * Follow-ups: how each patient is doing, as a list you scan.
 *
 * Condition, not logistics. A closed row is who, and the one clause that says
 * how they are — in their own words when there are any. The band above says
 * the status, so the row does not repeat it in a badge.
 *
 * An open row says only what the doctor needs: why (when there is a concrete
 * reason), how the patient is, whether calls are paused, where the call and
 * the patient's page are — as text links — and at most two buttons. For a
 * patient who needs attention those are the doctor's own phone first, then the
 * decision once they have spoken to them.
 *
 * One row is open at a time, and the page opens on the most urgent patient.
 * No phone number is printed; `tel:` rings from the doctor's own phone.
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import { CloseFile } from "@/components/CloseFile";
import { ResumeCalls } from "@/components/ResumeCalls";
import type { TodayRow } from "@/lib/db/dashboard";
import { formatStamp } from "@/lib/format";

/** A draft is a decision waiting on the doctor, not a clinical state. */
const isDraft = (row: TodayRow) => row.planStatus === "awaiting_approval";

/*
 * Reasons that name where a flag came from rather than why. "Read by the
 * assistant" is the escalation label when only the call reader raised it; the
 * quote and summary already say why, so the line is dropped rather than shown.
 */
const NOT_A_REASON = new Set(["Read by the assistant", "Raised for a clinician"]);

function reasonLine(row: TodayRow): string | null {
  if (row.status !== "needs_attention") return null;
  if (NOT_A_REASON.has(row.statusReason)) return null;
  if (row.statusReason === "Could not be read") return "The call couldn't be understood — read it.";
  return row.statusReason;
}

/**
 * The one clause the closed row shows: the patient's own words, else the
 * summary's first sentence, else the reason.
 */
function lede(row: TodayRow): string {
  if (row.quote) return `“${row.quote}”`;
  if (row.conditionSummary) {
    const first = row.conditionSummary.split(/(?<=\.)\s/)[0] ?? row.conditionSummary;
    return first.length > 96 ? `${first.slice(0, 95).trimEnd()}…` : first;
  }
  if (isDraft(row)) return "Plan waiting for your approval";
  return row.statusReason;
}

const LINK = { color: "var(--print)", textUnderlineOffset: 3 };

function Row({ row, open, onToggle }: { row: TodayRow; open: boolean; onToggle: () => void }) {
  const draft = isDraft(row) && row.status !== "needs_attention";
  const firstName = row.name.split(" ")[0];
  const live = row.planStatus === "active" || row.planStatus === "paused";
  const reason = reasonLine(row);

  return (
    <li style={{ borderBottom: "1px solid var(--rule-2)", background: "var(--label)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="today-row">
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
          {reason ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1)", fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
              {reason}
            </p>
          ) : null}

          {!draft && row.conditionSummary ? (
            <p className="measure today-summary">{row.conditionSummary}</p>
          ) : null}
          {row.summaryUnavailable ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1)", fontSize: 14, color: "var(--print-2)" }}>
              The latest call couldn&rsquo;t be read by the assistant — read it yourself.
            </p>
          ) : null}
          {/* The plan's own state, not the escalation's: a plan the desk
              stopped is paused too, and used to look merely quiet here. */}
          {row.planStatus === "paused" ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1)", fontSize: 14, color: "var(--print)" }}>
              Calls to {firstName} are paused.
            </p>
          ) : null}
          {row.matchedConcerns.length > 0 ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1)", fontSize: 14 }}>
              <span style={{ color: "var(--print-3)" }}>Matches your note: </span>
              <span style={{ color: "var(--print)" }}>{row.matchedConcerns.join(" · ")}</span>
            </p>
          ) : null}

          {/* Where to read more: text links, not buttons. */}
          <p style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 14, color: "var(--print-3)" }}>
            {row.lastCallId ? (
              <>
                {row.conditionSummaryAt ? (
                  <>
                    Call <span className="mono">{formatStamp(row.conditionSummaryAt, row.timezone)}</span> —{" "}
                  </>
                ) : null}
                <Link href={`/calls/${row.lastCallId}`} style={LINK}>
                  Read the call
                </Link>
              </>
            ) : null}
          </p>

          {/* At most two buttons, by status. */}
          {row.status === "needs_attention" && row.escalationId ? (
            <QueueActions
              escalationId={row.escalationId}
              planId={row.planId}
              patientName={row.name}
              phoneE164={row.emergencyPhone ?? undefined}
              pausedPlan={row.pausedPlan}
              planLive={live}
              recordHref={`/followups/${row.patientId}`}
            />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
              {/* A paused plan is never stuck here: whatever paused it — an
                  escalation handled elsewhere, or the desk's Stop all calls —
                  this is where it starts again. */}
              {row.planStatus === "paused" ? (
                <ResumeCalls patientId={row.patientId} planId={row.planId} patientName={row.name} />
              ) : null}
              {row.status === "needs_attention" ? (
                /* Silent patient: no escalation to decide, so ring them, or end it. */
                <>
                  {row.emergencyPhone ? (
                    <Button variant="primary" href={`tel:${row.emergencyPhone}`} ariaLabel={`Phone ${row.name} from your own phone`}>
                      Phone {firstName} yourself
                    </Button>
                  ) : null}
                  {live ? <CloseFile planId={row.planId} patientId={row.patientId} patientName={row.name} finished={false} /> : null}
                </>
              ) : draft ? (
                <Button variant="primary" href={`/plans/${row.planId}`}>
                  Review and approve
                </Button>
              ) : row.status === "finished" ? (
                <>
                  <CloseFile planId={row.planId} patientId={row.patientId} patientName={row.name} finished />
                  <Button variant="onLabel" href={`/register?patient=${row.patientId}`}>
                    Restart
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="onLabel" href={`/followups/${row.patientId}`}>
                    View patient record
                  </Button>
                  {row.status === "no_concerns" && live ? (
                    <CloseFile planId={row.planId} patientId={row.patientId} patientName={row.name} finished={false} />
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/*
 * The bands, in the order the doctor should look. Only the Needs attention
 * mark is coloured red; Plans to review is neutral so the page's one amber is
 * the button in the open row.
 */
const BANDS: { key: string; label: string; tone: string; match: (r: TodayRow) => boolean }[] = [
  { key: "needs_attention", label: "Needs attention", tone: "needs", match: (r) => r.status === "needs_attention" },
  { key: "approval", label: "Plans to review", tone: "waiting", match: (r) => r.status !== "needs_attention" && isDraft(r) },
  { key: "finished", label: "Finished", tone: "finished", match: (r) => r.status === "finished" },
  { key: "no_word_yet", label: "No word yet", tone: "waiting", match: (r) => r.status === "no_word_yet" && !isDraft(r) },
  { key: "no_concerns", label: "No concerns raised", tone: "running", match: (r) => r.status === "no_concerns" },
];

export function TodayList({ rows, clearedToday }: { rows: TodayRow[]; clearedToday: number }) {
  /* One open row, starting on the most urgent patient. */
  const [openId, setOpenId] = useState<string | null>(
    () => rows.find((r) => r.status === "needs_attention")?.patientId ?? null,
  );

  return (
    /* `minmax(0, 1fr)`: a long clause must not push the sheet wider than a phone. */
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "calc(var(--cell) * 2)" }}>
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
