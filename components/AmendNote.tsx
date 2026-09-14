"use client";

/**
 * Adding to a note after the fact.
 *
 * A doctor remembers something once the consultation is over — a second
 * medication, a symptom they meant to mention, a thing to watch for. Before
 * this, their only options were to abandon the plan or hand-write the questions
 * themselves, so the model's first reading of the note was permanent.
 *
 * The addition appends to the note rather than replacing it. The note is the
 * grounding source the dialer checks against, and it is also a clinical record:
 * overwriting what a doctor wrote at the consultation, with what they thought
 * an hour later, would lose the first version silently.
 *
 * **On a running plan this is the returning-patient flow.** The same person
 * comes back with something new while their existing follow-up is still
 * dialling; adding it here means one call a day covering both, instead of a
 * second plan phoning them separately. The merge is additive only — a question
 * that calls have already been placed against is never rewritten underneath
 * them — and the result schema is re-frozen so the new answers are actually
 * kept rather than asked and discarded.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, Field, Textarea } from "@/components/ui";
import { amendNoteAction } from "@/app/(console)/plans/actions";

export function AmendNote({ planId, live = false }: { planId: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      /* Flex, so the paragraph grows to the button's height instead of letting a
         38px inline control overhang a ~24px line box onto whatever is above. */
      <p style={{ margin: 0, display: "flex" }}>
        <Button variant="onLabel" onClick={() => setOpen(true)}>
          {live ? "Add to the follow-up" : "Add to this note"}
        </Button>
      </p>
    );
  }

  return (
    <div
      style={{
        marginTop: "calc(var(--cell) * 3)",
        paddingTop: "calc(var(--cell) * 3)",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <Field
        label={live ? "What has changed?" : "What else?"}
        htmlFor="amendment"
        hint="This is added to the end of your note, and the whole note is read again. Anything new to find out is added to the calls; what they already ask about stays."
      >
        <Textarea
          id="amendment"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.7 }}
          placeholder={
            live
              ? "Came back today with a chest infection. Started amoxicillin. Ask whether the cough is settling and whether she is finishing the course."
              : "Also started on amlodipine 5mg. Ask whether her ankles are swelling."
          }
        />
      </Field>

      <div style={{ display: "flex", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
        <Button
          variant="onLabel"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await amendNoteAction(planId, text);
              if (r.ok) {
                const added = r.added ?? 0;
                setResult({
                  ok: true,
                  message:
                    added === 0
                      ? "Saved. The re-read found nothing new to find out."
                      : `Saved. ${added} new thing${added === 1 ? "" : "s"} to find out, from the next call.`,
                });
                setText("");
                setOpen(false);
                router.refresh();
              } else {
                setResult({ ok: false, message: r.error ?? "That could not be saved." });
              }
            })
          }
        >
          {pending ? "Reading it again…" : "Add and re-read"}
        </Button>
        <Button
          variant="onLabel"
          disabled={pending}
          onClick={() => {
            setText("");
            setResult(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>

      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          style={{
            margin: "calc(var(--cell) * 2) 0 0",
            padding: "calc(var(--cell) * 2)",
            background: result.ok ? "var(--clear-wash)" : "var(--danger-wash)",
            boxShadow: `inset 0 0 0 1px var(--${result.ok ? "clear" : "danger"})`,
            color: "var(--print)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
