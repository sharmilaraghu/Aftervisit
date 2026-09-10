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
  const urgent = row.severity === "severe";
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
        /* Red is spent on escalating and nowhere else on this page. */
        borderLeft: urgent ? "3px solid var(--danger)" : "3px solid transparent",
        background: "var(--label)",
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
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            color: line ? "var(--print-2)" : "var(--print-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
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

export function TodayList({ rows }: { rows: TodayRow[] }) {
  return (
    <ul className="sheet" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((row) => (
        <Row key={row.patientId} row={row} />
      ))}
    </ul>
  );
}
