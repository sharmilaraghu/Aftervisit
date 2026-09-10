"use client";

/**
 * Today, as a list you scan rather than a stack you read.
 *
 * Every patient used to be a card carrying a paragraph, a quote, a timing line
 * and three buttons — about 370px each, so five patients filled a screen and a
 * half and answering "who do I ring first" meant scrolling and reading. The
 * question this page exists for is an ordering question, and an ordering
 * question is answered by a list.
 *
 * So a row is one line: how bad, who, the single most useful clause, and when.
 * Severity leads because it is the sort key — it used to sit far right, which
 * put ~1,400px between "who" and "how bad" on a wide screen. Everything else
 * about a patient is one click down, not one screen down.
 *
 * The actions live in the opened row. Three buttons on every row is the loudest
 * thing on the page and it competes with the clinical content for a decision
 * the doctor has not made yet.
 */

import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import type { TodayRow } from "@/lib/db/dashboard";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  outcomeLabel,
  outcomeTone,
} from "@/lib/patients/labels";
import { formatStamp } from "@/lib/format";
import { failureShort } from "@/lib/calle/failure";

/**
 * The one clause the row shows.
 *
 * The patient's own words first: they are short, they are evidence, and they
 * are what a clinician would have written in the notes. The model's summary is
 * the fallback, cut at its first sentence — it is written as a paragraph and a
 * paragraph is what this row exists to avoid.
 */
function lede(row: TodayRow): string | null {
  if (row.quote) return row.quote;
  if (!row.severitySummary) return null;
  const first = row.severitySummary.split(/(?<=\.)\s/)[0] ?? row.severitySummary;
  return first.length > 96 ? `${first.slice(0, 95).trimEnd()}…` : first;
}

/** When, in as few characters as carry the meaning. */
function when(row: TodayRow): string {
  if (row.quietFor !== null && row.quietFor >= 1) return `${row.quietFor}d quiet`;
  if (row.lastCallAt) return formatStamp(row.lastCallAt, row.timezone);
  return "never called";
}

/** "day 1, attempt 3 of 3" — the same phrasing the call page's own heading uses. */
function ladder(occurrence: number | null, attempt: number | null, max: number | null): string | null {
  if (occurrence === null || attempt === null) return null;
  const of = max ? ` of ${max}` : "";
  return `day ${occurrence}, attempt ${attempt}${of}`;
}

/**
 * Why nothing is scheduled.
 *
 * A blank second line leaves the doctor to work out whether the agent is
 * holding the calendar or has stopped — which is the one thing they came here
 * to know. Silence is never the answer; the reason is.
 */
function noNextReason(row: TodayRow): string {
  if (!row.planId) return "no plan yet";
  if (row.planStatus === "awaiting_approval") return "waiting on your approval";
  if (row.planStatus === "paused" || row.pausedPlan) return "plan paused";
  if (row.planStatus === "completed" || row.planStatus === "cancelled") return "follow-up ended";
  return "nothing scheduled";
}

