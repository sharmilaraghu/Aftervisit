"use client";

/**
 * What escalates, in the doctor's terms.
 *
 * This panel replaced a rule editor that put a dropdown, a threshold and a
 * remove button on every rule — around forty controls on one flat list, and no
 * way to add a rule anyway. A doctor does not think in a tagged union; they
 * think "ring me if she starts vomiting again". So the panel asks for that
 * sentence, shows the words it will listen for, and states the three rules
 * nobody may switch off.
 *
 * The rules themselves are untouched — `lib/rules/{types,catalog,engine}.ts`
 * still hold the closed DSL and the pure evaluator, and every rule the compiler
 * proposed still fires. They are simply no longer hand-authored here.
 *
 * Nothing on this panel is a save-everything button: the note has its own Save,
 * a word is added or deleted on the spot, and the action is told only about the
 * half that changed. That is why a chip click cannot discard a half-typed note.
 */

import { useState, useTransition } from "react";

import { Badge, Button, describedBy, Field, Textarea, TextInput } from "@/components/ui";
import { updateEscalationAction } from "@/app/(console)/plans/actions";
import { RULE_CATALOG } from "@/lib/rules/catalog";
import { LOCKED_RULE_KINDS, type RedFlagTerm } from "@/lib/rules/types";

/**
 * Where a word came from, said plainly.
 *
 * The product's promise is that compiler additions are *visible* as additions,
 * so the clinician can delete what the model read into their note. Grouping
 * carries that mark without spending a control on it.
 */
const GROUPS: { source: RedFlagTerm["source"]; heading: string; caption: string }[] = [
  {
    source: "note",
    heading: "Taken from your note",
    caption:
      "Read out of your note. Delete any that do not belong.",
  },
  {
    source: "clinician",
    heading: "Added by you",
    caption: "Words you added yourself.",
  },
  {
    source: "default",
    heading: "The standard list for this condition",
    caption: "Standard for this condition.",
  },
];

/**
 * The three, named by the catalog rather than by this file.
 *
 * Relabelling a rule must move the sentence a doctor reads with it; a copy of
 * the wording here would go quietly stale the first time one is renamed.
 */
const LOCKED = (() => {
  const labels = LOCKED_RULE_KINDS.map((kind) => `“${RULE_CATALOG[kind].label}”`);
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
})();

