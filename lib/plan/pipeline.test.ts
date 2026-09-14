/**
 * The pipeline, end to end, with no database and no network.
 *
 * `tick.ts` needs Postgres, so it cannot be unit-tested — but everything it
 * *decides* can be, because every decision it makes lives in a pure function.
 * This walks a real CALL-E payload from the fake server through extraction, the
 * rule engine and the outcome fold, which is the sequence that turns a phone
 * call into an escalation.
 *
 * If this passes and the tick still misbehaves, the bug is in the plumbing, not
 * in the judgement.
 */

import { describe, expect, it } from "vitest";

import { createCallePort } from "@/lib/calle/port";
import { createFakeCalleFetch } from "@/lib/calle/fake-server";
import { assembleTask } from "@/lib/script/build";
import { buildResultSchema } from "@/lib/plan/result-schema";
import { extractFindings, extractSlots, foldOutcome, someoneSpoke } from "@/lib/plan/extract";
import { UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import { evaluate, unresolvedCall } from "@/lib/rules/engine";
import { defaultRules, withLockedRules } from "@/lib/rules/catalog";
import type { StoredTurn } from "@/lib/db/schema";
import type { Call } from "@call-e/calle";
import type { PlanRule } from "@/lib/rules/types";

const ARMED = "+14155550134";

/* What production writes: the fixed observation rows, and the note's topics. */
const ROWS = UNIVERSAL_QUESTIONS.map((q) => ({
  questionId: q.questionId,
  prompt: q.prompt,
  answerType: q.answerType,
  enumValues: q.enumValues ?? null,
  required: true,
}));
const TOPICS = [{ text: "whether she is keeping fluids down" }, { text: "any stomach upset" }];

/* The floor, and nothing else. Every judgement the removed rules used to make
   is now the model's, read from the transcript rather than matched on a slot. */
const RULES: PlanRule[] = withLockedRules([...defaultRules()]);

const CLEAR = {
  reached_patient: "yes",
  requests_clinician: "no",
  emergency_language_heard: "no",
  symptom_change: "better",
  patient_concern: "not_concerned",
  something_else_raised: "no",
  goal_covered: "all",
  what_else: "unknown",
  call_recap: "Keeping fluids down, no upset.",
  topic_1: { answer: "yes", patient_words: "Drinking fine.", clarity: "clear" },
  topic_2: { answer: "none", patient_words: "No upset at all.", clarity: "clear" },
};

function flatten(call: Call): StoredTurn[] {
  const turns: StoredTurn[] = [];
  for (const recipient of call.recipients ?? []) {
    for (const attempt of recipient.attempts ?? []) {
      for (const turn of attempt.transcriptTurns ?? []) {
        turns.push({
          attemptId: attempt.id,
          // Snake_case: transcript turns keep the wire spelling even though the
          // rest of the SDK is camelCased.
          offsetSeconds: turn.offset_seconds ?? 0,
          speaker: String(turn.speaker),
          text: String(turn.text),
        });
      }
    }
  }
  return turns;
}

async function runCall(options: Parameters<typeof createFakeCalleFetch>[0]) {
  const fake = createFakeCalleFetch(options);
  const port = createCallePort({ apiKey: "k", allowlist: [ARMED], fetch: fake });

  const script = assembleTask({
    patientName: "Asha K",
    practiceName: "Bridgeview Family Practice",
    clinicianName: "Dr Rao",
    questions: ROWS.map((q) => ({ ...q, guardApproved: true })),
    goal: "Find out whether she is keeping fluids down on the new tablet.",
    topics: TOPICS,
    attempt: 1,
    maxAttempts: 3,
  });
  if (!script.ok) throw new Error("assembleTask refused");

  const dialed = await port.dial({
    task: script.task,
    phone: ARMED,
    resultSchema: buildResultSchema(TOPICS),
    idempotencyKey: "pln_x:o1:a1",
    consentGranted: true,
    approvedQuestions: script.approvedQuestions,
  });
  if (!dialed.ok) throw new Error(`dial refused: ${dialed.refusal}`);

  const call = await port.waitForCall(dialed.call.id);
  const transcript = flatten(call);
  const structured = (call.structuredResult ?? null) as Record<string, unknown> | null;
  const slots = extractSlots({ structuredResult: structured, questions: ROWS, transcript });
  const findings = extractFindings(structured, TOPICS);

  const failureCode = call.recipients?.[0]?.attempts?.at(-1)?.failureCode ?? null;
  const reached = someoneSpoke({ slots, transcript });
  const evaluation = evaluate({
    slots,
    rules: RULES,
    reached,
    // Evidence, not a failure string: nobody spoke on any attempt.
    noAnswerExhausted: !reached,
    attemptsMade: 3,
    now: new Date("2026-08-30T10:00:00Z"),
  });

  const outcome = foldOutcome({
    reached,
    hasUrgentHit: evaluation.shouldPause,
    hasAnyHit: evaluation.hits.length > 0,
    anyUnmappable: unresolvedCall(slots),
  });

  return { call, slots, findings, evaluation, outcome, failureCode };
}

describe("a clear call", () => {
  it("records typed answers and findings, escalates nothing, and reads as answered", async () => {
    const { slots, findings, evaluation, outcome } = await runCall({ structuredResult: CLEAR });

    expect(slots.every((s) => s.status === "answered")).toBe(true);
    expect(findings.map((f) => f.clarity)).toEqual(["clear", "clear"]);
    expect(findings[1].patientWords).toBe("No upset at all.");
    expect(evaluation.hits).toEqual([]);
    expect(evaluation.shouldPause).toBe(false);
    expect(outcome).toBe("answered");
  });
});

/*
 * The floor stays quiet on a call where the goal was covered and no locked
 * condition was met, whatever the patient said. Deciding what an alarming
 * sentence meant is the model's — see `lib/triage/triage.test.ts`.
 */
describe("a call the patient answered with something alarming", () => {
  it("covers the goal and leaves the reading to the model", async () => {
    const { evaluation, outcome } = await runCall({
      structuredResult: {
        ...CLEAR,
        symptom_change: "worse",
        topic_1: { answer: "no", patient_words: "I threw up twice and couldn't keep water down.", clarity: "clear" },
      },
    });

    expect(evaluation.hits).toEqual([]);
    expect(evaluation.shouldPause).toBe(false);
    expect(outcome).toBe("answered");
  });

  /* A patient who never compared today with the visit is a normal call. */
  it("does not escalate an honestly unknown observation when the goal was covered", async () => {
    const { slots, evaluation, outcome } = await runCall({
      structuredResult: { ...CLEAR, symptom_change: "unknown", patient_concern: "unknown" },
    });
    expect(slots.find((s) => s.questionId === "symptom_change")?.status).toBe("unmappable");
    expect(evaluation.hits).toEqual([]);
    expect(outcome).toBe("answered");
  });
});

describe("a call nobody answered", () => {
  it("produces a no_answer outcome and an exhausted-attempts escalation", async () => {
    const { slots, evaluation, outcome, failureCode, findings } = await runCall({
      outcome: "no_answer",
    });

    /*
     * A call nobody answered still comes back with a result object, and the
     * agent honestly records the one thing it can: nobody asked for a person.
     * That single answered slot must not make the call read as reached.
     */
    expect(slots.filter((s) => s.status === "answered").map((s) => s.questionId)).toEqual([
      "requests_clinician",
    ]);
    expect(findings.every((f) => f.answer === null && f.clarity === null)).toBe(true);
    expect(outcome).toBe("no_answer");
    expect(evaluation.hits.map((h) => h.ruleId)).toContain("no_answer_exhausted");
    expect(evaluation.hits.map((h) => h.ruleId)).not.toContain("unmappable_response");
    expect(failureCode).not.toBe("no_answer");
  });
});

describe("a call that did not find out what it was for", () => {
  it("escalates to a person rather than guessing, and keeps dialling", async () => {
    const { evaluation, outcome } = await runCall({
      structuredResult: {
        ...CLEAR,
        goal_covered: "none",
        topic_1: { answer: "unknown", patient_words: "Well, you know how it is.", clarity: "unclear" },
      },
    });

    expect(evaluation.hits.map((h) => h.ruleId)).toEqual(["unmappable_response"]);
    expect(outcome).toBe("flagged");
    /* Routed to a clinician, but the follow-up keeps running. */
    expect(evaluation.shouldPause).toBe(false);
  });
});

describe("a patient who asks for a person", () => {
  it("escalates urgently, whatever else the call contained", async () => {
    const { evaluation, outcome } = await runCall({
      structuredResult: { ...CLEAR, requests_clinician: "yes", goal_covered: "some" },
    });

    expect(evaluation.hits.map((h) => h.ruleId)).toContain("patient_requests_clinician");
    expect(evaluation.shouldPause).toBe(true);
    expect(outcome).toBe("flagged");
  });
});