function Row({ row }: { row: TodayRow }) {
  const [open, setOpen] = useState(false);
  const tone = row.severity
    ? (SEVERITY_TONE[row.severity] ?? "plain")
    : HEALTH_TONE[row.health];
  const label = row.severity
    ? (SEVERITY_LABEL[row.severity] ?? row.severity)
    : HEALTH_LABEL[row.health];
  const line = lede(row);
  const ladderLine = ladder(row.lastCallOccurrence, row.lastCallAttempt, row.maxAttempts);
  const outTone = outcomeTone(row.lastCallOutcome);

  return (
    <li
      style={{
        borderBottom: "1px solid var(--rule-2)",
        background: "var(--label)",
        /* Seen but not settled: still here, no longer shouting. */
        opacity: row.band === "read" && !open ? 0.72 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="today-row"
      >
        <span style={{ width: "calc(var(--cell) * 13)", flexShrink: 0 }}>
          <Badge tone={tone} quiet={tone !== "danger"}>
            {label}
          </Badge>
        </span>

        <span
          className="today-name"
          style={{ width: "calc(var(--cell) * 20)", flexShrink: 0 }}
        >
          {row.name}
          <span className="mono today-age"> {row.age}</span>
        </span>

        <span
          className="today-lede"
          style={{ color: line ? "var(--print-2)" : "var(--print-3)" }}
        >
          {line ?? "nothing said yet"}
        </span>

        <span
          className="mono col-when"
          style={{ flexShrink: 0, color: "var(--print-3)", fontSize: 13 }}
        >
          {when(row)}
        </span>
      </button>

      {open ? (
        <div className="today-open">
          {/*
            The ledger first.

            The panel used to open with the patient's name — the one you had
            just clicked — and then repeat the sentence already printed on the
            closed row, before finally offering the model's paragraph. None of
            that is the question. The question is whether anyone picked up and
            what happens next, and neither was on this page at all.
          */}
          <dl className="today-ledger mono">
            <dt>Last call</dt>
            <dd>
              {row.lastCallAt ? (
                <>
                  {formatStamp(row.lastCallAt, row.timezone)}
                  {ladderLine ? <span className="today-ledger-dim">{ladderLine}</span> : null}
                  {/* What the network did, when it did something. "Failed"
                      alone does not tell a doctor whether to redial or check
                      the number. */}
                  {failureShort(row.lastCallFailureCode) ? (
                    <span className="today-ledger-dim">
                      {failureShort(row.lastCallFailureCode)}
                    </span>
                  ) : null}
                  {/* Always quiet here. A solid red `Red flag` beside an amber
                      `Medium` is one row saying two different things about how
                      bad this is — the severity badge owns the alarm, this
                      states what the call did. */}
                  <Badge tone={outTone.tone} quiet>
                    {outcomeLabel(
                      row.lastCallStatus ?? "",
                      row.lastCallOutcome,
                      row.lastCallFailureCode,
                    )}
                  </Badge>
                </>
              ) : (
                <span className="today-ledger-dim">never called</span>
              )}
            </dd>

            <dt>Next</dt>
            <dd>
              {row.nextCallAt ? (
                <>
                  {formatStamp(row.nextCallAt, row.timezone)}
                  {row.nextOccurrence && row.totalOccurrences ? (
                    <span className="today-ledger-dim">
                      day {row.nextOccurrence} of {row.totalOccurrences}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="today-ledger-dim">{noNextReason(row)}</span>
              )}
            </dd>
          </dl>

          {/* The model's reading, under the facts rather than in place of them. */}
          {row.severitySummary ? (
            <p className="measure today-summary">{row.severitySummary}</p>
          ) : null}

          {row.matchedConcerns.length > 0 ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 14 }}>
              <span className="caps" style={{ color: "var(--print-3)" }}>
                Matched your note:{" "}
              </span>
              <span style={{ color: "var(--print)" }}>{row.matchedConcerns.join(" · ")}</span>
            </p>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
            {/*
              The doctor's own phone, not the agent's. `tel:` opens whatever
              they answer calls on; Care Loop places no part of it. On an
              escalating row it is the thing they were about to do anyway.
            */}
            {row.severity === "severe" || row.band === "needs" ? (
              <Button variant="primary" href={`tel:${row.phoneE164}`}>
                Call {row.name.split(" ")[0]}
              </Button>
            ) : null}
            {row.lastCallId ? (
              <Button variant="onLabel" href={`/calls/${row.lastCallId}`}>
                Transcript
              </Button>
            ) : null}
            {row.planId ? (
              <Button variant="onLabel" href={`/patients/${row.patientId}`}>
                Patient record
              </Button>
            ) : (
              /* No plan is the one state with a single way out, so it is the
                 only button offered rather than one of three. */
              <Button variant="onLabel" href={`/plan/new?patient=${row.patientId}`}>
                Write a plan
              </Button>
            )}
          </div>

          {row.escalationId && row.planId ? (
            <div className="today-queue">
              <QueueActions
                escalationId={row.escalationId}
                planId={row.planId}
                patientName={row.name}
                pausedPlan={row.pausedPlan}
                status={row.escalationStatus ?? "open"}
                planLive={row.planStatus === "active" || row.planStatus === "paused"}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/*
 * The bands.
 *
 * "Colour arrives as a full band with a printed word on it, never as a tint
 * behind a card" is the rule this world is built on, and Today never used it —
 * one undifferentiated slab of rows, with severity carried only by a badge.
 * A band per state gives the page its structure and says what each group is.
 */
const BANDS = [
  { key: "needs", label: "Needs you now" },
  { key: "read", label: "Read, not yet done" },
  { key: "running", label: "Running" },
] as const;

export function TodayList({
  rows,
  clearedToday,
  nextCall,
}: {
  rows: TodayRow[];
  clearedToday: number;
  /** The soonest call the agent has queued, in the patient's own zone. */
  nextCall: { at: Date; name: string; timezone: string } | null;
}) {
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
      {BANDS.map(({ key, label }) => {
        const group = rows.filter((r) => r.band === key);
        if (group.length === 0) return null;
        return (
          <section key={key} className="sheet">
            <h2 className="today-band" data-tone={key}>
              <span className="today-band-label">{label}</span>
              <span className="mono today-band-count">{group.length}</span>
            </h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {group.map((row) => (
                <Row key={row.patientId} row={row} />
              ))}
            </ul>
          </section>
        );
      })}

      {/*
        The stub the sheet tears off at. It says what the agent does next, and
        a cleared board reads as work done rather than as an empty screen.
      */}
      {nextCall || clearedToday > 0 ? (
        <footer className="sheet perf-x today-foot">
          {nextCall ? (
            <>
              <span className="caps today-foot-key">Next call</span>
              <span className="mono">{formatStamp(nextCall.at, nextCall.timezone)}</span>
              <span>{nextCall.name}</span>
            </>
          ) : null}
          {clearedToday > 0 ? (
            <span className="today-foot-end">
              <span className="mono">{clearedToday}</span>{" "}
              {clearedToday === 1 ? "escalation" : "escalations"} settled today
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
