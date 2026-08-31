"use client";

/**
 * Add or edit a patient — and, when adding, write the follow-up note in the
 * same step.
 *
 * The note belongs here because that is when it exists. A doctor writes it at
 * the consultation, with the patient in front of them; making them save a
 * record, land on a detail page, and then find a second screen to write the
 * note describes a workflow nobody has. The note is optional, so pure admin
 * entry still works — but the default path is one page, one submit.
 *
 * The interesting field is the phone number. It is the only one where the
 * product refuses rather than corrects: a bare `9876543210` is a real number in
 * several countries, so Care Loop will not pick one. That refusal is the first
 * thing a visitor sees the product actually do, so it is given room — mono,
 * because a number is read digit by digit.
 */

import { useActionState, useEffect, useRef } from "react";

import { Button, Field, Panel, Select, TextInput, Textarea, describedBy } from "@/components/ui";
import type { PatientFormState } from "@/lib/patients/form";
import { TIMEZONE_OPTIONS } from "@/lib/patients/timezones";
import { TIME_SCALE_OPTIONS } from "@/lib/patients/plan-form";

export function PatientForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  withNote = false,
  canCompile = false,
}: {
  action: (prev: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  initial: PatientFormState;
  submitLabel: string;
  cancelHref: string;
  /** Adding a patient shows the note; editing one does not. */
  withNote?: boolean;
  canCompile?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const v = state.values;
  const form = useRef<HTMLFormElement>(null);

  /*
   * Move focus to whatever was rejected.
   *
   * Without this a keyboard or screen-reader user submits, the page does not
   * navigate, and nothing announces why — the error is rendered hundreds of
   * pixels away from where they are. `role="alert"` reads the message but does
   * not move the caret to the field that needs fixing.
   */
  useEffect(() => {
    if (Object.keys(state.errors).length === 0) return;
    const first = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"]',
    );
    first?.focus({ preventScroll: false });
    if (first && !first.matches("input, select, textarea")) {
      first.scrollIntoView({ block: "center" });
    }
  }, [state]);

  return (
    <form action={formAction} ref={form}>
      <Panel title="Patient" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {state.errors.form ? (
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
              {state.errors.form}
            </p>
          ) : null}

          <Field label="Name" htmlFor="name" error={state.errors.name}>
            <TextInput
              id="name"
              name="name"
              defaultValue={v.name}
              required
              autoComplete="off"
              invalid={Boolean(state.errors.name)}
              aria-describedby={describedBy("name", { error: Boolean(state.errors.name) })}
            />
          </Field>

          <Field label="Age" htmlFor="age" error={state.errors.age}>
            <TextInput
              id="age"
              name="age"
              inputMode="numeric"
              mono
              defaultValue={v.age}
              required
              style={{ maxWidth: 120 }}
              invalid={Boolean(state.errors.age)}
              aria-describedby={describedBy("age", { error: Boolean(state.errors.age) })}
            />
          </Field>

          <Field
            label="Phone"
            htmlFor="phone"
            error={state.errors.phone}
            hint="Full international format, starting with +. Care Loop will not guess a country code."
          >
            <TextInput
              id="phone"
              name="phone"
              mono
              /* 555-01xx only: this placeholder renders on screen, and the screen
                 ends up in a published video. */
              placeholder="+14155550123"
              defaultValue={v.phone}
              required
              autoComplete="off"
              style={{ maxWidth: 320 }}
              invalid={Boolean(state.errors.phone)}
              aria-describedby={describedBy("phone", {
                hint: true,
                error: Boolean(state.errors.phone),
              })}
            />
          </Field>

          <Field
            label="Timezone"
            htmlFor="timezone"
            error={state.errors.timezone}
            hint="Calls are placed at the plan's local time in this zone."
          >
            <Select
              id="timezone"
              name="timezone"
              defaultValue={v.timezone}
              options={TIMEZONE_OPTIONS}
              style={{ maxWidth: 420 }}
              invalid={Boolean(state.errors.timezone)}
              aria-describedby={describedBy("timezone", {
                hint: true,
                error: Boolean(state.errors.timezone),
              })}
            />
          </Field>

        </div>
      </Panel>

      {withNote ? (
        <Panel
          title="Follow-up note"
          aside={
            <span className="caps" style={{ color: "var(--print-3)" }}>
              Optional
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
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
                <strong>No model is configured.</strong> A note written here will
                produce a blank plan for you to fill in by hand. Care Loop does not
                invent a follow-up plan without one.
              </p>
            ) : null}

            <Field
              label="What happened, and what you want followed up"
              htmlFor="note"
              error={state.errors.note}
              hint="Your own words. Care Loop will not name a medication you did not write, and will not add a red flag you did not ask for. Leave this blank to save the patient without a plan."
            >
              <Textarea
                id="note"
                name="note"
                rows={8}
                defaultValue={v.note}
                style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
                placeholder={
                  "Started metformin 500mg BD today for newly diagnosed type 2 diabetes.\n" +
                  "Follow up daily for a week — I want to know she is taking it and tolerating it.\n" +
                  "Escalate to me same day if she reports vomiting or cannot keep fluids down."
                }
                invalid={Boolean(state.errors.note)}
                aria-describedby={describedBy("note", {
                  hint: true,
                  error: Boolean(state.errors.note),
                })}
              />
            </Field>

            <Field
              label="Clock"
              htmlFor="timeScale"
              hint="Real time calls once a day. The demo speeds only compress the calendar — the calls themselves are identical."
            >
              <Select
                id="timeScale"
                name="timeScale"
                defaultValue={v.timeScale}
                options={TIME_SCALE_OPTIONS}
                style={{ maxWidth: 420 }}
                aria-describedby={describedBy("timeScale", { hint: true })}
              />
            </Field>
          </div>
        </Panel>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" href={cancelHref}>
          Cancel
        </Button>
        {withNote ? (
          <span className="caps" style={{ alignSelf: "center", color: "var(--bench-ink-3)" }}>
            Nothing is dialled until you approve the plan
          </span>
        ) : null}
      </div>
    </form>
  );
}
