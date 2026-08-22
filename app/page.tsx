/**
 * The landing page — a `Persuade` surface.
 *
 * The visitor is a clinician or practice nurse deciding whether they would let
 * this thing phone their patients. So the page explains the product in their
 * terms — what they write, what they approve, what comes back — and never in
 * terms of the API underneath it. The technical story belongs in the README.
 *
 * The stack of sheets steps rightward as it descends: that descending edge is
 * the week itself, note → plan → calls → the ones that need you.
 */

import { CompileSheet } from "@/components/CompileSheet";
import { FeedIn } from "@/components/FeedIn";
import { Badge, Button, Masthead } from "@/components/ui";

/* Seven dated rows. Day 3 is the one the whole product exists to catch. */
const OCCURRENCES = [
  { day: 1, date: "17 Aug", time: "17:30", state: "Answered", tone: "clear" as const, note: "All three questions answered" },
  { day: 2, date: "18 Aug", time: "17:30", state: "Answered", tone: "clear" as const, note: "All three questions answered" },
  { day: 3, date: "19 Aug", time: "17:30", state: "Escalated", tone: "danger" as const, note: "Red flag heard · plan paused for you" },
  { day: 4, date: "20 Aug", time: "17:30", state: "Held", tone: "amber" as const, note: "Waiting on a clinician" },
  { day: 5, date: "21 Aug", time: "17:30", state: "Scheduled", tone: "plain" as const, note: "—" },
  { day: 6, date: "22 Aug", time: "17:30", state: "Scheduled", tone: "plain" as const, note: "—" },
  { day: 7, date: "23 Aug", time: "17:30", state: "Scheduled", tone: "plain" as const, note: "—" },
];

/* Every sentence below is shipped code, written to be read by a clinician. */
const REFUSALS = [
  "Care Loop does not give medical advice. Anything a patient should do next is a clinician's call.",
  "Care Loop does not diagnose. Naming a condition on a follow-up call is practising medicine.",
  "Care Loop never reassures a patient about a symptom. Reassurance is a clinical act, and a wrong one is dangerous.",
  "Only sentences you actually wrote may be attributed to you.",
  "No country code. Care Loop will not guess one — a guessed code dials a stranger.",
];

const CONTROLS = [
  {
    title: "You approve every plan before it runs",
    body: "Nothing is scheduled and nothing is dialled until you have read the questions and pressed approve. You can edit any of it first.",
  },
  {
    title: "Anything it filled in for you is marked",
    body: "Call time, cadence, retry count — if the plan says something your note did not, it carries a Defaulted mark. Code applies those defaults, never the model, which is what makes the mark trustworthy.",
  },
  {
    title: "It will not invent a medication",
    body: "A drug name or a red-flag term that was not in your note is refused outright, rather than being reasoned about.",
  },
  {
    title: "Three rules can never be removed",
    body: "If a patient asks for a human, says something the agent cannot map to an answer, or uses emergency language, it escalates. Not by your choice, and not by the model's.",
  },
];

const BUILT = [
  "The clinical guard that decides what the agent may and may not say",
  "The dial gate — it can only ever call numbers that were explicitly armed",
  "Phone handling that refuses ambiguous numbers instead of guessing",
];

const NOT_BUILT = [
  "The database, the note compiler and the seeded patients",
  "The scheduler that moves the dated rows and places the calls",
  "Answer extraction and the contact-rate figures on the patient page",
];

/*
 * The descending edge. Each step of the week sits further right than the last,
 * and carries its name on a tab down its left edge — the way a sleeve is
 * indexed. The tab is deliberately not a label above the heading.
 */
