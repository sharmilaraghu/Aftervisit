/**
 * Today — who needs a call back, in the order they need it.
 *
 * One question, one list. The page this replaces answered four at once across
 * seven queries, a fortnight chart and a right rail, and the cost was that the
 * one thing a doctor opens the console for — who is worst right now — had to be
 * assembled by reading three panels against each other.
 *
 * Every patient appears, not every escalation. A patient nobody has managed to
 * reach has no escalation to their name, and losing them is the exact failure
 * this product exists to catch.
 */

import Link from "next/link";

import { Badge, Button, Panel } from "@/components/ui";
import { QueueActions } from "@/components/QueueActions";
import { TickPoller } from "@/components/TickPoller";
import { readConfig } from "@/lib/config";
import { getToday, type TodayRow } from "@/lib/db/dashboard";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
} from "@/lib/patients/labels";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

export const dynamic = "force-dynamic";

/** Square, ink, two letters. The world has no photographs and no round avatars. */
function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      className="caps"
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "calc(var(--cell) * 4)",
        height: "calc(var(--cell) * 4)",
        background: "var(--print)",
        color: "var(--label)",
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

/**
 * The badge that decides the row's urgency.
 *
 * Severity when a call has been read; the plan's own state when none has. The
 * two are not the same fact and the page never pretends otherwise — "never
 * reached" is not a severity, it is the absence of one, and it still has to
 * outrank a call the model cleared.
 */
function RowState({ row }: { row: TodayRow }) {
  if (row.severity) {
    return (
      <Badge
        tone={SEVERITY_TONE[row.severity] ?? "plain"}
        quiet={SEVERITY_TONE[row.severity] !== "danger"}
      >
        {SEVERITY_LABEL[row.severity] ?? row.severity}
      </Badge>
    );
  }
  return (
    <Badge tone={HEALTH_TONE[row.health]} quiet={HEALTH_TONE[row.health] !== "danger"}>
      {HEALTH_LABEL[row.health]}
    </Badge>
  );
}

/** When we last got through, and when we ring next. Both in the patient's zone. */
function Timing({ row }: { row: TodayRow }) {
  const bits: string[] = [];
  bits.push(row.lastCallAt ? `Last call ${formatStamp(row.lastCallAt, row.timezone)}` : "Never called");
  if (row.quietFor !== null && row.quietFor >= 3) bits.push(`quiet ${row.quietFor}d`);
  if (row.nextCallAt) bits.push(`next ${formatStamp(row.nextCallAt, row.timezone)}`);
  else if (row.planStatus === "active") bits.push("nothing scheduled");

  return (
    <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
      {bits.join(" · ")}
    </span>
  );
}

