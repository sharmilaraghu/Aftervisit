"use client";

/**
 * The doctor as the clinical author of what the agent says.
 *
 * The compiler proposes the wording; until this existed the doctor could delete
 * a question but not fix one, which meant the model had the last word on the
 * exact sentence a patient hears.
 *
 * Every edit and every addition goes through guard phase 1 inside
 * `lib/db/plans.ts`, on the way to the row. There is no "save anyway" here, and
 * there is nothing to add one to: a refused question is written as `rejected`
 * and drops into the panel below, which is why the refusal shown here is a
 * report of what happened rather than a dialog to argue with.
 */

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button, describedBy, Field, Select, Textarea, TextInput } from "@/components/ui";
import {
  addQuestionAction,
  deleteQuestionAction,
  editQuestionAction,
  moveQuestionAction,
} from "@/app/(console)/plans/actions";
import { ANSWER_TYPE_OPTIONS } from "@/lib/plan/clinician-question";
import type { QuestionEditResult } from "@/lib/plan/clinician-question";
import type { GuardFinding } from "@/lib/script/guard";

/**
 * The guard's refusal, verbatim.
 *
 * Red, because a guard violation is one of the three things red means here. The
 * matched words are quoted so the doctor can see exactly which phrase was
 * refused rather than being told the sentence "failed".
 */
