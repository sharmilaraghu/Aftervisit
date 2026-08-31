"use client";

/**
 * What counts as an emergency, for this patient.
 *
 * The compiler proposes; the doctor decides. Until this existed the review
 * screen rendered rules as read-only badges, which meant the model had the last
 * word on when to wake a clinician — the opposite of what the product claims.
 *
 * The editor is safe to expose because the rule DSL is a **closed tagged
 * union**: nine kinds, no free text, no parser. Every control below writes one
 * enumerable field, so there is no input that can produce a rule nobody
 * reviewed. The locked three render as locked, with the reason.
 *
 * Each row reads as a sentence — *"Very concerned about themselves → pause the
 * plan and tell me"* — because that is the question being answered, and a grid
 * of dropdowns is not how a clinician thinks about it.
 */

import { useState, useTransition } from "react";

import { Badge, Button, Select, TextInput } from "@/components/ui";
import { updateRulesAction } from "@/app/(console)/plans/actions";
import {
  addRedFlagTerm,
  isEditable,
  redFlagTerms,
  removeRedFlagTerm,
  removeRule,
  setBooleanValue,
  setDriftDays,
  setEnumValues,
  setThreshold,
  setUrgency,
} from "@/lib/rules/edit";
import type { PlanRule } from "@/lib/rules/types";

const URGENCY = [
  { value: "routine", label: "Add it to my queue" },
  { value: "urgent", label: "Pause the plan and tell me" },
];

/** What each rule watches, in the doctor's terms rather than the DSL's. */
function watches(rule: PlanRule["rule"]): string {
  switch (rule.kind) {
    case "patient_requests_clinician":
      return "The patient asks to speak to a person";
    case "unmappable_response":
      return "An answer that could not be mapped";
    case "emergency_language":
      return "Emergency language";
    case "red_flag_term_heard":
      return "A red-flag word is heard";
    case "no_answer_exhausted":
      return `${rule.attempts} attempts with no answer`;
    case "boolean_equals":
      return `${rule.questionId} answered ${rule.value ? "yes" : "no"}`;
    case "scale_at_least":
      return `${rule.questionId} at or above`;
    case "enum_in":
      return `${rule.questionId} answered`;
    case "drift_days":
      return "No contact for";
    case "task_incomplete":
      return "The agent did not finish the call";
  }
}

