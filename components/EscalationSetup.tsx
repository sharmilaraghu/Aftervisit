"use client";

/**
 * What escalates, in the doctor's terms.
 *
 * Cut to what a doctor acts on. It opened with a folded essay on how triage and
 * the fixed rules work, a "Write it down" gate in front of the one field that
 * matters, and two dozen standard words with their provenance captions. A
 * doctor wants two things here: to say, in their own words, what should bring
 * the patient back to them — the sentence triage reads every call against —
 * and to know what always escalates whatever they write. Both are open; the
 * word list is folded, because it is the same for every patient with the
 * condition and rarely edited.
 *
 * Words read out of the doctor's own note stay visible when there are any: the
 * product's promise is that anything the compiler added is shown as an
 * addition, so it can be deleted.
 *
 * The rules themselves are untouched — `lib/rules/{types,catalog,engine}.ts`
 * still hold the floor, and every rule the compiler proposed still fires.
 */

import { useState, useTransition } from "react";

import { Badge, Button, describedBy, Field, Textarea, TextInput } from "@/components/ui";
import { updateEscalationAction } from "@/app/(console)/plans/actions";
import { RULE_CATALOG } from "@/lib/rules/catalog";
import { LOCKED_RULE_KINDS, type RedFlagTerm } from "@/lib/rules/types";

/**
 * The always-on rules, named by the catalog rather than by this file, so a
 * relabelled rule moves the sentence a doctor reads with it.
 */
const LOCKED = (() => {
  const labels = LOCKED_RULE_KINDS.map((kind) => RULE_CATALOG[kind].label.toLowerCase());
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
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
  const [saved, setSaved] = useState<string>(escalationNote ?? "");
  /* "Saved" confirms an act; on arrival nothing has been saved yet. */
  const [justSaved, setJustSaved] = useState(false);
  const [word, setWord] = useState("");
  const [pending, startTransition] = useTransition();

  /* A word can reach the plan twice, and matching is case-insensitive, so the
     second copy is not a second thing to delete. */
  const seen = new Set<string>();
  const shown = terms.filter((t) => {
    const key = t.term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const fromNote = shown.filter((t) => t.source === "note" || t.source === "clinician");
  const standard = shown.filter((t) => t.source === "default");

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

  const chips = (group: RedFlagTerm[]) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 0.75)" }}>
      {group.map((t) => (
        <button
          key={t.term}
          type="button"
          disabled={pending}
          onClick={() => saveTerms(terms.filter((x) => x.term !== t.term))}
          aria-label={`Remove ${t.term}`}
          /* The button pads around the badge so the target reaches 32px. */
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
          <Badge tone="plain" quiet>
            {t.term} ✕
          </Badge>
        </button>
      ))}
    </div>
  );

  const dirty = note.trim() !== saved.trim();

  return (
    <div style={{ padding: "calc(var(--cell) * 3)" }}>
      {/* The doctor's own words — the one thing on this panel triage reads as
          their standard. Open, not behind a "Write it down" button. */}
      <Field
        label="Escalate to me if…"
        htmlFor="escalationNote"
        hint={
          live
            ? "Kept word for word. Every call from here on is read against it."
            : "Kept word for word. Every call is read against it."
        }
      >
        <Textarea
          id="escalationNote"
          rows={2}
          value={note}
          placeholder="Ring me if she is vomiting again or cannot keep fluids down."
          aria-describedby={describedBy("escalationNote", { hint: true })}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {dirty || justSaved ? (
        <div
          style={{
            display: "flex",
            gap: "calc(var(--cell) * 1.5)",
            alignItems: "center",
            margin: "calc(var(--cell) * -1.5) 0 calc(var(--cell) * 3)",
          }}
        >
          {dirty ? (
            <Button
              variant="onLabel"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await updateEscalationAction(planId, { escalationNote: note });
                  setSaved(note);
                  setJustSaved(true);
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          ) : (
            <span role="status" style={{ color: "var(--clear)", fontSize: 13, fontWeight: 600 }}>
              Saved
            </span>
          )}
        </div>
      ) : null}

      {/* What escalates whatever the doctor writes, in one sentence. */}
      <p
        className="measure"
        style={{
          margin: "0 0 calc(var(--cell) * 2.5)",
          paddingLeft: "calc(var(--cell) * 1.5)",
          borderLeft: "2px solid var(--info)",
          color: "var(--print-2)",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: "var(--print)" }}>Always escalated:</strong> {LOCKED}.
      </p>

      {/* Anything read out of the note is shown as an addition, to delete. */}
      {fromNote.length > 0 ? (
        <div style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <p style={{ margin: "0 0 calc(var(--cell) * 0.5)", color: "var(--print-2)", fontSize: 14, fontWeight: 600 }}>
            Words from your note
          </p>
          {chips(fromNote)}
        </div>
      ) : null}

      <details className="disclosure">
        <summary>
          Red-flag words the agent listens for{" "}
          <span className="mono">({shown.length})</span>
        </summary>
        <div style={{ marginTop: "calc(var(--cell) * 1.5)" }}>
          {standard.length > 0 ? chips(standard) : null}
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addWord();
                }
              }}
              style={{ maxWidth: 264 }}
            />
            <Button variant="onLabel" disabled={pending} onClick={addWord}>
              Add word
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
