"use client";

/**
 * The doctor's one control: the note.
 *
 * Everything else about the follow-up — the questions, the schedule, what to
 * escalate on — is drafted from this text and shown on the next screen, where
 * it can be corrected before anything is approved.
 *
 * One optional second box: what should bring the patient back to the doctor.
 * It is kept verbatim — triage reads each call against these words — so it
 * carries the escalation red as an index bar and a printed label.
 *
 * The draft survives an interruption. A GP called away mid-note used to come
 * back to an empty box: both fields now live in this browser's storage,
 * keyed to the visit, until the plan is drafted.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button, Field, Panel, Textarea, describedBy } from "@/components/ui";
import { consultAction } from "@/app/(console)/plans/actions";
import { EMPTY_COMPILE_FORM } from "@/lib/patients/plan-form";
import type { ConsentState, VisitKind } from "@/lib/db/enums";

const PLACEHOLDER: Record<VisitKind, string> = {
  /* No pronoun: it read "she" on a page for a man, and looked like a note
     someone had already written. */
  consultation:
    "e.g. Started metformin 500 mg BD for new type 2 diabetes. Call daily for a week — " +
    "is the patient taking it, any stomach upset?",
  post_op:
    "e.g. Lap cholecystectomy yesterday. Call daily for five days — wound, pain, eating.",
};

const ESCALATE_PLACEHOLDER: Record<VisitKind, string> = {
  consultation: "e.g. vomiting, cannot keep fluids down, or feels faint.",
  post_op: "e.g. fever over 38, the wound hot or weeping, or not eating.",
};

/* Wrapped so every storage read and write can fail quietly: private windows
   and blocked site data throw on access. */
const store = {
  read(key: string): { note: string; escalation: string } | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  write(key: string, value: { note: string; escalation: string } | null) {
    try {
      if (value) window.localStorage.setItem(key, JSON.stringify(value));
      else window.localStorage.removeItem(key);
    } catch {
      /* The draft is a convenience; losing it is not an error. */
    }
  },
};

export function ConsultForm({
  visitId,
  kind,
  canCompile,
  language,
  consent,
}: {
  visitId: string;
  kind: VisitKind;
  canCompile: boolean;
  /** The language the calls will use, e.g. "Tamil". */
  language: string;
  consent: ConsentState;
}) {
  const [state, formAction, pending] = useActionState(
    consultAction.bind(null, visitId),
    EMPTY_COMPILE_FORM,
  );
  const key = `consult-draft:${visitId}`;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const escalationRef = useRef<HTMLTextAreaElement>(null);
  const [slow, setSlow] = useState(false);

  /* Restore after mount, straight into the fields — reading storage during
     render would disagree with the server's empty render. Only an empty field
     is filled, so a returned error's values are never overwritten. */
  useEffect(() => {
    const draft = store.read(key);
    if (!draft) return;
    if (noteRef.current && !noteRef.current.value) noteRef.current.value = draft.note;
    if (escalationRef.current && !escalationRef.current.value) {
      escalationRef.current.value = draft.escalation;
    }
  }, [key]);

  const saveDraft = () => {
    const note = noteRef.current?.value ?? "";
    const escalation = escalationRef.current?.value ?? "";
    store.write(key, note || escalation ? { note, escalation } : null);
  };

  /* Past eight seconds the wait needs saying again, or it reads as stuck. The
     flag is reset when the form is submitted, not here. */
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <form action={formAction} onSubmit={() => setSlow(false)}>
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
            hint="Shorthand is fine. Say how long and how often if you have a view. Kept in this browser until you draft the plan."
          >
            <Textarea
              ref={noteRef}
              id="note"
              name="note"
              rows={8}
              autoFocus
              defaultValue={state.values.note}
              onChange={saveDraft}
              /* Ctrl/⌘ + Enter drafts the plan without leaving the keyboard. */
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pending) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="note-field"
              placeholder={PLACEHOLDER[kind]}
              invalid={Boolean(state.error)}
              aria-describedby={describedBy("note", { hint: true })}
            />
          </Field>

          <div className="escalate-block">
            <Field
              label="Escalate to me if… (optional)"
              htmlFor="escalation"
              hint="Kept word for word. Every call is read against it, on top of the standard red flags."
            >
              <Textarea
                id="escalation"
                name="escalation"
                rows={3}
                ref={escalationRef}
                defaultValue={state.values.escalation}
                onChange={saveDraft}
                className="note-field"
                placeholder={ESCALATE_PLACEHOLDER[kind]}
                aria-describedby={describedBy("escalation", { hint: true })}
              />
            </Field>
          </div>
        </div>
      </Panel>

      <div className="consult-actions">
        <span className="btn-primary-wrap">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Reading your note…" : "Draft the follow-up plan"}
          </Button>
        </span>
        {pending ? (
          /* No disabled Cancel while pending: an unusable control is noise. */
          <span role="status" style={{ color: "var(--bench-ink-2)", fontSize: 14 }}>
            {slow
              ? "Still reading — a long note takes up to 20 seconds."
              : "Drafting the questions from your note. Nothing is dialled."}
          </span>
        ) : (
          <>
            <Link href="/consult" style={{ color: "var(--bench-ink-2)", fontSize: 14, textUnderlineOffset: 3 }}>
              Back to consultations
            </Link>
            <span className="consult-kbd" style={{ color: "var(--bench-ink-3)", fontSize: 13 }}>
              or press <kbd className="mono">Ctrl</kbd>/<kbd className="mono">⌘</kbd> +{" "}
              <kbd className="mono">Enter</kbd>
            </span>
          </>
        )}
      </div>

      {/* The reassurance belongs before the press, not after it. Consent is
          one quiet clause here, not a banner: it is the front desk's field,
          and the approve screen says it again where it decides anything. */}
      {!pending ? (
        <p className="consult-assure measure">
          You&rsquo;ll review every question before anything is scheduled, and nothing you
          didn&rsquo;t write is asked. Calls will be in {language}.
          {consent === "declined"
            ? " This patient declined automated calls, so none will be placed."
            : consent !== "granted"
              ? " Calls wait until the front desk records consent."
              : ""}
        </p>
      ) : null}
    </form>
  );
}