export function RuleEditor({
  planId,
  initial,
  questionEnums,
  live,
}: {
  planId: string;
  initial: PlanRule[];
  /** A question's own values, so the checkboxes offer exactly what it can answer. */
  questionEnums: Record<string, string[]>;
  /** True once the plan is running — changes then apply only to future calls. */
  live: boolean;
}) {
  const [rules, setRules] = useState<PlanRule[]>(initial);
  const [term, setTerm] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const apply = (next: PlanRule[]) => {
    setRules(next);
    setSaved(false);
  };

  const save = () =>
    startTransition(async () => {
      await updateRulesAction(planId, rules);
      setSaved(true);
    });

  const terms = redFlagTerms(rules);

  return (
    <div style={{ padding: "calc(var(--cell) * 3)" }}>
      <p
        className="measure"
        style={{ margin: "0 0 calc(var(--cell) * 3)", color: "var(--print-2)", fontSize: 14 }}
      >
        What counts as an emergency is different for every patient. Set it here —
        Care Loop only ever escalates on these rules, never on the model&rsquo;s
        opinion of what it heard.
        {live ? " Changes apply to calls from here on; they do not revisit calls already made." : ""}
      </p>

      {rules.map((r, i) => {
        const rule = r.rule;
        const locked = !isEditable(r);

        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "center",
              padding: "calc(var(--cell) * 1.5) 0",
              borderBottom: "1px solid var(--rule-2)",
            }}
          >
            <span style={{ minWidth: 240, flex: "1 1 240px", color: "var(--print)" }}>
              {watches(rule)}
            </span>

            {/* The value each kind escalates on. Nothing free-form. */}
            {rule.kind === "scale_at_least" ? (
              <TextInput
                mono
                inputMode="numeric"
                aria-label={`${rule.questionId} threshold`}
                value={String(rule.threshold)}
                onChange={(e) => apply(setThreshold(rules, i, Number(e.target.value)))}
                style={{ width: 72 }}
              />
            ) : null}

            {rule.kind === "drift_days" ? (
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <TextInput
                  mono
                  inputMode="numeric"
                  aria-label="Days of silence"
                  value={String(rule.days)}
                  onChange={(e) => apply(setDriftDays(rules, i, Number(e.target.value)))}
                  style={{ width: 72 }}
                />
                <span style={{ color: "var(--print-2)" }}>days</span>
              </span>
            ) : null}

            {rule.kind === "enum_in" ? (
              <span style={{ display: "inline-flex", gap: "calc(var(--cell) * 1.5)", flexWrap: "wrap" }}>
                {(questionEnums[rule.questionId] ?? rule.values).map((value) => {
                  const on = rule.values.includes(value);
                  return (
                    <label
                      key={value}
                      style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          apply(
                            setEnumValues(
                              rules,
                              i,
                              on ? rule.values.filter((v) => v !== value) : [...rule.values, value],
                            ),
                          )
                        }
                      />
                      {value.replace(/_/g, " ")}
                    </label>
                  );
                })}
              </span>
            ) : null}

            {rule.kind === "boolean_equals" ? (
              <Select
                aria-label={`${rule.questionId} escalates when`}
                value={rule.value ? "yes" : "no"}
                onChange={(e) => apply(setBooleanValue(rules, i, e.target.value === "yes"))}
                options={[
                  { value: "yes", label: "when yes" },
                  { value: "no", label: "when no" },
                ]}
                style={{ width: 140 }}
              />
            ) : null}

            {locked ? (
              <Badge tone="plain">Always urgent · locked</Badge>
            ) : (
              <>
                <Select
                  aria-label="What happens"
                  value={rule.urgent ? "urgent" : "routine"}
                  onChange={(e) => apply(setUrgency(rules, i, e.target.value === "urgent"))}
                  options={URGENCY}
                  style={{ width: 230 }}
                />
                <Button variant="onLabel" onClick={() => apply(removeRule(rules, i))}>
                  Remove
                </Button>
              </>
            )}

            {r.source === "clinician" ? (
              <Badge tone="info" quiet>
                You set this
              </Badge>
            ) : null}
          </div>
        );
      })}

      <div style={{ paddingTop: "calc(var(--cell) * 3)" }}>
        <p className="caps" style={{ color: "var(--print-3)", margin: "0 0 calc(var(--cell) * 1)" }}>
          Red-flag words
        </p>
        <p style={{ margin: "0 0 calc(var(--cell) * 1.5)", color: "var(--print-2)", fontSize: 14 }}>
          Heard in the patient&rsquo;s own words, these escalate. Matching is
          case-insensitive and will over-match — &ldquo;no vomiting&rdquo; fires
          too, so that a person reads the sentence rather than the system deciding
          what it meant.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(var(--cell) * 0.75)",
            marginBottom: "calc(var(--cell) * 2)",
          }}
        >
          {terms.length === 0 ? (
            <span style={{ color: "var(--print-3)", fontSize: 14 }}>None set.</span>
          ) : (
            terms.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => apply(removeRedFlagTerm(rules, t))}
                aria-label={`Remove ${t}`}
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <Badge tone="amber" quiet>
                  {t} ✕
                </Badge>
              </button>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: "calc(var(--cell) * 1.5)", flexWrap: "wrap" }}>
          <TextInput
            aria-label="Add a red-flag word"
            placeholder="fainting"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <Button
            variant="onLabel"
            onClick={() => {
              apply(addRedFlagTerm(rules, term));
              setTerm("");
            }}
          >
            Add word
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "calc(var(--cell) * 1.5)",
          alignItems: "center",
          marginTop: "calc(var(--cell) * 3)",
          paddingTop: "calc(var(--cell) * 3)",
          borderTop: "1px solid var(--rule)",
        }}
      >
        <Button variant="onLabel" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save what escalates"}
        </Button>
        {saved ? (
          <span role="status" className="caps" style={{ color: "var(--clear)" }}>
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
