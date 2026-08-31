/**
 * The roster — and the clinician's dashboard. One surface, one job.
 *
 * There used to be two: a dashboard and a roster, reading the same query and
 * writing near-identical headlines. Two front doors to one room is what made the
 * console confusing, so the dashboard's practice-level numbers moved here as a
 * strip and the page they lived on now redirects.
 *
 * The job this page does is one question: **who needs me, and why?** So the sort
 * is by who needs attention, the week band is the comparison axis, and
 * everything else on a row is subordinate to those two.
 *
 * Every number here is derived from `scheduled_calls` at read time — none of it
 * is a stored counter. A cached "on track" is wrong the moment a patient stops
 * answering, and that is the exact failure this page exists to catch.
 */

import Link from "next/link";

import { Badge, Button, Panel, WeekBand } from "@/components/ui";
import { TickPoller } from "@/components/TickPoller";
import { ListFilter } from "@/components/ListFilter";
import { readConfig } from "@/lib/config";
import { contactRate, getRoster } from "@/lib/db/queries";
import { getDashboardStats } from "@/lib/db/calls";
import { getRosterSignals } from "@/lib/db/parameters";
import { HEALTH_LABEL, HEALTH_ORDER, HEALTH_TONE } from "@/lib/patients/labels";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";

/* The roster reflects live rows; a cached page would show a stale week band. */
export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const [rows, stats, signals] = await Promise.all([
    getRoster(),
    getDashboardStats(),
    // One query for the whole roster, not one per patient.
    getRosterSignals(),
  ]);
  const roster = [...rows].sort(
    (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health],
  );

  const needing = roster.filter((p) =>
    ["escalated", "never_reached", "drifting", "needs_plan"].includes(p.health),
  ).length;
  const neverReached = roster.filter((p) => p.health === "never_reached").length;
  const noPlan = roster.filter((p) => p.health === "needs_plan").length;
  const rate = contactRate(roster);

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          {/*
            Nothing is asserted before it has been checked. An empty practice
            once read "Everyone is being followed up", which was the first
            sentence a doctor saw and was false.
          */}
          {roster.length === 0
            ? "No patients yet."
            : stats.urgentEscalations > 0
              ? `${stats.urgentEscalations} ${stats.urgentEscalations === 1 ? "plan is" : "plans are"} paused for you.`
              : neverReached > 0
                ? `${neverReached} ${neverReached === 1 ? "patient was" : "patients were"} never reached.`
                : needing > 0
                  ? `${needing} ${needing === 1 ? "patient needs" : "patients need"} you.`
                  : "Everyone is being followed up."}
        </h1>

        <p className="measure" style={{ margin: 0, color: "var(--bench-ink-2)" }}>
          {roster.length === 0
            ? "Add a patient and write the note from their consultation. Care Loop compiles it into a plan you approve, then phones them daily and brings you anything it could not resolve."
            : neverReached > 0
              ? "A follow-up window closed without anyone answering. That is the silence this product exists to notice — it is not the same as a week that went well."
              : "Care Loop schedules the calls, listens, and brings you what it could not resolve. It never decides anything clinical — every escalation was raised by a rule you can read."}
        </p>
      </header>

      {/*
        Four numbers, ranked, rather than six of equal weight. The first answers
        the headline; the last is evidence the agent is running, not a claim that
        it is.
      */}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "calc(var(--cell) * 3)",
          margin: "0 0 calc(var(--cell) * 4)",
        }}
      >
        {[
          ["Needs you", String(needing), false, "/queue"],
          ["Patients", String(stats.patients), false, null],
          /* Nothing due yet is not a 0% contact rate. Say so rather than print a lie. */
          ["Contact rate", rate === null ? "—" : `${Math.round(rate * 100)}%`, false, null],
          [
            "Scheduler",
            stats.lastTick ? formatStamp(stats.lastTick.at, "Europe/London") : "never run",
            true,
            null,
          ],
        ].map(([label, value, small, href]) => {
          const figure = (
            <dd
              className="mono"
              style={{
                margin: 0,
                fontSize: small ? 15 : 30,
                color:
                  label === "Needs you" && needing > 0 ? "var(--danger)" : "var(--bench-ink)",
                lineHeight: 1.15,
                paddingTop: small ? 9 : 0,
              }}
            >
              {value}
            </dd>
          );
          return (
            <div key={String(label)}>
              <dt className="caps" style={{ color: "var(--bench-ink-3)" }}>
                {label}
              </dt>
              {/* A count nobody can click is a count nobody can act on. */}
              {href && Number(value) > 0 ? (
                <Link href={String(href)} style={{ textDecoration: "none" }}>
                  {figure}
                </Link>
              ) : (
                figure
              )}
            </div>
          );
        })}
      </dl>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 2)",
          alignItems: "center",
          margin: "0 0 calc(var(--cell) * 3)",
        }}
      >
        {/* The page's one amber: this is the only thing you can start from here. */}
        <Button variant="primary" href="/patients/new">
          Add a patient
        </Button>
        {noPlan > 0 ? (
          <span style={{ color: "var(--bench-ink-2)", fontSize: 14 }}>
            {noPlan} {noPlan === 1 ? "patient has" : "patients have"} no plan yet — nobody is
            following them up at all.
          </span>
        ) : null}
        {roster.length > 4 ? (
          <ListFilter
            targetId="roster"
            placeholder="Find a patient"
            items={roster.map((p) => ({
              id: p.patientId,
              text: `${p.name} ${p.reason} ${HEALTH_LABEL[p.health]}`,
            }))}
          />
        ) : null}
        <span style={{ marginLeft: "auto" }}>
          <TickPoller enabled={readConfig().liveCallsEnabled} />
        </span>
      </div>

      {roster.length === 0 ? (
        <Panel title="Roster">
          <p
            className="measure"
            style={{
              margin: 0,
              padding: "calc(var(--cell) * 3)",
              color: "var(--print-2)",
              fontSize: 15,
            }}
          >
            Nobody has been added yet. Add a patient and write the note from their
            consultation — Care Loop compiles it into a plan, you approve it, and
            it takes the follow-up from there.
          </p>
        </Panel>
      ) : (
      <Panel
        title="Roster"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {roster.length} patients
          </span>
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880, fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                {["Patient", "Following up on", "The week", "What’s off", "State"].map((h) => (
                  <th
                    key={h}
                    className="caps"
                    style={{
                      textAlign: "left",
                      padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                      color: "var(--print-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody id="roster">
              {roster.map((p) => {
                const signal = signals.get(p.patientId);
                return (
                <tr
                  key={p.patientId}
                  data-row-id={p.patientId}
                  style={{ borderBottom: "1px solid var(--rule-2)" }}
                >
                  <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                    {/*
                      The name is the link, not a trailing "view" control: the
                      thing you want is the patient, so the patient is what you
                      click.
                    */}
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
                    <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                      {p.age} · {maskPhone(p.phoneE164)}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                      color: "var(--print-2)",
                      maxWidth: 280,
                    }}
                  >
                    {p.reason}
                  </td>
                  <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                    <WeekBand week={p.week} />
                  </td>
                  {/*
                    The column that turns a roster into a dashboard: scan it and
                    you know who to open. Silence sits in the same cell, because
                    "no contact for three days" is itself a thing that is off —
                    and a patient with neither is genuinely fine.
                  */}
                  <td
                    style={{
                      padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {signal ? (
                      <span
                        style={{
                          display: "inline-flex",
                          gap: "calc(var(--cell) * 1)",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: "var(--print)" }}>
                          {signal.questionId.replace(/_/g, " ")}
                        </span>
                        <span className="mono" style={{ color: "var(--danger)", fontSize: 13 }}>
                          {signal.detail}
                        </span>
                      </span>
                    ) : p.quietFor !== null && p.quietFor >= 3 ? (
                      <span className="mono" style={{ color: "var(--danger)" }}>
                        quiet {p.quietFor}d
                      </span>
                    ) : (
                      <span style={{ color: "var(--print-3)" }}>&mdash;</span>
                    )}
                  </td>
                  <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                    {/*
                      The badge is the shortest route to the thing it describes:
                      a plan waiting on approval links to the plan, a patient
                      with no plan links to writing one.
                    */}
                    <Link
                      href={
                        p.health === "needs_plan"
                          ? `/patients/${p.patientId}/new-plan`
                          : p.planId && p.health === "awaiting_approval"
                            ? `/plans/${p.planId}`
                            : `/patients/${p.patientId}`
                      }
                      style={{ textDecoration: "none" }}
                    >
                      {/*
                        Amber states go quiet in the roster. The page's one
                        amber is "Add a patient"; a column of filled amber
                        badges would out-shout it and mean nothing was primary.
                        Danger stays filled — red is the alarm, and it is
                        supposed to interrupt.
                      */}
                      <Badge
                        tone={HEALTH_TONE[p.health]}
                        quiet={HEALTH_TONE[p.health] !== "danger"}
                      >
                        {HEALTH_LABEL[p.health]}
                      </Badge>
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      )}

      {roster.length === 0 ? null : (
      <p
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 2)",
          alignItems: "center",
          marginTop: "calc(var(--cell) * 3)",
          color: "var(--bench-ink-3)",
          fontSize: 13,
        }}
      >
        <span className="caps">The week</span>
        {[
          ["answered", "Answered"],
          ["missed", "No answer"],
          ["flagged", "Red flag"],
          ["held", "Held"],
          ["scheduled", "Scheduled"],
        ].map(([state, label]) => (
          <span key={state} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <WeekBand week={[state]} />
            {label}
          </span>
        ))}
      </p>
      )}
    </div>
  );
}
