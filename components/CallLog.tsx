"use client";

/**
 * Every call, with the retry ladder folded away.
 *
 * A seven-day plan against a line that stops answering produces thirteen rows,
 * nine of which say NO ANSWER. Those nine are the product proving its retry
 * ladder works — they are not what a doctor came to read, and the week band two
 * panels up has already told them he went quiet. So the unanswered attempts
 * collapse to one sentence naming the days and the count, and the full ladder
 * is one click away for whoever is actually auditing the scheduler.
 *
 * Nothing is hidden that changes a clinical reading: an answer, a flag, an
 * unmappable response and a refusal all stay on screen whatever happens. Only a
 * run of silence folds, and the fold says how much silence it is holding.
 */

import Link from "next/link";
import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import { formatStamp } from "@/lib/format";
import { outcomeLabel, outcomeTone } from "@/lib/patients/labels";
import { failureReason, networkRefused } from "@/lib/calle/failure";

export interface CallRow {
  id: string;
  occurrence: number;
  attempt: number;
  status: string;
  outcome: string | null;
  failureCode: string | null;
  recap: string | null;
  whatElse: string | null;
  scheduledFor: Date;
  finishedAt: Date | null;
}

const CELL = "calc(var(--cell) * 1.5) calc(var(--cell) * 2)";

export function CallLog({
  calls,
  maxAttempts,
  timezone,
}: {
  calls: CallRow[];
  /** Null before a plan exists — the ladder's ceiling is then unknown, not 1. */
  maxAttempts: number | null;
  timezone: string;
}) {
  const [full, setFull] = useState(false);

  if (calls.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 3)",
          color: "var(--print-2)",
          fontSize: 14,
        }}
      >
        No calls yet. Occurrences appear here the moment a plan is approved,
        dated, one row per day — before anything is dialled.
      </p>
    );
  }

  const silent = calls.filter((c) => c.outcome === "no_answer");
  const spoken = calls.filter((c) => c.outcome !== "no_answer");
  const rows = full || silent.length === 0 ? calls : spoken;

  /* "No answer" is a claim about the patient. When every folded attempt was
     ended by the network, nobody chose anything and the fold has to say so. */
  const allRefused = silent.length > 0 && silent.every((c) => networkRefused(c.failureCode));

  /* The days the silence covers, named rather than counted: "days 3–5" is
     something a doctor can put against the week band; "9 attempts" alone is not. */
  const days = [...new Set(silent.map((c) => c.occurrence))].sort((a, b) => a - b);
  const dayRange =
    days.length === 0
      ? ""
      : days.length === 1
        ? `Day ${days[0]}`
        : `Days ${days[0]}–${days[days.length - 1]}`;

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
              {["Day", "Attempt", "Outcome", "What they said", "When"].map((h) => (
                <th
                  key={h}
                  className="caps"
                  style={{
                    textAlign: "left",
                    padding: CELL,
                    color: "var(--print-3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {/*
            `data-fed` keys the stagger to the expansion, so the ladder feeds out
            of the sheet the way rows do everywhere else in this product rather
            than appearing all at once. The key on tbody restarts it.
          */}
          <tbody className="feed-rows" data-fed="true" key={full ? "full" : "short"}>
            {rows.map((c, i) => {
              const tone = outcomeTone(c.outcome);
              return (
                <tr
                  key={c.id}
                  style={
                    { borderBottom: "1px solid var(--rule-2)", "--i": i } as React.CSSProperties
                  }
                >
                  <td className="mono" style={{ padding: CELL }}>
                    <Link
                      href={`/calls/${c.id}`}
                      style={{
                        color: "var(--print)",
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                        textDecorationColor: "var(--rule)",
                      }}
                    >
                      {c.occurrence}
                    </Link>
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: CELL,
                      color: c.attempt > 1 ? "var(--print)" : "var(--print-3)",
                    }}
                  >
                    {maxAttempts === null ? c.attempt : `${c.attempt} of ${maxAttempts}`}
                  </td>
                  <td style={{ padding: CELL }}>
                    <Badge tone={tone.tone} quiet={tone.quiet}>
                      {outcomeLabel(c.status, c.outcome, c.failureCode)}
                    </Badge>
                  </td>
                  {/*
                    CALL-E writes this on every call, in the patient's own words.
                    It sat in the database unread while this table showed two
                    timestamps instead.
                  */}
                  <td style={{ padding: CELL, color: "var(--print-2)", maxWidth: 420 }}>
                    {/*
                      A call that never connected has no recap and used to show
                      a bare em-dash, which reads as "we have nothing" when in
                      fact we know exactly what happened. What the network did
                      is the row's content when the patient never spoke.
                    */}
                    {c.recap ?? failureReason(c.failureCode) ?? (
                      <span style={{ color: "var(--print-3)" }}>—</span>
                    )}
                    {c.whatElse ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: "calc(var(--cell) * 0.75)",
                          color: "var(--print)",
                        }}
                      >
                        <Badge tone="amber" quiet>
                          Also raised
                        </Badge>{" "}
                        {c.whatElse}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="mono"
                    style={{ padding: CELL, color: "var(--print-3)", whiteSpace: "nowrap" }}
                  >
                    {formatStamp(c.finishedAt ?? c.scheduledFor, timezone)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {silent.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
            borderTop: "1px solid var(--rule)",
            background: "var(--label-2)",
          }}
        >
          <span style={{ color: "var(--print-2)", fontSize: 14 }}>
            {full ? (
              <>
                Showing every attempt, including {silent.length} that{" "}
                {allRefused ? "the network refused" : "went unanswered"}.
              </>
            ) : (
              <>
                {dayRange}: {silent.length} attempt{silent.length === 1 ? "" : "s"},{" "}
                {allRefused ? "refused by the network" : "no answer"}.
              </>
            )}
          </span>
          <Button variant="onLabel" onClick={() => setFull(!full)}>
            {full
              ? allRefused
                ? "Hide the refused attempts"
                : "Hide the unanswered attempts"
              : "Show every attempt"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
