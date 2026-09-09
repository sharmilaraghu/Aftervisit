/**
 * Overview — the first thing a clinician sees, and a shift summary.
 *
 * The reference this was built against is a conventional SaaS dashboard: stat
 * cards, a plan table, a right rail of alerts and activity. The information
 * architecture is right and is kept. The costume is not: nothing here is a
 * rounded card on a tinted background. The four numbers are one sheet of label
 * stock ruled into four cells, the way a dispensing label prints its fields,
 * and every colour arrives as a printed band with a word on it.
 *
 * What a doctor gets in one screen: what is due, what happened, who needs a
 * decision, and what the agent has been doing while they were elsewhere.
 */

import Link from "next/link";

import { Badge, Button, Panel } from "@/components/ui";
import { LiveWeekBand } from "@/components/LiveWeekBand";
import { TickPoller } from "@/components/TickPoller";
import { readConfig } from "@/lib/config";
import { getDashboardStats } from "@/lib/db/calls";
import { Fortnight } from "@/components/Fortnight";
import { getFortnight, getLatestPhrases, getPlanProgress, getWeekSummary } from "@/lib/db/dashboard";
import { getQueue, getRoster } from "@/lib/db/queries";
import { HEALTH_LABEL, HEALTH_ORDER, HEALTH_TONE } from "@/lib/patients/labels";
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

