"use client";

/**
 * Steps 1 to 3 of writing a follow-up: the patient and the note, what to
 * escalate on, and the schedule.
 *
 * One `<form>`, one submit, every step mounted the whole time and switched with
 * `hidden`. Three routes would need somewhere to keep a half-written note
 * between them and this app has no session; an unmounted input is absent from
 * the submission, which would silently revert a timezone the doctor had already
 * set. So going backwards costs nothing and loses nothing — the fields were
 * never gone.
 *
 * Steps 4 and 5 are not here. They cannot be: they need the compiled questions,
 * which do not exist until this form is submitted. From that point the draft is
 * a row and editing it is editing the plan itself.
 *
 * The interesting field is the phone number. It is the only one where the
 * product refuses rather than corrects: a bare `9876543210` is a real number in
 * several countries, so Care Loop will not pick one.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Field,
  Panel,
  Select,
  TextInput,
  Textarea,
  describedBy,
} from "@/components/ui";
import { Stepper, WIZARD_STEPS } from "@/components/Stepper";
import type { PatientFormState } from "@/lib/patients/form";
import { TIMEZONE_OPTIONS, zoneForNumber } from "@/lib/patients/timezones";
import { CONSENT_OPTIONS } from "@/lib/patients/labels";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";
import { TIME_SCALE_OPTIONS } from "@/lib/patients/plan-form";

type Step = 1 | 2 | 3;

/** Which step owns each field, so a rejection puts the right one on screen. */
const STEP_OF: Record<string, Step> = {
  name: 1,
  age: 1,
  phone: 1,
  language: 1,
  consent: 1,
  note: 1,
  escalationNote: 2,
  timezone: 3,
  localTime: 3,
  cadence: 3,
  durationDays: 3,
};

const CADENCE_OPTIONS = [
  { value: "", label: "From the note" },
  { value: "daily", label: "Every day" },
  { value: "every_other_day", label: "Every other day" },
  { value: "weekly", label: "Once a week" },
];

