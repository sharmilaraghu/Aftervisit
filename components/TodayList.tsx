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
import Link from "next/link";

import { Badge, Button } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import type { TodayRow } from "@/lib/db/dashboard";
import { HEALTH_LABEL, HEALTH_TONE, SEVERITY_LABEL, SEVERITY_TONE } from "@/lib/patients/labels";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

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

function Row({ row }: { row: TodayRow }) {
  const [open, setOpen] = useState(false);
  const tone = row.severity
    ? (SEVERITY_TONE[row.severity] ?? "plain")
    : HEALTH_TONE[row.health];
  const label = row.severity
    ? (SEVERITY_LABEL[row.severity] ?? row.severity)
    : HEALTH_LABEL[row.health];
  const line = lede(row);

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
          style={{
            width: "calc(var(--cell) * 20)",
            flexShrink: 0,
            color: "var(--print)",
            fontWeight: 700,
          }}
        >
          {row.name}
          <span className="mono" style={{ color: "var(--print-3)", fontWeight: 400 }}>
            {" "}
            {row.age}
          </span>
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
        <div style={{ padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 2.5)" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 2)",
              alignItems: "baseline",
              marginBottom: "calc(var(--cell) * 1.5)",
            }}
          >
            <Link
              href={`/patients/${row.patientId}`}
              style={{ color: "var(--print)", fontWeight: 700, textUnderlineOffset: 3 }}
            >
              {row.name}
            </Link>
            <span className="mono" style={{ color: "var(--print-3)", fontSize: 13 }}>
              {maskPhone(row.phoneE164)} · {row.reason}
            </span>
            {row.pausedPlan ? (
              <Badge tone="amber" quiet>
                Plan paused
              </Badge>
            ) : null}
          </div>

          {row.severitySummary ? (
            <p
              className="measure"
              style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--print)", fontSize: 15 }}
            >
              {row.severitySummary}
            </p>
          ) : null}

          {row.matchedConcerns.length > 0 ? (
            <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", fontSize: 14 }}>
              <span className="caps" style={{ color: "var(--print-3)" }}>
                Matched your note:{" "}
              </span>
              <span style={{ color: "var(--print)" }}>{row.matchedConcerns.join(" · ")}</span>
            </p>
          ) : null}

          {row.quote ? (
            <blockquote
              style={{
                margin: "0 0 calc(var(--cell) * 1.5)",
                paddingLeft: "calc(var(--cell) * 1.5)",
                borderLeft: "2px solid var(--rule-2)",
                color: "var(--print)",
                fontSize: 15,
              }}
            >
              &ldquo;{row.quote}&rdquo;
            </blockquote>
          ) : null}

          <p
            className="mono"
            style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 13, color: "var(--print-3)" }}
          >
            {row.lastCallAt
              ? `Last call ${formatStamp(row.lastCallAt, row.timezone)}`
              : "Never called"}
            {row.nextCallAt ? ` · next ${formatStamp(row.nextCallAt, row.timezone)}` : ""}
          </p>

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
                Read the transcript
              </Button>
            ) : null}
            {!row.planId ? (
              <Button variant="onLabel" href={`/plan/new?patient=${row.patientId}`}>
                Write a plan
              </Button>
            ) : null}
          </div>

          {row.escalationId && row.planId ? (
            <div style={{ margin: "calc(var(--cell) * 2) calc(var(--cell) * -3) 0" }}>
              <QueueActions
                escalationId={row.escalationId}
                planId={row.planId}
                patientName={row.name}
                pausedPlan={row.pausedPlan}
                status={row.escalationStatus ?? "open"}
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
  { key: "needs", label: "Needs you now", tone: "var(--danger)" },
  { key: "read", label: "Read, not yet done", tone: "var(--amber-deep)" },
  { key: "running", label: "Running", tone: "var(--clear)" },
] as const;

export function TodayList({
  rows,
  clearedToday,
}: {
  rows: TodayRow[];
  clearedToday: number;
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
      {BANDS.map(({ key, label, tone }) => {
        const group = rows.filter((r) => r.band === key);
        if (group.length === 0) return null;
        return (
          <section key={key} className="sheet">
            <h2 className="today-band" style={{ borderLeftColor: tone }}>
              <span>{label}</span>
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

      {/* A cleared board should read as work done, not as an empty screen. */}
      {clearedToday > 0 ? (
        <p className="today-cleared">
          <span className="mono">{clearedToday}</span>{" "}
          {clearedToday === 1 ? "escalation" : "escalations"} settled today
        </p>
      ) : null}
    </div>
  );
}
