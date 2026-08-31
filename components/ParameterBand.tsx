/**
 * What the patient said, over the window.
 *
 * A sibling to `WeekBand` and deliberately the same grammar: fixed cells on a
 * shared x-axis, so **day 3 sits at the same position on every row** and the
 * matrix reads *downward* — what changed on Tuesday — as well as across.
 *
 * `WeekBand` answers "did we reach them". This answers "what did they say", and
 * it is the only place in the product where a parameter's history is visible.
 *
 * No chart. Seven self-reported points do not make a trend line, and drawing one
 * would imply a reading the data cannot carry. A doctor compares digits.
 */

import Link from "next/link";

import { Badge } from "@/components/ui";
import {
  cellLabel,
  cellTitle,
  cellTone,
  signalsFor,
  type CellTone,
  type ParameterRow,
} from "@/lib/patients/parameters";

/** Fill carries the state; the digit inside carries the value. */
const TONE: Record<CellTone, { background: string; color: string; boxShadow?: string }> = {
  escalating: { background: "var(--danger)", color: "#ffffff" },
  benign: { background: "var(--label-3)", color: "var(--print-2)" },
  unclear: {
    background: "var(--amber-wash)",
    color: "var(--print)",
    boxShadow: "inset 0 0 0 1px var(--amber)",
  },
  none: { background: "transparent", color: "var(--print-3)", boxShadow: "inset 0 0 0 1px var(--rule)" },
};

const SIGNAL_LABEL: Record<string, string> = {
  rising: "Rising",
  flipped: "Turned",
  gap: "Unclear",
};

export function ParameterBand({
  rows,
  occurrences,
}: {
  rows: ParameterRow[];
  occurrences: number[];
}) {
  if (rows.length === 0 || occurrences.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 3)",
          color: "var(--print-2)",
          fontSize: 14,
        }}
      >
        Nothing has been answered yet. Each question the plan asks gets a row here,
        with one cell per day, as the calls come back.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640, fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
            <th
              className="caps"
              style={{
                textAlign: "left",
                padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                color: "var(--print-3)",
              }}
            >
              What was asked
            </th>
            {occurrences.map((o) => (
              <th
                key={o}
                className="caps mono"
                style={{
                  padding: "calc(var(--cell) * 1.5) 0",
                  color: "var(--print-3)",
                  width: "calc(var(--cell) * 4)",
                  textAlign: "center",
                }}
              >
                {o}
              </th>
            ))}
            <th
              className="caps"
              style={{
                textAlign: "left",
                padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                color: "var(--print-3)",
                whiteSpace: "nowrap",
              }}
            >
              What&rsquo;s off
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const signal = signalsFor(row)[0] ?? null;
            const byOccurrence = new Map(row.readings.map((r) => [r.occurrence, r]));

            return (
              <tr key={row.questionId} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                <td
                  style={{
                    padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                    color: "var(--print)",
                    maxWidth: 320,
                  }}
                >
                  {row.prompt}
                  <span
                    className="mono"
                    style={{ display: "block", fontSize: 12, color: "var(--print-3)" }}
                  >
                    {row.questionId}
                  </span>
                </td>

                {occurrences.map((o) => {
                  const reading =
                    byOccurrence.get(o) ??
                    ({
                      occurrence: o,
                      status: null,
                      valueBool: null,
                      valueNumber: null,
                      valueText: null,
                      utterance: null,
                      callId: null,
                    } as const);

                  const tone = TONE[cellTone(row, reading)];
                  const label = cellLabel(row, reading);
                  const title = cellTitle(row, reading);

                  const cell = (
                    <span
                      className="mono"
                      title={title}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "calc(var(--cell) * 3.5)",
                        height: "calc(var(--cell) * 3.5)",
                        margin: "0 auto",
                        fontSize: 13,
                        ...tone,
                      }}
                    >
                      {label}
                    </span>
                  );

                  return (
                    <td key={o} style={{ padding: "calc(var(--cell) * 0.75) 0" }}>
                      {/* Every cell is a way into the call that produced it. */}
                      {reading.callId ? (
                        <Link href={`/calls/${reading.callId}`} aria-label={title}>
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}

                <td
                  style={{
                    padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {signal ? (
                    <span
                      style={{ display: "inline-flex", gap: "calc(var(--cell) * 1)", alignItems: "center" }}
                    >
                      <Badge tone={signal.kind === "gap" ? "amber" : "danger"} quiet>
                        {SIGNAL_LABEL[signal.kind]}
                      </Badge>
                      <span className="mono" style={{ color: "var(--print)", fontSize: 13 }}>
                        {signal.detail}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: "var(--print-3)" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
