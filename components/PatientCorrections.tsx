"use client";

/**
 * Who Care Loop will call — as a field block, and as the form that fixes it.
 *
 * **Why this is a panel and not a button.** The approval screen used to state
 * the patient's age, number, zone and language as one mono run-on under the
 * headline, with a bare ghost button hanging on the graphite beneath it. Every
 * other fact on this page is a labelled field on label stock; those five were a
 * debug string, and the control that edited them belonged to nothing — a
 * control with no host is the one thing this system has no vocabulary for.
 *
 * Patient identity is not a footnote to the plan. It is the *subject* of the
 * plan, and it is exactly the same kind of thing as the plan's own fields: a
 * value a doctor checks before committing. So it gets the same grammar — a
 * titled sheet, a `<dl>` of tracked-caps labels over values, mono for anything
 * compared by eye — and it comes first, because the reading order of this page
 * is who, then what we will do, then what we will ask.
 *
 * **Consent rides the panel header as a printed strip.** It is the single field
 * here that decides whether a phone rings at all: anything but `granted` and
 * `dial()` refuses every call on the plan. Quiet when it is agreed, filled when
 * it is not — a state that changes what happens deserves a band with a word on
 * it, which is the rule the rest of this product already follows.
 *
 * **The form replaces the fields in place.** The reason to open it is that
 * something on *this* screen is wrong, so the screen you are checking must not
 * disappear while you correct it. Editing where the value is printed is also
 * why `declined` is settable here at all: the enrolment form's checkbox is
 * binary, so a patient who actually refuses had no representation anywhere.
 */

import { useActionState, useState } from "react";

import { Button, Field, Select, TextInput, describedBy } from "@/components/ui";
import { correctPatientAction } from "@/app/(console)/patients/actions";
import { CONSENT_OPTIONS } from "@/lib/patients/labels";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";
import { TIMEZONE_OPTIONS } from "@/lib/patients/timezones";
import { maskPhone } from "@/lib/phone/normalize";
import type { PatientFormState } from "@/lib/patients/form";



const PAD = "calc(var(--cell) * 3)";

/** One printed field. The same label-over-value pair the plan panel prints. */
function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="caps" style={{ color: "var(--print-3)", marginBottom: 2 }}>
        {label}
      </dt>
      <dd
        className={mono ? "mono" : undefined}
        style={{ margin: 0, fontSize: 15, color: "var(--print)", lineHeight: 1.4 }}
      >
        {value}
      </dd>
    </div>
  );
}