function Stage({
  step,
  name,
  children,
}: {
  step: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        paddingLeft: `calc(var(--stage-step, 0px) * ${step})`,
        marginBottom: "calc(var(--cell) * 12)",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: "calc(var(--cell) * 3)",
      }}
    >
      <span className="caps stage-tab">{name}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <Masthead />

      {/* ---------------------------------------------------------------- hero */}
      <div
        style={{
          borderBottom: "1px solid var(--bench-line)",
          background:
            "radial-gradient(120% 90% at 12% 0%, var(--bench-3) 0%, var(--bench) 62%)",
        }}
      >
        <div
          className="hero-grid"
          style={{
            maxWidth: "var(--maxw)",
            margin: "0 auto",
            padding: "calc(var(--cell) * 9) calc(var(--cell) * 3) calc(var(--cell) * 10)",
            display: "grid",
            gap: "calc(var(--cell) * 7)",
            alignItems: "center",
          }}
        >
          <div>
            <h1
              className="display"
              style={{
                fontSize: "clamp(40px, 5.2vw, 68px)",
                margin: "0 0 calc(var(--cell) * 3)",
                color: "var(--bench-ink)",
              }}
            >
              Every patient followed up. Without the recall list.
            </h1>

            <p
              className="measure"
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--bench-ink-2)",
                margin: "0 0 calc(var(--cell) * 3)",
              }}
            >
              Write your note the way you already do. Care Loop turns it into a
              dated follow-up plan, you approve it in one click, and it runs the
              whole week — calling, listening, trying again when nobody picks up,
              and handing you the patients who need you. Nobody dials from your
              desk.
            </p>

            <p
              className="measure"
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--bench-ink)",
                margin: "0 0 calc(var(--cell) * 4)",
              }}
            >
              It exists to catch one thing: the patient who quietly stops
              engaging, and nobody notices for a week.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(var(--cell) * 1.5)",
                marginBottom: "calc(var(--cell) * 4)",
              }}
            >
              {/*
                The pull tab is the primary action in this viewport, so neither
                of these is amber-filled. One amber primary per view.
              */}
              <Button href="/patients" variant="ghost">
                See it running
              </Button>
              <Button href="#week" variant="ghost">
                How a week works
              </Button>
            </div>

            <p
              style={{
                color: "var(--bench-ink-3)",
                margin: 0,
                maxWidth: "52ch",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              Hackathon prototype — not for use with real patient data. Every
              patient, clinic and number here is fictional.
            </p>
          </div>

          {/* The product, running. Not a screenshot of it. */}
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <CompileSheet />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- week */}
      <div
        id="week"
        className="stage-stack"
        style={{
          maxWidth: "var(--maxw)",
          margin: "0 auto",
          padding: "calc(var(--cell) * 10) calc(var(--cell) * 3) calc(var(--cell) * 4)",
        }}
      >
        <Stage step={1} name="You approve it once">
          <h2
            className="display"
            style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 2)" }}
          >
            One click turns the plan into your patient&rsquo;s week.
          </h2>
          <p
            className="measure"
            style={{ color: "var(--bench-ink-2)", margin: "0 0 calc(var(--cell) * 4)" }}
          >
            Approving writes out every call, dated, so you can see the whole
            follow-up window at once instead of trusting that something will
            happen. Seven days means seven calendar days from approval — a
            follow-up window is a clinical interval, not a quota of completed
            calls.
          </p>

          <div className="sheet" style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 620,
                fontSize: 14,
              }}
            >
              <caption
                className="caps"
                style={{
                  captionSide: "top",
                  textAlign: "left",
                  padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 2)",
                  color: "var(--print-3)",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                Asha K · metformin follow-up · approved 16 Aug
              </caption>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--rule-ink)" }}>
                  {["Day", "Date", "Time", "State", "What happened"].map((h) => (
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
              <FeedIn>
                {OCCURRENCES.map((o, i) => (
                  <tr
                    key={o.day}
                    style={
                      {
                        borderBottom: "1px solid var(--rule-2)",
                        "--i": i,
                      } as React.CSSProperties
                    }
                  >
                    <td
                      className="mono"
                      style={{
                        padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)",
                        color: "var(--print-3)",
                      }}
                    >
                      {String(o.day).padStart(2, "0")}
                    </td>
                    <td className="mono" style={{ padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)", color: "var(--print)" }}>
                      {o.date}
                    </td>
                    <td className="mono" style={{ padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)", color: "var(--print-2)" }}>
                      {o.time}
                    </td>
                    <td style={{ padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)" }}>
                      <Badge tone={o.tone} quiet={o.tone === "plain"}>
                        {o.state}
                      </Badge>
                    </td>
                    <td style={{ padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)", color: "var(--print-2)" }}>
                      {o.note}
                    </td>
                  </tr>
                ))}
              </FeedIn>
            </table>
          </div>

          {/* The sleeve's tear line, on the sheet that carries the week. */}
          <div
            aria-hidden
            className="perf"
            style={{
              height: "calc(var(--cell) * 1.5)",
              background: "var(--label)",
              backgroundRepeat: "repeat-x",
              backgroundPosition: "left center",
            }}
          />
        </Stage>

        <Stage step={2} name="It calls, and it listens">
          <h2
            className="display"
            style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 2)" }}
          >
            When something matters, you get the patient&rsquo;s own words.
          </h2>
          <p
            className="measure"
            style={{ color: "var(--bench-ink-2)", margin: "0 0 calc(var(--cell) * 4)" }}
          >
            Answers come back as the specific things you asked about, not as a
            summary you have to trust. Behind every flag is the sentence the
            patient actually said, so you are reading evidence rather than an
            interpretation of it.
          </p>

          <div className="sheet" style={{ padding: "calc(var(--cell) * 3)" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "calc(var(--cell) * 1.5)",
                paddingBottom: "calc(var(--cell) * 2)",
                borderBottom: "1px solid var(--rule-ink)",
                marginBottom: "calc(var(--cell) * 2.5)",
              }}
            >
              <span className="caps mono" style={{ color: "var(--print-3)" }}>
                19 Aug · 17:31 · day 3 of 7
              </span>
              <Badge tone="danger">Escalated to you</Badge>
            </div>

            <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}>
              What the patient said
            </p>
            <blockquote
              style={{
                margin: "0 0 calc(var(--cell) * 3)",
                padding: "0 0 0 calc(var(--cell) * 2)",
                borderLeft: "1px solid var(--rule-ink)",
                fontSize: 19,
                lineHeight: 1.5,
                color: "var(--print)",
              }}
            >
              &ldquo;I threw up twice yesterday and I couldn&rsquo;t keep water
              down.&rdquo;
            </blockquote>

            <div
              style={{
                display: "grid",
                gap: "calc(var(--cell) * 2)",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              {[
                ["Taking as prescribed", "yes"],
                ["Stomach upset", "severe"],
                ["Dizziness", "no"],
              ].map(([slot, value]) => (
                <div key={slot} style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--cell)" }}>
                  <div className="caps" style={{ color: "var(--print-3)" }}>
                    {slot}
                  </div>
                  <div className="mono" style={{ fontSize: 17, color: "var(--print)" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <p
              style={{
                margin: "calc(var(--cell) * 3) 0 0",
                paddingTop: "calc(var(--cell) * 2)",
                borderTop: "1px solid var(--rule-ink)",
                color: "var(--print-2)",
                fontSize: 14,
              }}
            >
              An urgent escalation <strong>pauses the rest of the plan</strong>{" "}
              and puts it in your queue. You resume it or close it. Care Loop
              never decides that a patient is finished, and a call that went fine
              never ends a follow-up early.
            </p>
          </div>
        </Stage>

        <Stage step={3} name="You stay the clinician">
          <h2
            className="display"
            style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 2)" }}
          >
            It does the dialling. You keep the judgement.
          </h2>

          <div
            style={{
              display: "grid",
              gap: "calc(var(--cell) * 4) calc(var(--cell) * 6)",
              gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
              marginTop: "calc(var(--cell) * 4)",
            }}
          >
            {CONTROLS.map((c) => (
              <div key={c.title} style={{ borderTop: "1px solid var(--bench-line)", paddingTop: "calc(var(--cell) * 2)" }}>
                <h3
                  style={{
                    margin: "0 0 calc(var(--cell) * 1)",
                    fontSize: 17,
                    fontWeight: 700,
                    color: "var(--bench-ink)",
                    lineHeight: 1.3,
                  }}
                >
                  {c.title}
                </h3>
                <p style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 15 }}>{c.body}</p>
              </div>
            ))}
          </div>
        </Stage>

        <Stage step={4} name="What it will never do">
          <h2
            className="display"
            style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 2)" }}
          >
            The limits are written down, and the agent cannot talk past them.
          </h2>
          <p
            className="measure"
            style={{ color: "var(--bench-ink-2)", margin: "0 0 calc(var(--cell) * 4)" }}
          >
            Every question is checked before it can ever be spoken, and the whole
            script is checked again around it — so the agent can ask &ldquo;any
            side effects?&rdquo; while remaining unable to say &ldquo;side
            effects are normal&rdquo;. When it refuses, the reason is printed on
            the call for you to read.
          </p>

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {REFUSALS.map((text) => (
              <li
                key={text}
                className="sheet refusal-row"
                style={{
                  display: "grid",
                  gap: "calc(var(--cell) * 2)",
                  alignItems: "start",
                  padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
                  marginBottom: "calc(var(--cell) * 1)",
                }}
              >
                <Badge tone="danger">Refuses</Badge>
                <span style={{ color: "var(--print)", fontSize: 15 }}>{text}</span>
              </li>
            ))}
          </ul>
        </Stage>
      </div>

      {/* --------------------------------------------------------------- close */}
      <div style={{ borderTop: "1px solid var(--bench-line)", background: "var(--bench-2)" }}>
        <div
          style={{
            maxWidth: "var(--maxw)",
            margin: "0 auto",
            padding: "calc(var(--cell) * 8) calc(var(--cell) * 3)",
          }}
        >
          <h2
            className="display"
            style={{ fontSize: "clamp(28px, 3.6vw, 44px)", margin: "0 0 calc(var(--cell) * 4)" }}
          >
            Where this actually is.
          </h2>

          <div
            style={{
              display: "grid",
              gap: "calc(var(--cell) * 5)",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              marginBottom: "calc(var(--cell) * 5)",
            }}
          >
            <div>
              <div style={{ marginBottom: "calc(var(--cell) * 1.5)" }}>
                <Badge tone="clear">Built and tested</Badge>
              </div>
              <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 2.5)", color: "var(--bench-ink-2)" }}>
                {BUILT.map((b) => (
                  <li key={b} style={{ marginBottom: "calc(var(--cell) * 0.75)" }}>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div style={{ marginBottom: "calc(var(--cell) * 1.5)" }}>
                <Badge tone="amber">Not built yet</Badge>
              </div>
              <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 2.5)", color: "var(--bench-ink-3)" }}>
                {NOT_BUILT.map((b) => (
                  <li key={b} style={{ marginBottom: "calc(var(--cell) * 0.75)" }}>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p
            className="measure"
            style={{ color: "var(--bench-ink-2)", margin: "0 0 calc(var(--cell) * 4)" }}
          >
            The console runs on fixed demo data while the database lands.
            Anything half-finished says so on screen rather than faking it —
            which is the same rule the product applies to a phone call it cannot
            resolve.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
            <Button href="/patients">See it running</Button>
            <Button href="/queue" variant="ghost">
              Go straight to the queue
            </Button>
          </div>
        </div>
      </div>

      <footer
        style={{
          borderTop: "1px solid var(--bench-line)",
          padding: "calc(var(--cell) * 4) calc(var(--cell) * 3)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--maxw)",
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 2)",
            alignItems: "center",
          }}
        >
          {/* Caution, not danger. Red belongs to escalations and live dialling. */}
          <Badge tone="amber">Not for real patient data</Badge>
          <span className="caps" style={{ color: "var(--bench-ink-3)" }}>
            Built on CALL-E for the &ldquo;Your Code Is Calling&rdquo; hackathon
          </span>
        </div>
      </footer>
    </main>
  );
}