export function EscalationSetup({
  planId,
  escalationNote,
  terms: initialTerms,
  live,
}: {
  planId: string;
  /** The doctor's own words, verbatim. Null when they wrote none. */
  escalationNote: string | null;
  terms: RedFlagTerm[];
  /** True once the plan is running — changes then apply only to future calls. */
  live: boolean;
}) {
  const [terms, setTerms] = useState(initialTerms);
  const [note, setNote] = useState(escalationNote ?? "");
  const [writing, setWriting] = useState(escalationNote !== null && escalationNote !== "");
  const [saved, setSaved] = useState(false);
  const [word, setWord] = useState("");
  const [pending, startTransition] = useTransition();

  /*
   * A word can reach the plan twice — the universal list and a condition list
   * both carry "fainted" — and matching is case-insensitive, so the second copy
   * is not a second thing to delete. Deduped here rather than in the seed,
   * because the same is true of anything a compiler adds.
   */
  const seen = new Set<string>();
  const shown = terms.filter((t) => {
    const key = t.term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const saveTerms = (next: RedFlagTerm[]) =>
    startTransition(async () => {
      setTerms(next);
      await updateEscalationAction(planId, { terms: next });
    });

  const addWord = () => {
    const clean = word.trim().toLowerCase();
    setWord("");
    if (!clean || terms.some((t) => t.term.toLowerCase() === clean)) return;
    saveTerms([...terms, { term: clean, source: "clinician" }]);
  };

  return (
    <div style={{ padding: "calc(var(--cell) * 3)" }}>
      <p
        className="measure"
        style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)", fontSize: 14 }}
      >
        Care Loop only ever escalates on this plan&rsquo;s rules and the words you
        list — never on the model&rsquo;s opinion of what it heard.
        {live ? " Changes apply to calls from here on; they do not revisit calls already made." : ""}
      </p>

      {/* 1 — the doctor's own words. */}
      {writing ? (
        <Field
          /* The same words the doctor typed at enrolment, so the same label.
             They were entered under "Escalate to me if" and reappeared here
             under a different name, and nothing on either screen said the two
             were one field. */
          label="Escalating conditions"
          htmlFor="escalationNote"
          hint="Your words, kept verbatim. They are handed to triage as your own reference standard."
        >
          <Textarea
            id="escalationNote"
            rows={3}
            value={note}
            placeholder="Ring me if she is vomiting again or cannot keep fluids down."
            aria-describedby={describedBy("escalationNote", { hint: true })}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
      ) : (
        <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}>
            What you want to hear about
          </p>
          <p
            className="measure"
            style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--print-2)", fontSize: 14 }}
          >
            Nothing yet. Write what would make you want to know before their next
            appointment.
          </p>
          <Button variant="onLabel" onClick={() => setWriting(true)}>
            Write it down
          </Button>
        </div>
      )}

      {writing ? (
        <div
          style={{
            display: "flex",
            gap: "calc(var(--cell) * 1.5)",
            alignItems: "center",
            marginBottom: "calc(var(--cell) * 3)",
          }}
        >
          <Button
            variant="onLabel"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateEscalationAction(planId, { escalationNote: note });
                setSaved(true);
              })
            }
          >
            {pending ? "Saving…" : "Save what you wrote"}
          </Button>
          {saved ? (
            <span role="status" className="caps" style={{ color: "var(--clear)" }}>
              Saved
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 2 — the words the agent listens for. */}
      <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}>
        Red-flag words
      </p>
      <p
        className="measure"
        style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 14 }}
      >
        Escalate when the patient says them. Deliberately over-matches — &ldquo;no
        vomiting&rdquo; fires too, so a person reads the sentence rather than the
        system deciding what it meant.
      </p>

      {shown.length === 0 ? (
        <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-3)", fontSize: 14 }}>
          None set.
        </p>
      ) : (
        GROUPS.map(({ source, heading, caption }) => {
          const group = shown.filter((t) => t.source === source);
          if (group.length === 0) return null;
          return (
            <div key={source} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
              <p
                className="caps"
                style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 0.5)" }}
              >
                {heading}
              </p>
              <p
                className="measure"
                style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)", fontSize: 13 }}
              >
                {caption}
              </p>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 0.75)" }}
              >
                {group.map((t) => (
                  <button
                    key={t.term}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      saveTerms(terms.filter((x) => x.term !== t.term))
                    }
                    aria-label={`Remove ${t.term}`}
                    /*
                      The badge itself is a printed band and sets its own height,
                      which lands under the 24px a finger can reliably hit. The
                      button pads around it rather than the badge growing, so the
                      chip still looks like every other band on the page.
                    */
                    style={{
                      border: "none",
                      background: "none",
                      padding: "calc(var(--cell) * 0.75) 0",
                      minHeight: 32,
                      display: "inline-flex",
                      alignItems: "center",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <Badge tone="amber" quiet>
                      {t.term} ✕
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      <div
        style={{
          display: "flex",
          gap: "calc(var(--cell) * 1.5)",
          flexWrap: "wrap",
          marginTop: "calc(var(--cell) * 2)",
        }}
      >
        <TextInput
          aria-label="Add a red-flag word"
          placeholder="fainting"
          value={word}
          disabled={pending}
          onChange={(e) => setWord(e.target.value)}
          style={{ maxWidth: 264 }}
        />
        <Button variant="onLabel" disabled={pending} onClick={addWord}>
          Add word
        </Button>
      </div>

      {/* 3 — the three nobody may switch off. */}
      <p
        className="measure"
        style={{
          margin: "calc(var(--cell) * 3) 0 0",
          paddingTop: "calc(var(--cell) * 3)",
          borderTop: "1px solid var(--rule)",
          color: "var(--print-2)",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        {/*
          "Each of them pauses the plan" was wrong. `unmappable_response` carries
          urgent: false precisely so it does not — pausing on attempt 1 of 3
          disabled the retry ladder for the commonest reason a call is useless.
          Two of the three pause; all three reach a person.
        */}
        {`Three rules are always on and cannot be removed: ${LOCKED}. Each puts the patient in front of a person. An answer nobody could map keeps the follow-up dialling; the other two pause it.`}
      </p>
    </div>
  );
}
