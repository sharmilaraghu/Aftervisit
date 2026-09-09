/**
 * Where things stand, before a doctor reads anything else.
 *
 * The patient file used to open with a week band, a grid of answers and a table
 * of calls — three things to interpret and no answer. A clinician arriving cold
 * had to reconstruct "how is she doing?" from all three. This is that sentence,
 * put first.
 *
 * **Assembled, never generated.** Every figure is counted from rows that
 * already exist, so it reads identically with no API key configured and cannot
 * invent anything. The assistant's own account of the last call sits beneath
 * it, quoted and attributed — the product never speaks as a clinician, and it
 * does not launder a model's sentence into its own voice.
 *
 * It absorbed the five figures that used to sit under the week band rather than
 * adding a sixth panel to a page that was already too long, and it crosses
 * courses of treatment: a second follow-up used to hide everything the first
 * one learned.
 */

import Link from "next/link";

import { Badge, Panel, WeekBand } from "@/components/ui";
import { formatStamp } from "@/lib/format";
import type { PatientSummary as Summary } from "@/lib/db/summary";
import type { Tone } from "@/components/ui";
import type { DayState } from "@/lib/db/enums";

const SEVERITY: Record<string, { tone: Tone; label: string }> = {
  severe: { tone: "danger", label: "Severe" },
  escalate: { tone: "amber", label: "Needs review" },
  low: { tone: "clear", label: "Routine" },
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="caps" style={{ color: "var(--print-3)" }}>
        {label}
      </dt>
      <dd className="mono" style={{ margin: 0, fontSize: 20, color: "var(--print)", lineHeight: 1.3 }}>
        {value}
      </dd>
    </div>
  );
}

export function PatientSummary({
  summary,
  timezone,
  quietFor,
  lastHeard,
  contactRate,
  week,
  reason,
}: {
  summary: Summary;
  timezone: string;
  quietFor: number | null;
  lastHeard: Date | null;
  contactRate: number | null;
  week: DayState[];
  reason: string | null;
}) {
  const open = summary.escalations.filter(
    (e) => e.status === "open" || e.status === "acknowledged",
  );
  /* The most recent thing the assistant actually managed to read. A fail-closed
     row has no summary worth printing — it says so instead. */
  const reading = summary.readings.find((r) => r.status === "ok" && r.summary);
  const courses = summary.courses.length;

  return (
    <Panel
      title="Where things stand"
      aside={
        open.length > 0 ? (
          <Badge tone="danger">
            {open.length} waiting on you
          </Badge>
        ) : (
          <Badge tone="clear" quiet>
            Nothing waiting
          </Badge>
        )
      }
      style={{ marginBottom: "calc(var(--cell) * 2)" }}
    >
      <div style={{ padding: "calc(var(--cell) * 3)" }}>
        {reason ? (
          <p style={{ margin: "0 0 calc(var(--cell) * 2.5)", color: "var(--print-2)", fontSize: 15 }}>
            Following up on {reason.toLowerCase()}.
          </p>
        ) : null}
        <dl
          style={{
            display: "flex",
            flexWrap: "wrap",
            /* Row gap first, and smaller. A uniform 40px gap is right between
               columns and far too much between rows once these wrap onto a
               phone, where the panel stops being a row of figures and becomes a
               very tall list. */
            gap: "calc(var(--cell) * 3) calc(var(--cell) * 5)",
            margin: 0,
          }}
        >
          {/* The band is a figure like any other. It had its own panel, which
              left a 7-cell strip alone in a 1500px sheet — a whole sheet of
              bench for 110px of content. */}
          <div>
            <dt className="caps" style={{ color: "var(--print-3)", marginBottom: 4 }}>
              The week
            </dt>
            <dd style={{ margin: 0 }}>
              <WeekBand week={week} />
            </dd>
          </div>
          <Figure label="Contact rate" value={contactRate === null ? "—" : `${contactRate}%`} />
          <Figure label="Calls answered" value={`${summary.totals.reached}/${summary.totals.calls}`} />
          <Figure
            label="Quiet for"
            value={
              quietFor === null ? "—" : quietFor === 0 ? "heard today" : `${quietFor}d`
            }
          />
          <Figure
            label="Last heard"
            value={lastHeard ? formatStamp(lastHeard, timezone) : "—"}
          />
          {/* Computed on every page load since this page was built, and
              rendered nowhere: the count of calls where the patient brought up
              something none of the questions covered. */}
          <Figure label="Raised off-script" value={String(summary.totals.raisedSomething)} />
          {courses > 1 ? <Figure label="Courses" value={String(courses)} /> : null}
        </dl>

        {open.length > 0 ? (
          <div
            style={{
              marginTop: "calc(var(--cell) * 3)",
              paddingTop: "calc(var(--cell) * 2.5)",
              borderTop: "1px solid var(--rule)",
            }}
          >
            <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--print-3)" }}>
              Waiting on you
            </p>
            {open.map((e) => {
              const sev = e.severity ? SEVERITY[e.severity] : null;
              return (
                <p
                  key={e.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "calc(var(--cell) * 1.5)",
                    alignItems: "baseline",
                    margin: "0 0 calc(var(--cell) * 1.5)",
                  }}
                >
                  <Badge tone={e.urgent ? "danger" : (sev?.tone ?? "amber")} quiet={!e.urgent}>
                    {e.urgent ? "Plan paused" : (sev?.label ?? "Needs review")}
                  </Badge>
                  <span style={{ color: "var(--print)", fontSize: 15, flex: "1 1 calc(var(--cell) * 40)", minWidth: 0 }}>
                    {e.summary ?? e.ruleLabel}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
                    {formatStamp(e.raisedAt, timezone)}
                  </span>
                </p>
              );
            })}
            <p style={{ margin: "calc(var(--cell) * 1.5) 0 0" }}>
              <Link
                href="/escalations"
                style={{ color: "var(--print)", fontSize: 14, textUnderlineOffset: 3 }}
              >
                Work these in the queue
              </Link>
            </p>
          </div>
        ) : null}

        {/*
          The model's account of the last call it could read. One, not three —
          this is a summary, and a list of paragraphs is the thing it exists to
          save a doctor from.
        */}
        {reading ? (
          <div
            style={{
              marginTop: "calc(var(--cell) * 3)",
              paddingTop: "calc(var(--cell) * 2.5)",
              borderTop: "1px solid var(--rule)",
            }}
          >
            <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
              What the assistant made of the last call
            </p>
            <p style={{ margin: 0, color: "var(--print)", fontSize: 15, lineHeight: 1.55 }}>
              {reading.summary}
            </p>
            {reading.matchedConcerns.length > 0 ? (
              <p
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "calc(var(--cell) * 1)",
                  alignItems: "baseline",
                  margin: "calc(var(--cell) * 1.5) 0 0",
                }}
              >
                {/* The doctor's own conditions, named back to them. Written on
                    every triaged call and read by nothing until now. */}
                <span className="caps" style={{ color: "var(--print-3)" }}>
                  Touched what you asked about
                </span>
                {reading.matchedConcerns.map((c) => (
                  <Badge key={c} tone="amber" quiet>
                    {c}
                  </Badge>
                ))}
              </p>
            ) : null}
            <p className="mono" style={{ margin: "calc(var(--cell) * 1.5) 0 0", fontSize: 11, color: "var(--print-3)" }}>
              {formatStamp(reading.createdAt, timezone)}
              {reading.callId ? " · " : ""}
              {reading.callId ? (
                <Link href={`/calls/${reading.callId}`} style={{ color: "var(--print-3)" }}>
                  read the whole call
                </Link>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
