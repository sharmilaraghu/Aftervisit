/**
 * The landing page — a `Persuade` surface, and one screen.
 *
 * The visitor is a clinician deciding whether they would let this thing phone
 * their patients, and the fastest honest answer is the product running: the
 * compile sheet is the real pipeline's shape, pulled by hand. So the page is
 * the sheet, the sentence that frames it, the four stages the agent owns, and
 * the door into the console — nothing that needs a scroll to reach.
 *
 * The hero is a client component because pulling the tab marks the stages it
 * performed; everything else here is static.
 */

import { Hero } from "@/components/Hero";
import { Badge, Masthead } from "@/components/ui";

export default function Home() {
  return (
    <main
      style={{
        /* One screen: the hero takes what the chrome and the foot do not. */
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(120% 80% at 10% 0%, var(--bench-3) 0%, var(--bench) 58%)",
      }}
    >
      <Masthead />

      <Hero />

      {/* ------------------------------------------------------------- the foot */}
      <footer
        style={{
          borderTop: "1px solid var(--bench-line)",
          padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 3)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--maxw)",
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--cell) calc(var(--cell) * 2)",
          }}
        >
          {/*
            The refusal is the product's differentiator, so it stays on the
            page — as one line at the foot rather than its own band.
          */}
          <Badge tone="danger">Refuses</Badge>
          <span style={{ fontSize: 14, color: "var(--bench-ink-2)" }}>
            Advice, diagnosis and reassurance go to you, never to the patient.
          </span>
          {/* The one string a judge wants to click, so it is a link. */}
          <a
            className="caps"
            href="https://github.com/CALLE-AI/awesome-phone-call-agents"
            style={{ color: "var(--bench-ink-3)", marginLeft: "auto" }}
          >
            Built for the CALL-E hackathon
          </a>
        </div>
      </footer>
    </main>
  );
}
