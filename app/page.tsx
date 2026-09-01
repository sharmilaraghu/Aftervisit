/**
 * The landing page — a `Persuade` surface.
 *
 * One artifact, not four explanations of it. The visitor is a clinician
 * deciding whether they would let this thing phone their patients, and the
 * fastest honest answer is the product running: the compile sheet on the right
 * of the hero is the real pipeline's shape, pulled by hand. Everything the old
 * stage sections said — the dated week, the Defaulted mark, the locked rules —
 * the pulled sheet already shows. So the page is a masthead, a hero, one
 * refusal, and a footer, and its only job is getting the tab pulled.
 */

import { CompileSheet } from "@/components/CompileSheet";
import { Badge, Button, Masthead } from "@/components/ui";

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
                margin: "0 0 calc(var(--cell) * 4)",
              }}
            >
              Write the note you already write. Care Loop compiles it into a
              dated calling plan, you approve it once, and it phones your
              patient all week — escalating the ones who need you, and catching
              the one who quietly stops answering.
            </p>

            {/*
              The pull tab is the primary action in this viewport, so this is
              not amber-filled. One amber primary per view.
            */}
            <Button href="/patients" variant="ghost">
              See it running
            </Button>
          </div>

          {/* The product, running. Not a screenshot of it. */}
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <CompileSheet />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- the one limit */}
      <div
        style={{
          maxWidth: "var(--maxw)",
          margin: "0 auto",
          padding: "calc(var(--cell) * 5) calc(var(--cell) * 3)",
        }}
      >
        <div
          className="sheet refusal-row"
          style={{
            display: "grid",
            gap: "calc(var(--cell) * 2)",
            alignItems: "start",
            padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
          }}
        >
          <Badge tone="danger">Refuses</Badge>
          <span style={{ color: "var(--print)", fontSize: 15 }}>
            Advice, diagnosis, reassurance — anything clinical goes to you, not
            to the patient. Three escalation rules enforce that, and neither you
            nor the model can remove them.
          </span>
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