export function Wizard({
  action,
  initial,
  patientId,
  planId,
  openAt = 1,
  canCompile,
}: {
  action: (prev: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  initial: PatientFormState;
  /** Set when this is a returning patient: their record is corrected, not created. */
  patientId?: string;
  /** Set when stepping back into a draft that has already been compiled. */
  planId?: string;
  /** Which step to open on, so the stepper's links land where they point. */
  openAt?: Step;
  canCompile: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const v = state.values;
  const form = useRef<HTMLFormElement>(null);
  /* Named, not an array: indexing a ref array counts as reading `.current`
     during render, and the three panes are a fixed set anyway. */
  const pane1 = useRef<HTMLDivElement>(null);
  const pane2 = useRef<HTMLDivElement>(null);
  const pane3 = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(openAt);

  /* The number, watched, so the timezone can follow the country code. A doctor
     typing +91 should not then have to know that London is pre-selected. */
  const [phone, setPhone] = useState(initial.values.phone);
  const suggestedZone = zoneForNumber(phone);

  /*
   * Switch step in the DOM *now*, not on the next render.
   *
   * The rejected field a caller is about to focus has to be rendered by the
   * time `.focus()` runs, and a `setState` has not landed in the DOM by the
   * next line.
   */
  const show = useCallback((next: Step) => {
    if (pane1.current) pane1.current.hidden = next !== 1;
    if (pane2.current) pane2.current.hidden = next !== 2;
    if (pane3.current) pane3.current.hidden = next !== 3;
    setStep(next);
  }, []);

  const goTo = (next: Step) => {
    show(next);
    /* The button that was clicked is on the step that just went away, so
       without this focus falls to the body and a keyboard user restarts. */
    const pane = next === 1 ? pane1 : next === 2 ? pane2 : pane3;
    pane.current?.querySelector<HTMLElement>(".control")?.focus();
    window.scrollTo({ top: 0 });
  };

  /*
   * Move focus to whatever was rejected, on the step that owns it.
   *
   * A rejection on a step that is not showing is an error nobody can see and a
   * focus target nobody can reach.
   */
  useEffect(() => {
    const keys = Object.keys(state.errors);
    if (keys.length === 0) return;
    const first = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"]',
    );
    if (!first) return;
    /* Whichever pane actually contains the rejected control, falling back to
       the field map for a form-level error that belongs to no pane. */
    const owner = pane3.current?.contains(first)
      ? 3
      : pane2.current?.contains(first)
        ? 2
        : pane1.current?.contains(first)
          ? 1
          : (keys.map((k) => STEP_OF[k]).filter(Boolean).sort()[0] ?? 1);
    show(owner as Step);
    first.focus({ preventScroll: false });
    if (!first.matches("input, select, textarea")) {
      first.scrollIntoView({ block: "center" });
    }
  }, [state, show]);

  return (
    <form action={formAction} ref={form}>
      {patientId ? <input type="hidden" name="patientId" value={patientId} /> : null}
      {planId ? <input type="hidden" name="planId" value={planId} /> : null}

      {/* Once the draft exists every step is reachable, and the two that are
          routes carry the plan id. Before it, there is nothing on 4 and 5. */}
      <Stepper
        current={step}
        reached={planId ? 5 : 3}
        planId={planId}
        onGo={(n) => goTo(n as Step)}
      />

      {/* ------------------------------------------- step 1: the patient and the note */}
      <div ref={pane1} hidden={step !== 1}>
        <Panel title={WIZARD_STEPS[0]} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3) calc(var(--cell) * 3) calc(var(--cell) * 2)" }}>
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

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: "0 calc(var(--cell) * 3)",
              }}
            >
              <div style={{ flex: "1 1 calc(var(--cell) * 24)", minWidth: 0 }}>
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
              </div>

              <div style={{ flex: "0 1 calc(var(--cell) * 14)" }}>
                <Field label="Age" htmlFor="age" error={state.errors.age}>
                  <TextInput
                    id="age"
                    name="age"
                    inputMode="numeric"
                    mono
                    defaultValue={v.age}
                    required
                    style={{ maxWidth: 96 }}
                    invalid={Boolean(state.errors.age)}
                    aria-describedby={describedBy("age", { error: Boolean(state.errors.age) })}
                  />
                </Field>
              </div>

              <div style={{ flex: "0 1 calc(var(--cell) * 28)", minWidth: 0 }}>
                <Field label="Phone" htmlFor="phone" error={state.errors.phone}>
                  <TextInput
                    id="phone"
                    onChange={(e) => setPhone(e.target.value)}
                    name="phone"
                    mono
                    /* 555-01xx only: this placeholder renders on screen, and the
                       screen ends up in a published video. */
                    placeholder="+14155550123"
                    defaultValue={v.phone}
                    required
                    autoComplete="off"
                    invalid={Boolean(state.errors.phone)}
                    aria-describedby={describedBy("phone", {
                      hint: true,
                      error: Boolean(state.errors.phone),
                    })}
                  />
                </Field>
              </div>
            </div>

            <p
              id="phone-hint"
              style={{
                margin: "calc(var(--cell) * -1) 0 calc(var(--cell) * 2)",
                color: "var(--print-3)",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              Full international format, starting with +. Care Loop will not guess a
              country code.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--cell) * 34), 1fr))",
                gap: "0 calc(var(--cell) * 3)",
              }}
            >
              <Field
                label="Language"
                htmlFor="language"
                error={state.errors.language}
                hint="What the agent speaks on the call."
              >
                <Select
                  id="language"
                  name="language"
                  defaultValue={v.language}
                  options={LANGUAGE_OPTIONS}
                  invalid={Boolean(state.errors.language)}
                  aria-describedby={describedBy("language", {
                    hint: true,
                    error: Boolean(state.errors.language),
                  })}
                />
              </Field>

              {/*
                Three states, not a tickbox. A checkbox can only say "agreed" or
                "nothing recorded", so a patient who actively refuses would be
                indistinguishable from one nobody had asked. Care Loop dials
                without a human pressing a button per call, so this is what
                authorises every one of them.
              */}
              <Field
                label="Consent to automated calls"
                htmlFor="consent"
                error={state.errors.consent}
                hint="Anything but agreed and every call is refused, with a reason on the record."
              >
                <Select
                  id="consent"
                  name="consent"
                  defaultValue={v.consent}
                  options={CONSENT_OPTIONS}
                  invalid={Boolean(state.errors.consent)}
                  aria-describedby={describedBy("consent", {
                    hint: true,
                    error: Boolean(state.errors.consent),
                  })}
                />
              </Field>
            </div>
          </div>

          <div
            style={{
              padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3) calc(var(--cell) * 3)",
              borderTop: "1px solid var(--rule)",
            }}
          >
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
                <strong>No model is configured.</strong> This note will produce a blank
                plan for you to fill in by hand. Care Loop does not invent a follow-up
                plan without one.
              </p>
            ) : null}

            <Field
              label="The consultation note"
              htmlFor="note"
              error={state.errors.note}
              hint="What happened, and what you want followed up. Your own words — nothing you did not write ends up in the questions."
            >
              <Textarea
                id="note"
                name="note"
                rows={5}
                defaultValue={v.note}
                style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
                placeholder={
                  "Started metformin 500mg BD today for newly diagnosed type 2 diabetes.\n" +
                  "Follow up daily for a week — I want to know she is taking it and tolerating it."
                }
                invalid={Boolean(state.errors.note)}
                aria-describedby={describedBy("note", {
                  hint: true,
                  error: Boolean(state.errors.note),
                })}
              />
            </Field>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------- step 2: escalating conditions */}
      <div ref={pane2} hidden={step !== 2}>
        <Panel title={WIZARD_STEPS[1]} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {/*
              Kept verbatim and handed to the triage model as the doctor's own
              wording, which is why it is a step and not a field on the end of
              the note: what gets a person woken up is a different decision from
              what gets asked.
            */}
            <Field
              label="Escalating conditions"
              htmlFor="escalationNote"
              error={state.errors.escalationNote}
              hint="Optional, and kept verbatim. Four rules always fire without it: the patient asks for a person, emergency language, an answer nobody could map, and nobody answering at all."
            >
              <Textarea
                id="escalationNote"
                name="escalationNote"
                rows={5}
                defaultValue={v.escalationNote}
                style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
                placeholder={
                  "Vomiting, or she cannot keep fluids down.\n" +
                  "Anything that has stopped her taking the metformin."
                }
                invalid={Boolean(state.errors.escalationNote)}
                aria-describedby={describedBy("escalationNote", {
                  hint: true,
                  error: Boolean(state.errors.escalationNote),
                })}
              />
            </Field>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------------ step 3: schedule */}
      <div ref={pane3} hidden={step !== 3}>
        <Panel title={WIZARD_STEPS[2]} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p
              className="measure"
              style={{
                margin: "0 0 calc(var(--cell) * 3)",
                color: "var(--print-2)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Anything left on <strong>From the note</strong> is taken from what you wrote.
            </p>

            {/*
              Two columns, and every control fills its own.
              The time and the day count were 140px and 120px boxes sitting in
              half-width columns, so each ended in a hard left edge with a
              stretch of empty stock beside it and the sheet read as unfinished.
              A field's width is the column's, not its content's.
            */}
            <div className="field-grid">
              <Field
                label="Timezone"
                htmlFor="timezone"
                error={state.errors.timezone}
                hint={
                  suggestedZone
                    ? "Taken from the country code. Change it if the patient is elsewhere."
                    : "Calls are placed at the best time to call, in this zone."
                }
              >
                <Select
                  id="timezone"
                  name="timezone"
                  /* Keyed on the suggestion so the select re-reads it when the
                     number changes and the doctor has not chosen one. */
                  key={suggestedZone ?? "none"}
                  defaultValue={v.timezone || suggestedZone || ""}
                  options={[{ value: "", label: "Choose a timezone" }, ...TIMEZONE_OPTIONS]}
                  invalid={Boolean(state.errors.timezone)}
                  aria-describedby={describedBy("timezone", {
                    hint: true,
                    error: Boolean(state.errors.timezone),
                  })}
                />
              </Field>

              <Field
                label="Best time to call"
                htmlFor="localTime"
                error={state.errors.localTime}
                hint="24-hour, in the patient's zone."
              >
                <TextInput
                  id="localTime"
                  name="localTime"
                  mono
                  placeholder="From the note"
                  defaultValue={v.localTime}
                  invalid={Boolean(state.errors.localTime)}
                  aria-describedby={describedBy("localTime", {
                    hint: true,
                    error: Boolean(state.errors.localTime),
                  })}
                />
              </Field>

              <Field
                label="How often"
                htmlFor="cadence"
                error={state.errors.cadence}
                hint="How many days between calls."
              >
                <Select
                  id="cadence"
                  name="cadence"
                  defaultValue={v.cadence}
                  options={CADENCE_OPTIONS}
                  invalid={Boolean(state.errors.cadence)}
                  aria-describedby={describedBy("cadence", {
                    hint: true,
                    error: Boolean(state.errors.cadence),
                  })}
                />
              </Field>

              <Field
                label="For how many days"
                htmlFor="durationDays"
                error={state.errors.durationDays}
                hint="Calendar days from approval, 1 to 90."
              >
                <TextInput
                  id="durationDays"
                  name="durationDays"
                  inputMode="numeric"
                  mono
                  placeholder="From the note"
                  defaultValue={v.durationDays}
                  invalid={Boolean(state.errors.durationDays)}
                  aria-describedby={describedBy("durationDays", {
                    hint: true,
                    error: Boolean(state.errors.durationDays),
                  })}
                />
              </Field>
            </div>
          </div>

          {/*
            The demo clock is not a clinical setting, so it is not in the grid
            with the four that are. Its own band says so without a sentence.
          */}
          <div
            style={{
              padding: "calc(var(--cell) * 3)",
              borderTop: "1px solid var(--rule)",
              background: "var(--label-2)",
            }}
          >
            <div className="field-grid">
              <Field
                label="Clock"
                htmlFor="timeScale"
                hint="Runs a clinical day faster, so a week of follow-up can be watched in minutes."
              >
                <Select
                  id="timeScale"
                  name="timeScale"
                  defaultValue={v.timeScale}
                  options={TIME_SCALE_OPTIONS}
                  aria-describedby={describedBy("timeScale", { hint: true })}
                />
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      {/* ----------------------------------------------------------------- the controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        {step > 1 ? (
          <Button variant="ghost" type="button" onClick={() => goTo((step - 1) as Step)}>
            Back
          </Button>
        ) : null}

        {step < 3 ? (
          <Button variant="primary" type="button" onClick={() => goTo((step + 1) as Step)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : planId ? "Save and continue" : "Compile the questions"}
          </Button>
        )}

        <Button variant="ghost" href={patientId ? `/patients/${patientId}` : "/patients"}>
          Cancel
        </Button>

        {step === 3 ? (
          <span style={{ color: "var(--bench-ink-2)", fontSize: 14, maxWidth: "52ch" }}>
            {planId
              ? "Nothing is dialled yet. Changing the note recompiles the questions and replaces any you edited."
              : "Nothing is dialled yet. This writes a draft plan for you to review."}
          </span>
        ) : null}
      </div>
    </form>
  );
}
