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
 * Adding a patient is therefore two things at once, so it is shown as two
 * steps: the consultation (who this is, how to reach them, what to follow up,
 * what to escalate on, and the consent that authorises dialling), then the
 * call settings, which all have a correct default and matter in a minority of
 * cases. They used to sit in a shut disclosure, which asked the doctor to
 * decide whether to open a drawer before they knew what was in it; a numbered
 * step tells them there are two and that they are on the first.
 *
 * Both steps live in **one `<form>` and one submit**, for two reasons. Two
 * routes would need somewhere to keep the half-written note between them, and
 * this app has no session to keep it in. And every field stays mounted the
 * whole time — hidden, never unmounted — because an unmounted input is absent
 * from the submission, which would silently revert a timezone the doctor had
 * already set.
 *
 * Editing is not stepped. It is four fields with no note and no demo clock, and
 * a wizard over four fields is ceremony.
 *
 * The interesting field is the phone number. It is the only one where the
 * product refuses rather than corrects: a bare `9876543210` is a real number in
 * several countries, so Care Loop will not pick one. That refusal is the first
 * thing a visitor sees the product actually do, so it is given room — mono,
 * because a number is read digit by digit.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import {
  Badge,
  Button,
  Field,
  Panel,
  Select,
  TextInput,
  Textarea,
  describedBy,
} from "@/components/ui";
import type { PatientFormState } from "@/lib/patients/form";
import { TIMEZONE_OPTIONS, zoneForNumber } from "@/lib/patients/timezones";
import { CONSENT_OPTIONS } from "@/lib/patients/labels";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";

