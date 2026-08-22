/**
 * The roster.
 *
 * The job this page does is one question: who is drifting? So drift is the
 * sort, the week band is the comparison axis, and everything else on the row is
 * subordinate to those two.
 */

import { Badge, Panel, WeekBand } from "@/components/ui";
import {
  ESCALATIONS,
  PATIENTS,
  STATE_LABEL,
  STATE_TONE,
  displayPhone,
} from "@/lib/fixtures";

/* Drifting and escalated first: the roster is sorted by who needs attention. */
const ORDER: Record<string, number> = {
  escalated: 0,
  drifting: 1,
  paused: 2,
  awaiting_approval: 3,
  on_track: 4,
  completed: 5,
};

export default function PatientsPage() {
  const roster = [...PATIENTS].sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  const needing = roster.filter(
    (p) => p.state === "escalated" || p.state === "drifting",
  ).length;
  const dueTotal = roster.reduce((n, p) => n + p.due, 0);
  const contactedTotal = roster.reduce((n, p) => n + p.contacted, 0);
  const contactRate = dueTotal === 0 ? 0 : Math.round((contactedTotal / dueTotal) * 100);

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "calc(var(--cell) * 3)",
          marginBottom: "calc(var(--cell) * 4)",
        }}
      >
        <h1
          className="display"
          style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: 0, color: "var(--bench-ink)" }}
        >
          {needing === 0
            ? "Nobody is drifting."
            : `${needing} ${needing === 1 ? "patient needs" : "patients need"} you.`}
        </h1>

        <dl
          style={{
            display: "flex",
            gap: "calc(var(--cell) * 4)",
            margin: 0,
          }}
        >
          {[
            ["Contact rate", `${contactRate}%`],
            ["In queue", String(ESCALATIONS.length)],
            ["Active plans", String(roster.filter((p) => p.state !== "completed").length)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="caps" style={{ color: "var(--bench-ink-3)" }}>
                {label}
              </dt>
              <dd
                className="mono"
                style={{ margin: 0, fontSize: 26, color: "var(--bench-ink)", lineHeight: 1.2 }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <Panel title="Roster" aside={<span className="caps mono" style={{ color: "var(--print-3)" }}>{roster.length} patients</span>}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880, fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                {["Patient", "Following up on", "The week", "Quiet for", "State"].map((h) => (
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
            <tbody>
              {roster.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--rule-2)" }}>
                  <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                    <span style={{ display: "block", color: "var(--print)", fontWeight: 700 }}>
                      {p.name}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                      {p.age} · {displayPhone(p.phone)}
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
                  <td
                    className="mono"
                    style={{
                      padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
                      /*
                       * Red is danger only. A finished plan that has been quiet
                       * for a week is not a danger — silence is only alarming
                       * while someone is still supposed to be answering.
                       */
                      color:
                        p.quietFor >= 3 &&
                        (p.state === "drifting" || p.state === "escalated")
                          ? "var(--danger)"
                          : "var(--print-2)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.state === "awaiting_approval"
                      ? "—"
                      : p.quietFor === 0
                        ? "heard today"
                        : `${p.quietFor}d`}
                  </td>
                  <td style={{ padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)" }}>
                    <Badge
                      tone={STATE_TONE[p.state]}
                      quiet={p.state === "completed"}
                    >
                      {STATE_LABEL[p.state]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

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
    </div>
  );
}
