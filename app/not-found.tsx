/**
 * A URL that names nothing.
 *
 * Reached by `notFound()` from a patient, plan or call id that does not exist —
 * usually a link from a record that was deleted, or a hand-typed id.
 */

import { Button, Masthead } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <Masthead />
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "calc(var(--cell) * 10) calc(var(--cell) * 3)",
        }}
      >
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 2)",
            color: "var(--bench-ink)",
          }}
        >
          There is nothing here.
        </h1>
        <p
          className="measure"
          style={{ margin: "0 0 calc(var(--cell) * 4)", color: "var(--bench-ink-2)" }}
        >
          That address does not name a patient, a plan or a call. It may have
          been deleted, or the link may be out of date.
        </p>
        <Button variant="primary" href="/patients">
          Back to the patients
        </Button>
      </div>
    </>
  );
}