/** The three states the dial gate actually distinguishes. */


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
  const consultation = useRef<HTMLDivElement>(null);
  const settings = useRef<HTMLDivElement>(null);

  /* Only the add path has two steps' worth of work in it. */
  const stepped = withNote;
  const [step, setStep] = useState(1);
  /*
   * The number, watched, so the timezone can follow the country code. A doctor
   * typing +91 should not then have to know that London is pre-selected.
   */
  const [phone, setPhone] = useState(initial.values.phone);
  const suggestedZone = zoneForNumber(phone);

  /*
   * Switch step in the DOM *now*, not on the next render.
   *
   * Everything below depends on this: the rejected field a caller is about to
   * focus has to be rendered by the time `.focus()` runs, and a `setState` has
   * not landed in the DOM by the next line. So the attribute is written on the
   * element the way the old disclosure's `open` was, and the state update only
   * keeps React's idea of the form in step.
   */
  const show = useCallback((next: 1 | 2) => {
    if (consultation.current) consultation.current.hidden = next !== 1;
    if (settings.current) settings.current.hidden = next !== 2;
    setStep(next);
  }, []);

  /** Move to a step the user asked for, and take the caret with them. */
  const goTo = (next: 1 | 2) => {
    show(next);
    /* The button that was clicked unmounts with the step it belonged to, so
       without this focus falls to the body and a keyboard user restarts. */
    const ref = next === 1 ? consultation : settings;
    ref.current?.querySelector<HTMLElement>(".control")?.focus();
  };

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
    if (!first) return;
    /*
     * A rejection on the step that is not showing is an error nobody can see
     * and a focus target nobody can reach, so the step containing it is put on
     * screen first — a timezone the server refused must not leave the doctor
     * looking at a form that appears to have nothing wrong with it.
     */
    if (stepped) show(settings.current?.contains(first) ? 2 : 1);
    first.focus({ preventScroll: false });
    if (!first.matches("input, select, textarea")) {
      first.scrollIntoView({ block: "center" });
    }
  }, [state, stepped, show]);

  const onLastStep = !stepped || step === 2;

  return (
    <form action={formAction} ref={form}>
      {/* ------------------------------------------------- step 1: the consultation */}
      <div ref={consultation} hidden={stepped && step !== 1}>
        <Panel
          /* Editing is not a consultation — it is four fields and a tickbox. */
          title={withNote ? "The patient and the note" : "The patient"}
          aside={
            stepped ? (
              <Badge tone="plain" quiet>
                Step 1 of 2
              </Badge>
            ) : null
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          {/*
            One sheet, three bands, divided by hairlines.

            These were three separate sheets — Patient, Follow-up note, Consent
            — and the chrome cost more than the content: three header bands,
            three sets of 24px padding and two 16px gaps of bench, about 120px
            of structure wrapped around four short controls and a textarea. A
            dispensing label is one sheet with rules ruled across it, so this
            is one sheet with rules ruled across it.
          */}
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

            {/*
              Who this is and how to reach them: one thought, so one line.

              Name, age and phone used to occupy two rows, and the phone's
              320px box left 452px of blank stock beside it — the void that
              made this screen read as mostly empty. Three columns that add up
              to the sheet's width answer the same question in half the height.
            */}
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

              {/* Wider than the 96px box it holds, so a rejected age still has
                  a column its sentence can wrap in. */}
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

            {/*
              The phone's hint runs under the whole row rather than under its
              own 260px column, where it wrapped to five lines and reintroduced
              the height the row had just saved. Why Care Loop refuses rather
              than guesses is the *refusal's* job to say, and it does.
            */}
            <p
              id="phone-hint"
              style={{
                margin: "calc(var(--cell) * -1) 0 0",
                color: "var(--print-3)",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              Full international format, starting with +. Care Loop will not guess a
              country code.
            </p>
          </div>

          {withNote ? (
            <div
              style={{
                padding: "calc(var(--cell) * 3)",
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
                  <strong>No model is configured.</strong> A note written here will
                  produce a blank plan for you to fill in by hand. Care Loop does not
                  invent a follow-up plan without one.
                </p>
              ) : null}

              <Field
                label="The consultation note"
                htmlFor="note"
                error={state.errors.note}
                hint="What happened, and what you want followed up — your own words. Care Loop will not name a medication you did not write, and will not add a red flag you did not ask for. Leave this blank to save the patient without a plan."
              >
                <Textarea
                  id="note"
                  name="note"
                  rows={7}
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

              {/*
                Directly under the note, because the two are compiled together
                and neither is complete without the other: the note above
                becomes the questions the agent asks, and this becomes what an
                answer has to contain before a person is woken up.

                The label used to read "What you want to hear about the same
                day", which is a riddle — it names neither the action nor who
                acts. A doctor writing this in a real note writes "escalate
                same day if…", and the seeded notes in this repo all do.
              */}
              <Field
                label="Escalating conditions"
                htmlFor="escalationNote"
                error={state.errors.escalationNote}
                hint="Optional, and kept in your words. Care Loop will not escalate on a term you did not write. Three rules fire without it: the patient asks for a person, an answer that cannot be mapped, and anything urgent said on the call."
              >
                <Textarea
                  id="escalationNote"
                  name="escalationNote"
                  rows={3}
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
          ) : null}

          {/*
            The one field on this form that authorises anything, so it is the
            last band read before the form is committed rather than a tickbox
            halfway up it. Care Loop dials without a human pressing a button
            per call, so the human act moved here: unticked, every call to this
            patient is refused with a visible reason. Deliberately not
            pre-ticked.
          */}
          <div
            style={{
              padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3)",
              borderTop: "1px solid var(--rule-ink)",
              background: "var(--label-2)",
            }}
          >
            {/*
              Three states, not a tickbox.
              
              A checkbox can only say "agreed" or "nothing recorded", so a
              patient who *actively refuses* was indistinguishable from one
              nobody had asked — even though `declined` exists in the schema,
              has its own badge tone, and is refused at dial time with its own
              reason. Recording a refusal is a clinical act and it needs
              somewhere to go.
            */}
            <Field
              label="Consent to automated calls"
              htmlFor="consent"
              error={state.errors.consent}
              hint="Recorded once, here. Care Loop dials without anyone pressing a button per call, so this is what authorises every one of them — anything but agreed and each call is refused with a reason on the record."
            >
              <Select
                id="consent"
                name="consent"
                defaultValue={v.consent}
                options={CONSENT_OPTIONS}
                style={{ maxWidth: 480 }}
                invalid={Boolean(state.errors.consent)}
                aria-describedby={describedBy("consent", {
                  hint: true,
                  error: Boolean(state.errors.consent),
                })}
              />
            </Field>
          </div>
        </Panel>
      </div>

      {/* --------------------------------------------------- step 2: call settings */}
      <div ref={settings} hidden={stepped && step !== 2}>
        <Panel
          title="How the call is placed"
          aside={
            stepped ? (
              <Badge tone="plain" quiet>
                Step 2 of 2
              </Badge>
            ) : null
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            {/* Only the second step needs saying: a step that looks like work
                is a step people rush. Editing shows a patient their own saved
                settings, which need no such invitation. */}
            {stepped ? (
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 3)",
                  color: "var(--print-2)",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                These are already answered. Change only what this patient needs.
              </p>
            ) : null}

            {/*
              Two up, not stacked.

              Three 420px selects in a 724px column left 304px of stock bare
              down the sheet's whole height and made this the emptiest screen in
              the console. They are a pair — where the patient is, and what the
              agent speaks — so they read as a pair.
            */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--cell) * 34), 1fr))",
                gap: "0 calc(var(--cell) * 3)",
              }}
            >
              <Field
                label="Timezone"
                htmlFor="timezone"
                error={state.errors.timezone}
                hint={
                  suggestedZone
                    ? "Taken from the country code on the number. Change it if the patient is somewhere else."
                    : "Every call for this patient is placed at the best time to call, in this zone."
                }
              >
                <Select
                  id="timezone"
                  name="timezone"
                  /*
                   * Keyed on the suggestion so the select re-reads it when the
                   * number changes. There is deliberately no fallback zone: a
                   * pre-selected default is a choice nobody made, and it was
                   * quietly putting +91 patients in London.
                   */
                  key={suggestedZone ?? "none"}
                  defaultValue={v.timezone || suggestedZone || ""}
                  options={[
                    { value: "", label: "Choose a timezone…" },
                    ...TIMEZONE_OPTIONS,
                  ]}
                  invalid={Boolean(state.errors.timezone)}
                  aria-describedby={describedBy("timezone", {
                    hint: true,
                    error: Boolean(state.errors.timezone),
                  })}
                />
              </Field>

              <Field
                label="Call language"
                htmlFor="language"
                error={state.errors.language}
                hint="What the agent speaks. The questions stay exactly as written; it asks them in this language."
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
            </div>

            {/*
              The demo clock is not here any more.

              It is scaffolding, and it was sitting in the critical path of
              enrolling a real patient, asking a clinician to choose between
              "real time" and "a clinical day per minute" — a question they have
              no basis to answer and the hint itself admitted was not clinical.
              It lives on the approval screen, beside the cadence and the time it
              actually scales, where it is a demo control among schedule
              controls rather than a demo control among clinical ones. The form
              still submits the default so the field keeps its provenance.
            */}
            {withNote ? (
              <input type="hidden" name="timeScale" value={v.timeScale} />
            ) : null}
          </div>
        </Panel>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        {onLastStep ? (
          <Button type="submit" variant="primary" disabled={pending}>
            {/* "Saving…" set an expectation of a moment and then broke it by
                sixty times: compiling a note takes upwards of thirteen seconds,
                and a doctor watching a dimmed button concludes it has hung. */}
            {pending ? (withNote ? "Reading your note…" : "Saving…") : submitLabel}
          </Button>
        ) : (
          /* `type="button"`: the default is `submit`, and a Continue that saved
             the patient would be the worst possible reading of the word. */
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              /*
               * Native validation runs over the whole form at submit, and a
               * control that is `display: none` cannot be focused — the browser
               * abandons the submit with nothing but a console message. So the
               * required fields are checked here, while they are still on
               * screen. Nothing on step 2 can be constraint-invalid, so this
               * reports step 1 and only step 1.
               */
              if (form.current?.reportValidity() === false) return;
              goTo(2);
            }}
          >
            Continue
          </Button>
        )}

        {stepped && step === 2 ? (
          <Button variant="ghost" disabled={pending} onClick={() => goTo(1)}>
            Back
          </Button>
        ) : null}

        {/*
          Both are shut while the compile runs.

          The patient row is written *before* the note is compiled, so a doctor
          who decides it has hung and leaves has already saved them — and the
          retry then fails with "Another active patient already has this
          number", a refusal that reads as a bug to someone who believes nothing
          was saved. There is no way to make leaving safe here, so leaving is
          not offered.
        */}
        {pending ? (
          <Button variant="ghost" disabled>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" href={cancelHref}>
            Cancel
          </Button>
        )}

        {/*
          The only account of what is happening during a wait that runs to
          thirteen seconds and more.

          A dimmed button is not a status: it says a control is unavailable, not
          that work is under way. `role="status"` is what carries it to a screen
          reader, which previously got nothing at all — there was no `aria-busy`,
          no live region and no progress role anywhere on the page for the whole
          of it.
        */}
        {pending && withNote ? (
          <span
            role="status"
            style={{
              alignSelf: "center",
              color: "var(--bench-ink)",
              fontSize: 13,
              lineHeight: 1.45,
              maxWidth: "42ch",
            }}
          >
            Reading your note and turning it into a plan. This takes a few
            seconds — nothing is dialled, and nothing has been sent to the
            patient.
          </span>
        ) : null}

        {withNote && !pending ? (
          /* Set as prose, not tracked caps: an 11px capitalised sentence is a
             notice nobody reads, and this is the one that says what the button
             does not do. It sits beside the button because that is the moment
             the question is being asked. */
          <span
            style={{
              alignSelf: "center",
              color: "var(--bench-ink-2)",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Nothing is dialled until you approve the plan.
          </span>
        ) : null}
      </div>
    </form>
  );
}