function Refusal({ error, findings }: { error: string; findings?: GuardFinding[] }) {
  return (
    <div
      role="alert"
      style={{
        margin: "calc(var(--cell) * 2) 0 0",
        padding: "calc(var(--cell) * 2)",
        background: "var(--danger-wash)",
        boxShadow: "inset 0 0 0 1px var(--danger)",
        color: "var(--print)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {error}
      {findings && findings.length > 0 ? (
        <ul style={{ margin: "calc(var(--cell) * 1.5) 0 0", paddingLeft: "calc(var(--cell) * 2.5)" }}>
          {findings.map((f, i) => (
            <li key={i} style={{ marginBottom: "calc(var(--cell) * 0.75)" }}>
              <span className="mono">&ldquo;{f.match}&rdquo;</span> — {f.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function QuestionRow({
  planId,
  questionId,
  prompt,
  meta,
  editable,
  reorderable = false,
  quoted = false,
}: {
  planId: string;
  /** The row's own id, not the slug. */
  questionId: string;
  prompt: string;
  /** Rendered under the wording, and styled by the caller — the two panels say different things here. */
  meta: ReactNode;
  /** False once the plan is approved, and for the locked questions. */
  editable: boolean;
  /** Only the askable panel reorders; a refused question has no place in the order. */
  reorderable?: boolean;
  /** The refused panel quotes the wording — it is what the model wanted to say. */
  quoted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<QuestionEditResult | null>(null);
  const [draft, setDraft] = useState(prompt);
  const [pending, startTransition] = useTransition();
  /*
   * `revalidatePath` marks the server cache stale, but this action is invoked
   * as a plain call rather than through a form, so nothing asks the router to
   * re-render. Without this the row moves in the database and the list on
   * screen does not — the button looks broken while working perfectly.
   */
  const router = useRouter();

  return (
    <div>
      {open ? (
        <Textarea
          aria-label="What the agent will ask"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <span style={{ display: "block", color: "var(--print)", fontSize: 15 }}>
          {quoted ? `“${prompt}”` : prompt}
        </span>
      )}

      <div style={{ marginTop: 2 }}>{meta}</div>

      {editable ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 1.5)",
            alignItems: "center",
            marginTop: "calc(var(--cell) * 1)",
          }}
        >
          {open ? (
            <>
              <Button
                variant="onLabel"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await editQuestionAction(planId, questionId, draft);
                    setResult(r);
                    if (r.ok) setOpen(false);
                  })
                }
              >
                {pending ? "Saving…" : "Save wording"}
              </Button>
              <Button
                variant="onLabel"
                disabled={pending}
                onClick={() => {
                  setDraft(prompt);
                  setResult(null);
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : armed ? (
            <>
              <span style={{ fontSize: 14, color: "var(--print-2)" }}>
                Remove it? The agent will not ask this.
              </span>
              <Button
                variant="onLabel"
                disabled={pending}
                onClick={() =>
                  startTransition(() => deleteQuestionAction(planId, questionId))
                }
              >
                {pending ? "Removing…" : "Yes, remove it"}
              </Button>
              <Button variant="onLabel" disabled={pending} onClick={() => setArmed(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <>
              <Button variant="onLabel" onClick={() => setOpen(true)}>
                Edit wording
              </Button>
              <Button variant="onLabel" onClick={() => setArmed(true)}>
                Remove
              </Button>
              {/*
                Buttons rather than drag-and-drop: keyboard-reachable by
                construction, usable on a phone without pointer gymnastics, and
                no dependency. Order is what the agent asks in, so it has to be
                operable by everyone who can operate the rest of the page.
              */}
              {reorderable ? (
                <>
                  <Button
                    variant="onLabel"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await moveQuestionAction(planId, questionId, "up");
                        if (r.ok) router.refresh();
                        else setResult({ ok: false, error: r.reason ?? "" });
                      })
                    }
                  >
                    <span aria-hidden>↑</span>
                    <span className="sr-only">Ask this earlier</span>
                  </Button>
                  <Button
                    variant="onLabel"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await moveQuestionAction(planId, questionId, "down");
                        if (r.ok) router.refresh();
                        else setResult({ ok: false, error: r.reason ?? "" });
                      })
                    }
                  >
                    <span aria-hidden>↓</span>
                    <span className="sr-only">Ask this later</span>
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {result && !result.ok ? <Refusal error={result.error} findings={result.findings} /> : null}
    </div>
  );
}

export function AddQuestion({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);
  const [isEnum, setIsEnum] = useState(false);
  const [result, setResult] = useState<QuestionEditResult | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <p style={{ margin: "calc(var(--cell) * 3) 0 0" }}>
        <Button variant="onLabel" onClick={() => setOpen(true)}>
          Add a question
        </Button>
      </p>
    );
  }

  return (
    <form
      ref={form}
      action={(formData) =>
        startTransition(async () => {
          const r = await addQuestionAction(planId, formData);
          setResult(r);
          if (r.ok) {
            form.current?.reset();
            setIsEnum(false);
          }
        })
      }
      style={{
        marginTop: "calc(var(--cell) * 3)",
        paddingTop: "calc(var(--cell) * 3)",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <Field
        label="What the agent will ask"
        htmlFor="prompt"
        hint="Phrased as a question to the patient. It is read out exactly as written."
      >
        <Textarea
          id="prompt"
          name="prompt"
          rows={2}
          aria-describedby={describedBy("prompt", { hint: true })}
        />
      </Field>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 3)" }}>
        <div style={{ minWidth: 200 }}>
          <Field label="Answer" htmlFor="answerType">
            <Select
              id="answerType"
              name="answerType"
              defaultValue="boolean"
              onChange={(e) => setIsEnum(e.target.value === "enum")}
              options={ANSWER_TYPE_OPTIONS}
            />
          </Field>
        </div>
        {isEnum ? (
          <div style={{ minWidth: 280, flex: 1 }}>
            <Field
              label="One of"
              htmlFor="enumValues"
              hint="Comma-separated, at least two — the only answers this question can have."
            >
              <TextInput
                id="enumValues"
                name="enumValues"
                placeholder="better, same, worse"
                aria-describedby={describedBy("enumValues", { hint: true })}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
        <Button type="submit" variant="onLabel" disabled={pending}>
          {pending ? "Checking…" : "Add the question"}
        </Button>
        <Button
          variant="onLabel"
          disabled={pending}
          onClick={() => {
            setResult(null);
            setOpen(false);
          }}
        >
          Done
        </Button>
        {result?.ok ? (
          <span role="status" className="caps" style={{ color: "var(--clear)" }}>
            Added
          </span>
        ) : (
          <span className="caps" style={{ color: "var(--print-3)" }}>
            Checked by the clinical guard before it is asked
          </span>
        )}
      </div>

      {result && !result.ok ? <Refusal error={result.error} findings={result.findings} /> : null}
    </form>
  );
}
