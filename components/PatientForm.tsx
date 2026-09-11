"use client";

/**
 * Register or edit a patient.
 *
 * Registering is the front desk's job and books the visit in the same step:
 * who this is, how to reach them, the consent that authorises dialling, and
 * what they say is wrong. Nothing clinical — the note is the doctor's, written
 * on the consult screen with the patient in front of them.
 *
 * Editing is the same form without the visit band. It is four fields and a
 * tickbox, and a wizard over four fields is ceremony.
 *
 * The interesting field is the phone number. It is the only one where the
 * product refuses rather than corrects: a bare `9876543210` is a real number in
 * several countries, so Care Loop will not pick one. That refusal is the first
 * thing a visitor sees the product actually do, so it is given room — mono,
 * because a number is read digit by digit.
 */

import { useActionState, useEffect, useRef } from "react";

import {
  Button,
  Field,
  Panel,
  Select,
  TextInput,
  Textarea,
  describedBy,
} from "@/components/ui";
import type { PatientFormState } from "@/lib/patients/form";
import { PRACTICE_TIMEZONE } from "@/lib/patients/timezones";
import { CONSENT_OPTIONS } from "@/lib/patients/labels";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";

const VISIT_KIND_OPTIONS = [
  { value: "consultation", label: "Consultation" },
  { value: "post_op", label: "Post-operative follow-up" },
];

export function PatientForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  patientId,
  visit,
}: {
  action: (prev: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  initial: PatientFormState;
  submitLabel: string;
  cancelHref: string;
  /** A returning patient: the record is updated in place rather than duplicated. */
  patientId?: string;
  /** Present on the registration desk only. Editing a record never books a visit. */
  visit?: { defaultDate: string };
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const v = state.values;
  const form = useRef<HTMLFormElement>(null);

  /*
   * A language this form no longer offers stays selectable for the patient
   * who already has it — otherwise the select would show the first option and
   * an unrelated edit would quietly change the language of every future call.
   */
  const languageOptions =
    !v.language || LANGUAGE_OPTIONS.some((o) => o.value === v.language)
      ? LANGUAGE_OPTIONS
      : [...LANGUAGE_OPTIONS, { value: v.language, label: `${v.language} (no longer offered)` }];

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
    first.focus({ preventScroll: false });
    if (!first.matches("input, select, textarea")) {
      first.scrollIntoView({ block: "center" });
    }
  }, [state]);


  return (
    <form action={formAction} ref={form}>
      {patientId ? <input type="hidden" name="patientId" value={patientId} /> : null}

      <div>
        <Panel
          title="The patient"
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
                    name="phone"
                    mono
                    /* 555-01xx only: this placeholder renders on screen, and the
                       screen ends up in a published video. */
                    /* The format, not a number: an Indian practice showed a US
                       example, and any plausible +91 digits belong to someone. */
                    placeholder="+91 XXXXX XXXXX"
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
              hint="This is what authorises every call. Anything but agreed and each one is refused, with a reason on the record."
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

          {/*
            The visit, on the same sheet.

            This is the hand-off to the doctor: the consult list is every visit
            still waiting, and what is written here is the first thing they
            read when they open one. It is context for a person, and it is
            deliberately not handed to the model — the note is the only text a
            call can be grounded in.
          */}
          {visit ? (
            <div
              style={{
                padding: "calc(var(--cell) * 2.5) calc(var(--cell) * 3) calc(var(--cell) * 1)",
                borderTop: "1px solid var(--rule-ink)",
              }}
            >
              <div className="field-grid">
                <Field label="Visit" htmlFor="visitKind" error={state.errors.visitKind}>
                  <Select
                    id="visitKind"
                    name="visitKind"
                    defaultValue={v.visitKind}
                    options={VISIT_KIND_OPTIONS}
                    invalid={Boolean(state.errors.visitKind)}
                    aria-describedby={describedBy("visitKind", {
                      error: Boolean(state.errors.visitKind),
                    })}
                  />
                </Field>
                <Field label="Appointment date" htmlFor="visitDate" error={state.errors.visitDate}>
                  <TextInput
                    id="visitDate"
                    name="visitDate"
                    type="date"
                    mono
                    defaultValue={v.visitDate || visit.defaultDate}
                    required
                    invalid={Boolean(state.errors.visitDate)}
                    aria-describedby={describedBy("visitDate", {
                      error: Boolean(state.errors.visitDate),
                    })}
                  />
                </Field>
              </div>

              <Field
                label="What they came in with"
                htmlFor="reportedSymptoms"
                error={state.errors.reportedSymptoms}
                hint="In your words. The doctor reads this before the consultation; the agent never does."
              >
                <Textarea
                  id="reportedSymptoms"
                  name="reportedSymptoms"
                  rows={3}
                  defaultValue={v.reportedSymptoms}
                  invalid={Boolean(state.errors.reportedSymptoms)}
                  aria-describedby={describedBy("reportedSymptoms", {
                    hint: true,
                    error: Boolean(state.errors.reportedSymptoms),
                  })}
                />
              </Field>
            </div>
          ) : null}
        </Panel>
      </div>

      <div>
        <Panel
          title="How the call is placed"
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>

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
              {/*
                One practice, one zone. Shown so the desk can see what calls
                will run on, but not a choice: the server action sets it again
                whatever arrives, so a stale tab cannot put a patient on
                another clock.
              */}
              <Field
                label="Timezone"
                htmlFor="timezone"
                error={state.errors.timezone}
                hint="Fixed for the practice. Every call is placed on India time."
              >
                <input type="hidden" name="timezone" value={PRACTICE_TIMEZONE} />
                <TextInput
                  id="timezone"
                  value={`India (${PRACTICE_TIMEZONE})`}
                  readOnly
                  /* Printed on the stock, not boxed like an input: a white
                     box that cannot be typed in gets tapped and then doubted. */
                  style={{ background: "var(--label-2)", borderColor: "transparent", cursor: "default" }}
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
                  options={languageOptions}
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
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>


        {pending ? (
          <Button variant="ghost" disabled>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" href={cancelHref}>
            Cancel
          </Button>
        )}

      </div>
    </form>
  );
}
