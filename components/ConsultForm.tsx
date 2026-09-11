"use client";

/**
 * The doctor's one control: the note.
 *
 * Everything else about the follow-up — the questions, the schedule, what to
 * escalate on — is compiled from this text and shown on the next screen, where
 * it can be corrected before anything is approved.
 *
 * One optional second box: what should bring the patient back to the doctor.
 * It is kept verbatim — triage reads each call against these words — so a
 * doctor who has a view says it here, and one who has none leaves it empty and
 * the standard red flags still stand.
 */

import { useActionState } from "react";

import { Button, Field, Panel, Textarea, describedBy } from "@/components/ui";
import { consultAction } from "@/app/(console)/plans/actions";
import { EMPTY_COMPILE_FORM } from "@/lib/patients/plan-form";
import type { VisitKind } from "@/lib/db/enums";

const PLACEHOLDER: Record<VisitKind, string> = {
  /* Framed as an example. It used to open with "Day 2 after…" in dark mono,
     which read as a note already written — and contradicted a patient whose
     complaint said day 3. */
  consultation:
    "For example: started metformin 500mg BD today for newly diagnosed type 2 diabetes.\n" +
    "Follow up daily for a week. I want to know she is taking it and tolerating it.",
  post_op:
    "For example: after laparoscopic cholecystectomy, follow up daily for five days. " +
    "Wound dry, pain settling, eating. Watch the wound and her appetite.",
};

export function ConsultForm({
  visitId,
  kind,
  canCompile,
}: {
  visitId: string;
  kind: VisitKind;
  canCompile: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    consultAction.bind(null, visitId),
    EMPTY_COMPILE_FORM,
  );

  return (
    <form action={formAction}>
      <Panel title="Follow-up note" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {!canCompile ? (
            <p
              style={{
                margin: "0 0 calc(var(--cell) * 3)",
                padding: "calc(var(--cell) * 2)",
                background: "var(--amber-wash)",
                boxShadow: "inset 0 0 0 1px var(--amber)",
                color: "var(--print)",
                fontSize: 14,
              }}
            >
              <strong>No model is configured.</strong> This note will produce a blank plan
              for you to fill in by hand. Care Loop does not invent a follow-up plan without
              one.
            </p>
          ) : null}

          {state.error ? (
            <p
              role="alert"
              tabIndex={-1}
              style={{
                margin: "0 0 calc(var(--cell) * 3)",
                padding: "calc(var(--cell) * 2)",
                background: "var(--danger-wash)",
                boxShadow: "inset 0 0 0 1px var(--danger)",
                color: "var(--print)",
                fontSize: 14,
              }}
            >
              {state.error}
            </p>
          ) : null}

          <Field
            label="What you found, and what to follow up"
            htmlFor="note"
            hint="Your own words, at least a sentence or two. Say how long and how often if you have a view; say what should be escalated. Nothing you did not write ends up in the questions."
          >
            <Textarea
              id="note"
              name="note"
              rows={9}
              defaultValue={state.values.note}
              /* Ctrl/⌘ + Enter compiles without leaving the keyboard — the
                 note is the one thing typed here, many times a day. */
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pending) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
              placeholder={PLACEHOLDER[kind]}
              invalid={Boolean(state.error)}
              aria-describedby={describedBy("note", { hint: true })}
            />
          </Field>

          <Field
            label="Escalate to me if… (optional)"
            htmlFor="escalation"
            hint="Kept word for word. Every call is read against it, on top of the standard red flags."
          >
            <Textarea
              id="escalation"
              name="escalation"
              rows={2}
              defaultValue={state.values.escalation}
              style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
              placeholder="For example: fever over 38, the wound hot or weeping, or she stops eating."
              aria-describedby={describedBy("escalation", { hint: true })}
            />
          </Field>
        </div>
      </Panel>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Reading the note…" : "Compile the follow-up"}
        </Button>
        {pending ? (
          <Button variant="ghost" disabled>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" href="/consult">
              Cancel
            </Button>
            <span style={{ color: "var(--bench-ink-3)", fontSize: 13 }}>
              or press <kbd className="mono">Ctrl</kbd>/<kbd className="mono">⌘</kbd> +{" "}
              <kbd className="mono">Enter</kbd>
            </span>
          </>
        )}
        {/*
          The only account of a wait that can run past ten seconds. A dimmed
          button says a control is unavailable, not that work is under way, and
          a screen reader gets nothing from it at all.
        */}
        {pending ? (
          <span role="status" style={{ color: "var(--bench-ink-2)", fontSize: 14 }}>
            Compiling the questions from your note. Nothing is dialled yet.
          </span>
        ) : null}
      </div>
    </form>
  );
}