export function PatientCorrections({
  patientId,
  planId,
  name,
  age,
  phoneE164,
  timezone,
  language,
  consent,
  /** False once calls exist against these details — then they are history. */
  editable,
  /** Inside the approve block the facts are already printed above; only the
      control and the form belong there. */
  compact = false,
}: {
  patientId: string;
  planId: string;
  name: string;
  age: number;
  phoneE164: string;
  timezone: string;
  language: string;
  consent: string;
  editable: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = correctPatientAction.bind(null, patientId, planId);
  const initial: PatientFormState = {
    errors: {},
    values: {
      name,
      age: String(age),
      phone: phoneE164,
      timezone,
      language,
      consent,
      /* The note belongs to the plan, not the patient record, and it is edited
         further down by `AmendNote`. Correcting a number must never touch what
         the agent was told to say. */
      note: "",
      escalationNote: "",
      timeScale: "1",
    },
  };
  const [state, formAction, pending] = useActionState(action, initial);

  /*
   * Which values the inputs show, and why it is not simply the action's.
   *
   * `useActionState` keeps whatever the action last returned, and these inputs
   * are uncontrolled `defaultValue`s that never re-read their props. So a
   * drawer left open after a save went on showing the values *it* had
   * submitted, while `revalidatePath` re-rendered the record underneath it —
   * and the two could disagree. A timezone corrected here still read as the old
   * one until the page was reloaded by hand.
   *
   * So: props are the truth, except when the submit was rejected, where the
   * doctor's own typing has to survive long enough to be fixed. The `key`
   * below remounts the inputs whenever the record actually changes, which is
   * what resets the DOM after a successful save.
   */
  const rejected = Object.keys(state.errors).length > 0;
  const v = rejected ? state.values : initial.values;

  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.value === language)?.label ?? language;

  if (!open) {
    if (compact) {
      return editable ? (
        <p
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 2)",
            alignItems: "center",
            margin: "0 0 calc(var(--cell) * 3)",
          }}
        >
          <Button variant="onLabel" onClick={() => setOpen(true)}>
            Correct these details
          </Button>
          <span style={{ color: "var(--print-2)", fontSize: 14 }}>
            Wrong number, zone or language? Fix it before you approve.
          </span>
          {state.saved ? (
            <span role="status" className="caps" style={{ color: "var(--clear)" }}>
              Saved
            </span>
          ) : null}
        </p>
      ) : null;
    }

    return (
      <>
        <dl
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 4)",
            margin: 0,
            padding: PAD,
          }}
        >
          <Fact label="Name" value={name} />
          <Fact label="Age" value={String(age)} mono />
          {/* Masked, without exception. This UI ends up in a published video. */}
          <Fact label="Number" value={maskPhone(phoneE164)} mono />
          <Fact label="Timezone" value={timezone} mono />
          <Fact label="Language" value={languageLabel} />
        </dl>

        {editable ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "calc(var(--cell) * 2)",
              padding: "calc(var(--cell) * 2) calc(var(--cell) * 2.5)",
              borderTop: "1px solid var(--rule)",
              background: "var(--label-2)",
            }}
          >
            <Button variant="onLabel" onClick={() => setOpen(true)}>
              Correct these details
            </Button>
            {state.saved ? (
              <span role="status" className="caps" style={{ color: "var(--clear)" }}>
                Saved
              </span>
            ) : null}
            {/* Takes the remainder and wraps its own text, rather than being a
                rigid block that drops to a second row the moment it misses
                fitting by a pixel — which is exactly what it did at 1500px. */}
            <span
              style={{
                flex: "1 1 calc(var(--cell) * 34)",
                minWidth: 0,
                color: "var(--print-2)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Every call uses these. Changing them changes who Care Loop dials,
              and in what language.
            </span>
          </div>
        ) : null}
      </>
    );
  }

  return (
    /*
       Capped to a form measure rather than the sheet's full width. Unbounded,
       the name field grew to 630px on a 1500px viewport — a text box four times
       longer than anything anyone types into it, which reads as a template
       stretched to fit rather than a form somebody laid out.
    */
    <form
      /* Remounts every input when the record itself changes, so a saved value
         is never shadowed by the one that was typed to produce it. */
      key={`${name}|${age}|${phoneE164}|${timezone}|${language}|${consent}`}
      action={formAction}
      style={{ padding: PAD, maxWidth: "calc(var(--cell) * 88)" }}
    >
      {state.errors.form ? (
        <p
          role="alert"
          style={{
            margin: `0 0 ${PAD}`,
            padding: "calc(var(--cell) * 2)",
            background: "var(--danger-wash)",
            boxShadow: "inset 0 0 0 1px var(--danger)",
            color: "var(--print)",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {state.errors.form}
        </p>
      ) : null}

      {/*
        Two groups, in the order enrolment asks for them.
        
        Adding a patient is a two-step form — who they are and what you want
        followed up, then how the call is placed — and this panel used to put
        all six fields in one undifferentiated block, so the same record was
        shaped one way when created and another when corrected. Timezone and
        language are machinery: they belong after the clinical facts, and behind
        a rule, not interleaved with them.
      */}
      <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--print-3)" }}>
        Who they are
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 calc(var(--cell) * 3)" }}>
        <div style={{ flex: "1 1 calc(var(--cell) * 20)", minWidth: 168 }}>
          <Field label="Name" htmlFor="c-name" error={state.errors.name}>
            <TextInput
              id="c-name"
              name="name"
              defaultValue={v.name}
              required
              invalid={Boolean(state.errors.name)}
              aria-describedby={describedBy("c-name", { error: Boolean(state.errors.name) })}
            />
          </Field>
        </div>

        <div style={{ flex: "0 0 calc(var(--cell) * 12)", maxWidth: 96 }}>
          <Field label="Age" htmlFor="c-age" error={state.errors.age}>
            <TextInput
              id="c-age"
              name="age"
              mono
              inputMode="numeric"
              defaultValue={v.age}
              required
              invalid={Boolean(state.errors.age)}
              aria-describedby={describedBy("c-age", { error: Boolean(state.errors.age) })}
            />
          </Field>
        </div>

        <div style={{ flex: "0 1 calc(var(--cell) * 30)", minWidth: 208 }}>
          <Field
            label="Number"
            htmlFor="c-phone"
            error={state.errors.phone}
            /* Unmasked only here. You cannot correct a field full of dots, and
               this is the one moment a doctor is deliberately checking it. */
            hint="Full international format, starting with +."
          >
            <TextInput
              id="c-phone"
              name="phone"
              mono
              defaultValue={v.phone}
              required
              invalid={Boolean(state.errors.phone)}
              aria-describedby={describedBy("c-phone", {
                hint: true,
                error: Boolean(state.errors.phone),
              })}
            />
          </Field>
        </div>
      </div>

      <Field
        label="Consent"
        htmlFor="c-consent"
        error={state.errors.consent}
        hint="Care Loop dials with nobody pressing a button, so this is what authorises the call. Anything but agreed and every call is refused with a reason on the record."
      >
        <Select
          id="c-consent"
          name="consent"
          defaultValue={v.consent}
          options={CONSENT_OPTIONS}
          style={{ maxWidth: 416 }}
          invalid={Boolean(state.errors.consent)}
          aria-describedby={describedBy("c-consent", {
            hint: true,
            error: Boolean(state.errors.consent),
          })}
        />
      </Field>

      <p
        className="caps"
        style={{
          margin: "0 0 calc(var(--cell) * 1.5)",
          paddingTop: "calc(var(--cell) * 2.5)",
          borderTop: "1px solid var(--rule)",
          color: "var(--print-3)",
        }}
      >
        How the call is placed
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "0 calc(var(--cell) * 3)",
        }}
      >
        <Field
          label="Timezone"
          htmlFor="c-timezone"
          error={state.errors.timezone}
          hint="Calls land at the plan's local time in this zone."
        >
          <Select
            id="c-timezone"
            name="timezone"
            defaultValue={v.timezone}
            options={TIMEZONE_OPTIONS}
            invalid={Boolean(state.errors.timezone)}
            aria-describedby={describedBy("c-timezone", {
              hint: true,
              error: Boolean(state.errors.timezone),
            })}
          />
        </Field>

        <Field
          label="Call language"
          htmlFor="c-language"
          error={state.errors.language}
          hint="What the agent speaks. The questions stay exactly as written below."
        >
          <Select
            id="c-language"
            name="language"
            defaultValue={v.language}
            options={LANGUAGE_OPTIONS}
            invalid={Boolean(state.errors.language)}
            aria-describedby={describedBy("c-language", {
              hint: true,
              error: Boolean(state.errors.language),
            })}
          />
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
        }}
      >
        <Button type="submit" variant="onLabel" disabled={pending}>
          {pending ? "Saving…" : "Save these details"}
        </Button>
        <Button variant="onLabel" disabled={pending} onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}
