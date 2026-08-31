"use client";

/**
 * Write a note, compile it.
 *
 * The product's one authored interaction. The note is the doctor's own words
 * and stays that way — it is stored verbatim, it is what grounding checks
 * against, and it is what the review screen shows beside the compiled plan.
 *
 * The textarea is deliberately large and mono. A consultation note is not a
 * form field; it is a paragraph someone writes while thinking, and a three-line
 * box makes people write less than they mean to.
 */

import { useActionState } from "react";

import { Button, Field, Panel, Select, Textarea } from "@/components/ui";
import { TIME_SCALE_OPTIONS, type CompileFormState } from "@/lib/patients/plan-form";

export function NoteComposer({
  action,
  initial,
  cancelHref,
  canCompile,
}: {
  action: (prev: CompileFormState, formData: FormData) => Promise<CompileFormState>;
  initial: CompileFormState;
  cancelHref: string;
  canCompile: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form action={formAction}>
      <Panel title="Consultation note">
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {!canCompile ? (
            /*
              Said before they write, not after. Without a key the compile is
              refused and they get a blank plan to fill in by hand — which is
              fine, but only if nobody is surprised by it.
            */
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
              <strong>No model is configured.</strong> Compiling will be refused and
              you will get a blank plan to fill in yourself. Care Loop does not
              invent a follow-up plan without one.
            </p>
          ) : null}

          {state.error ? (
            <p
              role="alert"
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
            label="What happened, and what you want followed up"
            htmlFor="note"
            hint="Your own words. Care Loop will not name a medication you did not write, and will not add a red flag you did not ask for."
          >
            <Textarea
              id="note"
              name="note"
              rows={10}
              defaultValue={state.values.note}
              required
              style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
              placeholder={
                "Asha K, 54. Started metformin 500mg BD today for newly diagnosed type 2 diabetes.\n" +
                "Follow up daily for a week — I want to know she is taking it and tolerating it.\n" +
                "Escalate to me same day if she reports vomiting or cannot keep fluids down."
              }
            />
          </Field>

          <Field
            label="Clock"
            htmlFor="timeScale"
            hint="Applied once, when the plan expands. Everything after that sees real timestamps."
          >
            <Select
              id="timeScale"
              name="timeScale"
              defaultValue={state.values.timeScale}
              options={TIME_SCALE_OPTIONS}
              style={{ maxWidth: 420 }}
            />
          </Field>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "center",
            }}
          >
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Compiling…" : "Compile into a plan"}
            </Button>
            <Button variant="onLabel" href={cancelHref}>
              Cancel
            </Button>
            <span className="caps" style={{ alignSelf: "center", color: "var(--print-3)" }}>
              Nothing is dialled until you approve
            </span>
          </div>
        </div>
      </Panel>
    </form>
  );
}
