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
import { extractSlots, foldOutcome, type ExtractQuestion } from "@/lib/plan/extract";
import { evaluate } from "@/lib/rules/engine";
import { withLockedRules } from "@/lib/rules/catalog";
import type { StoredTurn } from "@/lib/db/schema";
import type { Call } from "@call-e/calle";
import type { PlanRule } from "@/lib/rules/types";

const ARMED = "+14155550134";

const QUESTIONS: ExtractQuestion[] = [
  { questionId: "reached_patient", answerType: "boolean", required: true },
  { questionId: "consent_given", answerType: "boolean", required: true },
  { questionId: "requests_clinician", answerType: "boolean", required: true },
  { questionId: "emergency_language_heard", answerType: "boolean", required: true },
  {
    questionId: "symptom_severity",
    answerType: "enum",
    enumValues: ["none", "mild", "moderate", "severe"],
    required: true,
  },
];

const RULES: PlanRule[] = withLockedRules([
  {
    rule: { kind: "red_flag_term_heard", terms: ["threw up", "vomiting"], urgent: true },
    source: "default",
    label: "Red flag term heard",
  },
  {
    rule: { kind: "enum_in", questionId: "symptom_severity", values: ["severe"], urgent: true },
    source: "default",
    label: "Severe symptoms reported",
  },
  {
    rule: { kind: "no_answer_exhausted", attempts: 3, urgent: false },
    source: "default",
    label: "Three attempts, no answer",
  },
]);

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
    questions: QUESTIONS.map((q) => ({
      questionId: q.questionId,
      prompt: `Question about ${q.questionId}?`,
      answerType: q.answerType,
      enumValues: q.enumValues,
      guardApproved: true,
    })),
    consentAlreadyGranted: false,
    attempt: 1,
    maxAttempts: 3,
  });
  if (!script.ok) throw new Error("assembleTask refused");

  const dialed = await port.dial({
    task: script.task,
    phone: ARMED,
    resultSchema: buildResultSchema(
      QUESTIONS.map((q) => ({ ...q, prompt: `Question about ${q.questionId}?` })),
    ),
    idempotencyKey: "pln_x:o1:a1",
    approvedQuestions: script.approvedQuestions,
  });
  if (!dialed.ok) throw new Error(`dial refused: ${dialed.refusal}`);

  const call = await port.waitForCall(dialed.call.id);
  const transcript = flatten(call);
  const slots = extractSlots({
    structuredResult: (call.structuredResult ?? null) as Record<string, unknown> | null,
    questions: QUESTIONS,
    transcript,
  });

  const failureCode = call.recipients?.[0]?.attempts?.at(-1)?.failureCode ?? null;
  const reached = slots.find((s) => s.questionId === "reached_patient")?.valueBool === true;
  const evaluation = evaluate({
    slots,
    rules: RULES,
    redFlagTerms: ["threw up", "vomiting"],
    reached,
    noAnswerExhausted: failureCode === "no_answer",
    attemptsMade: 3,
    quietForDays: 0,
    taskCompleted: call.taskCompleted ?? null,
    now: new Date("2026-08-30T10:00:00Z"),
  });

  const outcome = foldOutcome({
    reached,
    failureCode,
    hasUrgentHit: evaluation.shouldPause,
    hasAnyHit: evaluation.hits.length > 0,
    anyUnmappable: slots.some((s) => s.status === "unmappable" || s.status === "missing"),
  });

  return { call, slots, evaluation, outcome, failureCode };
}

describe("a clear call", () => {
  it("records typed answers, escalates nothing, and reads as answered", async () => {
    const { slots, evaluation, outcome } = await runCall({
      structuredResult: {
        reached_patient: "yes",
        consent_given: "yes",
        requests_clinician: "no",
        emergency_language_heard: "no",
        symptom_severity: "none",
      },
      transcriptTurns: [
        { offset_seconds: 2, speaker: "bot", text: "Question about symptom_severity?" },
        { offset_seconds: 8, speaker: "user", text: "All fine, nothing to report." },
      ],
    });

    expect(slots.every((s) => s.status === "answered")).toBe(true);
    expect(evaluation.hits).toEqual([]);
    expect(evaluation.shouldPause).toBe(false);
    expect(outcome).toBe("answered");
  });
});

describe("a call with a red flag", () => {
  it("escalates urgently and carries the patient's own words", async () => {
    const { evaluation, outcome } = await runCall({
      structuredResult: {
        reached_patient: "yes",
        consent_given: "yes",
        requests_clinician: "no",
        emergency_language_heard: "no",
        symptom_severity: "severe",
      },
      transcriptTurns: [
        { offset_seconds: 2, speaker: "bot", text: "Question about symptom_severity?" },
        {
          offset_seconds: 9,
          speaker: "user",
          text: "I threw up twice yesterday and couldn't keep water down.",
        },
      ],
    });

    const ids = evaluation.hits.map((h) => h.ruleId);
    expect(ids).toContain("red_flag_term_heard");
    expect(ids).toContain("enum_in");
    expect(evaluation.shouldPause).toBe(true);
    expect(evaluation.hits[0].utterance).toContain("threw up twice");
    expect(outcome).toBe("flagged");
  });
});

describe("a call nobody answered", () => {
  /*
   * The end of the retry ladder. CALL-E gives a real failure code and a null
   * structured result; the null is what makes every slot missing, and the
   * exhausted attempts are what raise the escalation.
   */
  it("produces a no_answer outcome and an exhausted-attempts escalation", async () => {
    const { call, slots, evaluation, outcome, failureCode } = await runCall({
      outcome: "no_answer",
    });

    expect(call.structuredResult).toBeNull();
    expect(failureCode).toBe("no_answer");
    expect(slots.every((s) => s.status === "missing")).toBe(true);
    expect(outcome).toBe("no_answer");
    expect(evaluation.hits.map((h) => h.ruleId)).toContain("no_answer_exhausted");
  });
});

describe("a call the model could not map", () => {
  it("escalates the unmappable answer rather than guessing at it", async () => {
    const { slots, evaluation, outcome } = await runCall({
      structuredResult: {
        reached_patient: "yes",
        consent_given: "yes",
        requests_clinician: "no",
        emergency_language_heard: "no",
        // CALL-E heard something and could not place it. `unknown` is the
        // signal — the model had to choose it, rather than us reading a null.
        symptom_severity: "unknown",
      },
      transcriptTurns: [
        { offset_seconds: 2, speaker: "bot", text: "Question about symptom_severity?" },
        {
          offset_seconds: 9,
          speaker: "user",
          text: "Well, it's the same as it was, more or less, you know how it is.",
        },
      ],
    });

    expect(slots.find((s) => s.questionId === "symptom_severity")?.status).toBe("unmappable");
    expect(evaluation.hits.map((h) => h.ruleId)).toContain("unmappable_response");
    expect(evaluation.shouldPause).toBe(true);
    expect(outcome).toBe("flagged");
  });
});

describe("a patient who asks for a person", () => {
  it("escalates urgently, whatever else the call contained", async () => {
    const { evaluation, outcome } = await runCall({
      structuredResult: {
        reached_patient: "yes",
        consent_given: "yes",
        requests_clinician: "yes",
        emergency_language_heard: "no",
        symptom_severity: "none",
      },
    });

    expect(evaluation.hits.map((h) => h.ruleId)).toContain("patient_requests_clinician");
    expect(evaluation.shouldPause).toBe(true);
    expect(outcome).toBe("flagged");
  });
});