export default async function TodayPage() {
  const rows = await getToday();

  /*
   * The practice's zone, taken from the patients it actually follows. There is
   * no practice record to read one from, and hardcoding London was wrong for
   * every deployment that is not in London — including this one.
   */
  const practiceZone = rows[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const needsCallback = rows.filter((r) => r.escalationId !== null);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "calc(var(--cell) * 4) calc(var(--cell) * 4) calc(var(--cell) * 8)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 2)",
          marginBottom: "calc(var(--cell) * 3)",
        }}
      >
        <div>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: "0 0 calc(var(--cell) * 1)",
              color: "var(--bench-ink)",
            }}
          >
            {greeting}, {readConfig().clinicianName}.
          </h1>
          <p style={{ margin: 0, color: "var(--bench-ink-2)" }}>
            {rows.length === 0
              ? "No patients yet."
              : needsCallback.length > 0
                ? `${needsCallback.length} ${needsCallback.length === 1 ? "patient needs" : "patients need"} a call back.`
                : "Nothing is waiting on you."}
          </p>
        </div>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "calc(var(--cell) * 2)",
            alignItems: "center",
          }}
        >
          <span className="caps mono" style={{ color: "var(--bench-ink-3)" }}>
            {/* The practice's own clock, not a hardcoded zone. A console that
                prints London time to a clinic in Chennai is telling them the
                wrong hour on every page. */}
            {formatStamp(new Date(), practiceZone)}
          </span>
          <TickPoller enabled={readConfig().liveCallsEnabled} />
          <Button variant="primary" href="/plan/new">
            Add a patient
          </Button>
        </span>
      </header>

      {rows.length === 0 ? (
        <Panel title="Nobody yet">
          <p style={{ margin: 0, color: "var(--print-2)" }}>
            Add a patient to write their consultation note and approve a follow-up plan.
          </p>
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: "calc(var(--cell) * 1.5)" }}>
          {rows.map((row) => {
            const urgent = row.severity === "severe";
            return (
              <article
                key={row.patientId}
                style={{
                  border: "1px solid var(--rule-2)",
                  /* Red is spent on escalating and nowhere else on this page, so
                     the one row that interrupts is the one that should. */
                  borderLeft: urgent ? "3px solid var(--danger)" : "3px solid var(--rule-2)",
                  background: "var(--label)",
                  padding: "calc(var(--cell) * 2)",
                  display: "grid",
                  gap: "calc(var(--cell) * 1.5)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "calc(var(--cell) * 1.5)",
                  }}
                >
                  <Initials name={row.name} />
                  <Link
                    href={`/patients/${row.patientId}`}
                    style={{
                      color: "var(--print)",
                      fontWeight: 700,
                      fontSize: 17,
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {row.name}
                  </Link>
                  <span className="mono" style={{ color: "var(--print-3)", fontSize: 13 }}>
                    {row.age} · {maskPhone(row.phoneE164)}
                  </span>
                  <span
                    style={{ marginLeft: "auto", display: "flex", gap: "calc(var(--cell) * 1)" }}
                  >
                    <RowState row={row} />
                    {row.pausedPlan ? (
                      <Badge tone="amber" quiet>
                        Plan paused
                      </Badge>
                    ) : null}
                  </span>
                </div>

                <p style={{ margin: 0, color: "var(--print-2)", fontSize: 15 }}>
                  {/* What they are being followed up for, then what the model
                      made of the last call. Context before verdict — a summary
                      with nothing to hang it on is a sentence about a stranger. */}
                  <span style={{ color: "var(--print-3)" }}>{row.reason}</span>
                  {row.severitySummary ? ` — ${row.severitySummary}` : null}
                </p>

                {row.matchedConcerns.length > 0 ? (
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <span className="caps" style={{ color: "var(--print-3)" }}>
                      Matched your note:{" "}
                    </span>
                    <span style={{ color: "var(--print)" }}>
                      {row.matchedConcerns.join(" · ")}
                    </span>
                  </p>
                ) : row.ruleLabel ? (
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <span className="caps" style={{ color: "var(--print-3)" }}>
                      Raised by:{" "}
                    </span>
                    <span style={{ color: "var(--print)" }}>{row.ruleLabel}</span>
                  </p>
                ) : null}

                {row.quote ? (
                  <blockquote
                    style={{
                      margin: 0,
                      paddingLeft: "calc(var(--cell) * 1.5)",
                      borderLeft: "2px solid var(--rule-2)",
                      color: "var(--print)",
                      fontSize: 15,
                    }}
                  >
                    “{row.quote}”
                  </blockquote>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "calc(var(--cell) * 1.5)",
                  }}
                >
                  <Timing row={row} />
                  {row.lastCallId ? (
                    /* `ghost` is drawn for the graphite rail and vanishes on
                       label stock; everything on this card is on label. */
                    <Button variant="onLabel" href={`/calls/${row.lastCallId}`}>
                      Read the transcript
                    </Button>
                  ) : null}
                </div>

                {/*
                  The decision band, full-bleed to the card's edges. It carries
                  its own rule and ground, so inset by the card's padding it
                  reads as a stray panel rather than the foot of this row.
                */}
                {row.escalationId && row.planId ? (
                  <div
                    style={{
                      margin: "calc(var(--cell) * 0.5) calc(var(--cell) * -2) calc(var(--cell) * -2)",
                    }}
                  >
                    <QueueActions
                      escalationId={row.escalationId}
                      planId={row.planId}
                      patientName={row.name}
                      pausedPlan={row.pausedPlan}
                      status={row.escalationStatus ?? "open"}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
