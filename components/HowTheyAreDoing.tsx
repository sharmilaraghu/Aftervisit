/**
 * How the patient is doing — the assistant's latest summary, then what changed.
 *
 * It replaced a day-by-day grid: questions down, day numbers across, answers as
 * letter codes with a legend underneath, and the patient's own words fetched
 * and never shown. A doctor wanted two things from it — how is she, and what
 * moved — and had to decode both.
 *
 * Nothing here is generated. The summary is the one the tick stored after the
 * last clean read of a call; the changes are `whatChanged()` — arithmetic on
 * the stored answers — each dated and linked to the call it came from.
 */

import Link from "next/link";

import { Badge, Panel } from "@/components/ui";
import { formatDay, formatStamp } from "@/lib/format";
import { whatChanged, type ParameterRow } from "@/lib/patients/parameters";
import type { LatestReading } from "@/lib/db/followup";

/** "Any side effects or new symptoms — would you say…" → "Any side effects or new symptoms". */
function shortPrompt(prompt: string): string {
  const head = prompt.split(/\s[—-]\s|\?/)[0].trim();
  return head.length > 64 ? `${head.slice(0, 63).trimEnd()}…` : head;
}

export function HowTheyAreDoing({
  rows,
  reading,
  timezone,
  summaryShownAbove = false,
}: {
  rows: ParameterRow[];
  reading: LatestReading;
  timezone: string;
  /** The decision block above already printed this summary; say it once. */
  summaryShownAbove?: boolean;
}) {
  const { changed, steady } = whatChanged(rows);
  if (summaryShownAbove && changed.length === 0 && steady.length === 0) return null;

  return (
    <Panel title="How they're doing" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
      <div style={{ padding: "calc(var(--cell) * 3)" }}>
        {/* The assistant's account, attributed — never the product's voice. */}
        {summaryShownAbove ? null : (
        <>
        <p className="measure" style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "var(--print)" }}>
          {reading.conditionSummary ??
            "Nothing heard yet on this follow-up — the first summary appears after the first answered call."}
        </p>
        <p style={{ margin: "calc(var(--cell) * 1) 0 0", fontSize: 13, color: "var(--print-3)" }}>
          {reading.conditionSummaryAt ? (
            <>
              Read by the assistant ·{" "}
              <span className="mono">{formatStamp(reading.conditionSummaryAt, timezone)}</span>
            </>
          ) : null}
          {reading.summaryUnavailable ? (
            <>
              {reading.conditionSummaryAt ? " · " : ""}
              The latest call could not be read — open it from the changes below or the plan.
            </>
          ) : null}
        </p>
        </>
        )}

        {changed.length > 0 ? (
          <div style={{ marginTop: summaryShownAbove ? 0 : "calc(var(--cell) * 3)" }}>
            <h3 className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
              What changed
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {changed.map((c) => (
                <li
                  key={c.questionId}
                  style={{
                    padding: "calc(var(--cell) * 1.5) 0",
                    borderTop: "1px solid var(--rule-2)",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 15, color: "var(--print)", lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>{shortPrompt(c.prompt)}:</span>{" "}
                    {c.from !== c.to ? (
                      <>
                        {c.from} → <strong>{c.to}</strong>
                      </>
                    ) : (
                      <strong>{c.to}</strong>
                    )}
                    {c.since.date ? (
                      <span style={{ color: "var(--print-3)" }}>
                        {" "}
                        {c.from !== c.to ? "from" : "since"}{" "}
                        <span className="mono">{formatDay(c.since.date, timezone)}</span>
                      </span>
                    ) : null}{" "}
                    {/* Red only when the plan's own rule says this answer escalates. */}
                    {c.escalating ? (
                      <Badge tone="danger" quiet>
                        Matches your escalation rule
                      </Badge>
                    ) : null}
                  </p>
                  {c.since.utterance ? (
                    <p style={{ margin: "calc(var(--cell) * 0.5) 0 0", fontSize: 14, color: "var(--print-2)" }}>
                      &ldquo;{c.since.utterance}&rdquo;
                      {c.since.callId ? (
                        <>
                          {" "}
                          <Link href={`/calls/${c.since.callId}`} style={{ color: "var(--print)", textUnderlineOffset: 3 }}>
                            Read the call
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {steady.length > 0 ? (
          <div style={{ marginTop: "calc(var(--cell) * 2.5)" }}>
            <h3 className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
              Unchanged
            </h3>
            <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 2.5)", color: "var(--print-2)", fontSize: 14, lineHeight: 1.7 }}>
              {steady.map((s) => (
                <li key={s.questionId}>
                  {shortPrompt(s.prompt)}: {s.answer}{" "}
                  <span style={{ color: "var(--print-3)" }}>
                    {s.answered === s.asked
                      ? `on all ${s.answered} calls`
                      : `on ${s.answered} of ${s.asked} calls`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