export default async function OverviewPage() {
  const [stats, roster, queue, progress, week, phrases, fortnight] = await Promise.all([
    getDashboardStats(),
    getRoster(),
    getQueue(),
    getPlanProgress(),
    getWeekSummary(),
    getLatestPhrases(),
    getFortnight(),
  ]);

  const sorted = [...roster].sort(
    (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
  );
  /*
   * Running means running. A completed plan that never reached anyone is a real
   * and urgent state, but it belongs on the roster under its own heading — in a
   * table called "follow-ups running" it reads as though the agent is still
   * trying, which is the opposite of what happened.
   */
  const allRunning = sorted.filter(
    (p) => p.planStatus === "active" || p.planStatus === "paused",
  );
  /* Six is a glance, not a list. The count of what is hidden is stated rather
     than silently dropped — a truncated table that does not say it is
     truncated is a table nobody can trust. */
  const running = allRunning.slice(0, 6);
  const moreRunning = allRunning.length - running.length;

  /*
   * The practice's zone, taken from the patients it actually follows. There is
   * no practice record to read one from, and hardcoding London was wrong for
   * every deployment that is not in London — including this one.
   */
  const practiceZone =
    sorted[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  /* `getQueue` orders urgent first, so the head of the list is the one patient
     this shift should be looked at before any other. */
  const top = queue[0];

  /*
   * Four numbers, and each one is a thing a doctor does something about. The
   * pair that used to sit here — a contact rate and the scheduler's last run —
   * were a quarterly report and an infrastructure heartbeat, neither of which
   * changes what happens at 9am.
   */
  const FIGURES: { label: string; value: string; note: string; alarm?: boolean; href?: string }[] = [
    {
      label: "Due today",
      value: String(stats.dueToday),
      note: stats.dueToday === 0 ? "nothing queued" : "calls the agent will place",
      /* A number you can act on is a number you can click — and three of these
         four were dead text, which teaches a reader that none of them lead
         anywhere. */
      href: "/patients",
    },
    {
      label: "Reached this week",
      value: String(week.reached),
      note: week.attempted === 0 ? "no calls yet" : `of ${week.attempted} attempted`,
      href: "/patients",
    },
    {
      label: "Needs review",
      value: String(stats.openEscalations),
      note:
        stats.urgentEscalations > 0
          ? `${stats.urgentEscalations} paused a plan`
          : "waiting on a clinician",
      alarm: stats.openEscalations > 0,
      href: "/escalations",
    },
    {
      label: "In follow-up",
      value: String(stats.activePlans),
      note: `across ${stats.patients} ${stats.patients === 1 ? "patient" : "patients"}`,
      href: "/patients",
    },
  ];

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
            {stats.openEscalations > 0
              ? `${stats.openEscalations} ${stats.openEscalations === 1 ? "call needs" : "calls need"} your review. Everything else is running.`
              : "Nothing is waiting on you. Here is what the agent has been doing."}
          </p>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: "calc(var(--cell) * 2)", alignItems: "center" }}>
          <span className="caps mono" style={{ color: "var(--bench-ink-3)" }}>
            {/* The practice's own clock, not a hardcoded zone. A console that
                prints London time to a clinic in Chennai is telling them the
                wrong hour on every page. */}
            {formatStamp(new Date(), practiceZone)}
          </span>
          <TickPoller enabled={readConfig().liveCallsEnabled} />
          <Button variant="primary" href="/patients/new">
            Add a patient
          </Button>
        </span>
      </header>

      {/*
        The page's focal point.
        An Operate surface does not get a marketing hero — a working screen
        loads into a task, it does not introduce itself. What it does need is
        one element that is unmistakably the most important thing on it, and
        here that is the single most urgent patient, quoted. It is the same
        printed-band grammar as everything else, at poster scale: a word on a
        strip, then the evidence in the patient's own voice.
      */}
      {top ? (
        <div
          className="sheet"
          style={{
            marginBottom: "calc(var(--cell) * 3)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              background: top.pausedPlan ? "var(--danger)" : "var(--amber)",
              color: top.pausedPlan ? "var(--label)" : "var(--print)",
              padding: "calc(var(--cell) * 3) calc(var(--cell) * 2.5)",
              display: "flex",
              alignItems: "center",
              flex: "0 0 auto",
            }}
          >
            <span className="caps" style={{ writingMode: "horizontal-tb", lineHeight: 1.3 }}>
              {top.pausedPlan ? "Needs you now" : "Needs review"}
            </span>
          </div>

          <div style={{ padding: "calc(var(--cell) * 3)", flex: "1 1 320px", minWidth: 0 }}>
            <p
              style={{
                margin: "0 0 calc(var(--cell) * 1.5)",
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 1.5)",
                alignItems: "baseline",
              }}
            >
              <Link
                href={`/patients/${top.patientId}`}
                style={{
                  color: "var(--print)",
                  fontWeight: 700,
                  fontSize: 17,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  textDecorationColor: "var(--rule)",
                }}
              >
                {top.patientName}
              </Link>
              <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                {/* The rule in words. Its slug is forensic and lives on the
                    card in the queue, not on the thing you read first. */}
                {top.ruleLabel} · {formatStamp(top.raisedAt, top.timezone)}
              </span>
            </p>

            {top.utterance ? (
              <blockquote
                style={{
                  margin: "0 0 calc(var(--cell) * 2)",
                  padding: "0 0 0 calc(var(--cell) * 2)",
                  borderLeft: "1px solid var(--rule-ink)",
                  fontSize: 22,
                  lineHeight: 1.4,
                  color: "var(--print)",
                }}
              >
                &ldquo;{top.utterance}&rdquo;
              </blockquote>
            ) : (
              <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 17 }}>
                {top.reason}
              </p>
            )}

            <Button variant="onLabel" href="/escalations">
              {queue.length > 1 ? `Review this and ${queue.length - 1} more` : "Review it"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- the four figures */}
      <div className="figure-row sheet" style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        {FIGURES.map((f) => {
          const body = (
            <>
              <span className="caps" style={{ color: "var(--print-3)" }}>
                {f.label}
              </span>
              <span
                className="mono"
                style={{
                  display: "block",
                  fontSize: 34,
                  lineHeight: 1.1,
                  margin: "calc(var(--cell) * 0.75) 0 2px",
                  color: f.alarm ? "var(--danger)" : "var(--print)",
                }}
              >
                {f.value}
              </span>
              <span style={{ color: "var(--print-3)", fontSize: 13 }}>{f.note}</span>
            </>
          );
          return (
            <div key={f.label} style={{ padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3)" }}>
              {/* A number you can act on is a number you can click. */}
              {f.href && Number(f.value) > 0 ? (
                <Link href={f.href} style={{ textDecoration: "none", display: "block" }}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>

      {/*
        The fortnight, above the two columns.

        It is full width because it is the only thing on this page about the
        practice rather than about a patient, and it is above them because
        "is anything systemically wrong?" is the question you want answered
        before you start reading names.
      */}
      <Panel
        title="The last fortnight"
        /* Three words with their own colour printed beside them. A legend that
           names the tones without showing them asks the reader to guess which
           green is which, which is the whole job of a legend. */
        aside={
          <span
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "center",
            }}
          >
            {[
              ["Answered", "var(--clear)"],
              ["Not reached", "var(--amber)"],
              ["Flagged", "var(--danger)"],
            ].map(([word, fill]) => (
              <span
                key={word}
                className="caps"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "calc(var(--cell) * 0.75)",
                  color: "var(--print-3)",
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 10, height: 10, background: fill, flexShrink: 0 }}
                />
                {word}
              </span>
            ))}
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        <Fortnight days={fortnight} />
      </Panel>

      <div className="overview-grid">
        {/* ------------------------------------------------------------ the plans */}
        <Panel
          title="Follow-ups running"
          aside={
            <Link href="/patients" className="caps" style={{ color: "var(--print-2)" }}>
              {moreRunning > 0 ? `${moreRunning} more · all patients` : "All patients"}
            </Link>
          }
        >
          {running.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "calc(var(--cell) * 3)",
                color: "var(--print-2)",
                fontSize: 15,
              }}
            >
              No plan is running yet. Add a patient and write the note from
              their consultation.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, fontSize: 14 }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                    {["Patient", "Following up on", "Latest from the patient", "The week", "State"].map((h) => (
                      <th
                        key={h}
                        className="caps"
                        style={{
                          textAlign: "left",
                          padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)",
                          color: "var(--print-3)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {running.map((p) => {
                    const prog = p.planId ? progress.get(p.planId) : undefined;
                    const phrase = phrases.get(p.patientId);
                    return (
                      <tr key={p.patientId} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                        <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "calc(var(--cell) * 1.5)",
                            }}
                          >
                            <Initials name={p.name} />
                            <span style={{ minWidth: 0 }}>
                              <Link
                                href={`/patients/${p.patientId}`}
                                style={{
                                  display: "block",
                                  color: "var(--print)",
                                  fontWeight: 700,
                                  textDecoration: "underline",
                                  textUnderlineOffset: 3,
                                  textDecorationColor: "var(--rule)",
                                }}
                              >
                                {p.name}
                              </Link>
                              <span
                                className="mono"
                                style={{ fontSize: 12, color: "var(--print-3)" }}
                              >
                                {p.age} · {maskPhone(p.phoneE164)}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                            color: "var(--print-2)",
                            maxWidth: 260,
                          }}
                        >
                          {p.reason}
                        </td>
                        {/*
                          What the patient said, verbatim. This column used to
                          hold the next scheduled call — the machine reporting
                          on itself. A doctor reading a roster wants the thing
                          they would have learned by picking up the phone, and a
                          sentence in the patient's own words is the only
                          evidence on this page that no model wrote.
                        */}
                        <td
                          style={{
                            padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                            maxWidth: 320,
                          }}
                        >
                          {phrase ? (
                            <>
                              <span
                                style={{
                                  display: "block",
                                  color: phrase.flagged ? "var(--print)" : "var(--print-2)",
                                  fontSize: 14,
                                  lineHeight: 1.4,
                                }}
                              >
                                &ldquo;{phrase.text}&rdquo;
                              </span>
                              <span
                                className="mono"
                                style={{ fontSize: 11, color: "var(--print-3)" }}
                              >
                                {formatStamp(phrase.at, p.timezone)}
                              </span>
                            </>
                          ) : (
                            <span style={{ color: "var(--print-3)" }}>
                              Nothing said yet
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                          <LiveWeekBand week={p.week} />
                          {prog && prog.total > 0 ? (
                            <span
                              className="mono"
                              style={{
                                display: "block",
                                marginTop: 4,
                                fontSize: 11,
                                color: "var(--print-3)",
                              }}
                            >
                              call {Math.min(prog.done + 1, prog.total)} of {prog.total}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                          <Badge
                            tone={HEALTH_TONE[p.health]}
                            quiet={HEALTH_TONE[p.health] !== "danger"}
                          >
                            {HEALTH_LABEL[p.health]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* -------------------------------------------------------------- the rail */}
        <div style={{ display: "grid", gap: "calc(var(--cell) * 3)", alignContent: "start" }}>
          <Panel
            title="Needs review"
            aside={
              queue.length > 0 ? (
                <Link href="/escalations" className="caps" style={{ color: "var(--print-2)" }}>
                  {queue.length > 4 ? `${queue.length - 4} more · open queue` : "Open queue"}
                </Link>
              ) : undefined
            }
          >
            {queue.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "calc(var(--cell) * 3)",
                  color: "var(--print-2)",
                  fontSize: 14,
                }}
              >
                No rule has fired. Anything that needs a decision arrives here,
                with the patient&rsquo;s own words attached.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {queue.slice(0, 4).map((e) => (
                  <li
                    key={e.id}
                    style={{
                      padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
                      borderBottom: "1px solid var(--rule-2)",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "calc(var(--cell) * 1.5)",
                        marginBottom: "calc(var(--cell) * 0.75)",
                      }}
                    >
                      <Initials name={e.patientName} />
                      <Link
                        href="/escalations"
                        style={{
                          color: "var(--print)",
                          fontWeight: 700,
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                          textDecorationColor: "var(--rule)",
                        }}
                      >
                        {e.patientName}
                      </Link>
                      <span style={{ marginLeft: "auto" }}>
                        {e.pausedPlan ? (
                          <Badge tone="danger">Plan paused</Badge>
                        ) : (
                          <Badge tone="amber" quiet>
                            Routine
                          </Badge>
                        )}
                      </span>
                    </span>
                    {e.utterance ? (
                      <p
                        style={{
                          margin: "0 0 calc(var(--cell) * 0.75)",
                          color: "var(--print-2)",
                          fontSize: 14,
                          lineHeight: 1.45,
                        }}
                      >
                        &ldquo;{e.utterance}&rdquo;
                      </p>
                    ) : null}
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--print-3)" }}
                    >
                      {e.ruleLabel} · {formatStamp(e.raisedAt, e.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

        </div>
      </div>
    </div>
  );
}
