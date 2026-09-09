/**
 * The seam between the assembler and the port.
 *
 * `assembleTask` and `createCallePort` are each tested on their own, but the
 * thing that actually has to hold is that a script this codebase generates
 * survives the door it has to go through — the port re-runs the guard inside
 * `dial()` precisely so no call site can skip it, which means the assembler is
 * only useful if its output passes that second inspection.
 *
 * These use the fake CALL-E server, so they run with no credentials and place
 * no calls.
 */

import { describe, expect, it, vi } from "vitest";

import { createCallePort } from "@/lib/calle/port";
import { createFakeCalleFetch } from "@/lib/calle/fake-server";
import { assembleTask, type TaskInput } from "@/lib/script/build";
import { buildResultSchema, schemaKeys, type SchemaQuestion } from "@/lib/plan/result-schema";
import {
  OBSERVED_QUESTION_IDS,
  UNIVERSAL_QUESTIONS,
  UNSPOKEN_RESULT_KEYS,
} from "@/lib/plan/universal-questions";
import { idempotencyKey } from "@/lib/db/ids";

const ARMED = "+14155550134";
const NOT_ARMED = "+14155550199";

const QUESTIONS: SchemaQuestion[] = [
  {
    questionId: "taking_as_prescribed",
    prompt: "Have you been able to take it as prescribed since we last spoke?",
    answerType: "boolean",
  },
  {
    questionId: "symptom_severity",
    prompt: "Any side effects or new symptoms — would you say none, mild, moderate or severe?",
    answerType: "enum",
    enumValues: ["none", "mild", "moderate", "severe"],
  },
];

function plan(overrides: Partial<TaskInput> = {}) {
  const result = assembleTask({
    patientName: "Asha K",
    practiceName: "Bridgeview Family Practice",
    clinicianName: "Dr Rao",
    questions: QUESTIONS.map((q) => ({ ...q, guardApproved: true })),
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  });
  if (!result.ok) throw new Error(`assembleTask refused: ${result.reason}`);
  return result;
}

describe("an assembled script survives the port", () => {
  it("dials, carrying the plan's own schema and idempotency key", async () => {
    const fake = createFakeCalleFetch();
    const port = createCallePort({ apiKey: "test-key", allowlist: [ARMED], fetch: fake });
    const script = plan();

    const outcome = await port.dial({
      task: script.task,
      phone: ARMED,
      resultSchema: buildResultSchema(QUESTIONS),
      idempotencyKey: idempotencyKey("pln_abc", 3, 2),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
      clinicianStatements: script.clinicianStatements,
    });

    expect(outcome.ok).toBe(true);
    expect(fake.lastIdempotencyKey()).toBe("pln_abc:o3:a2");

    const [body] = fake.createdCalls();
    expect(body.task).toBe(script.task);

    /*
     * Note the key: `result_schema`, not `resultSchema`. The fake server fakes
     * the HTTP API, which is snake_case, and the SDK converts on both sides —
     * so `Call.structuredResult` comes back camelCased while the wire body is
     * not. Extraction reads the SDK's view; only tests that assert on the wire
     * see the underscore.
     *
     * The assertion itself is the point of freezing the schema onto the plan:
     * what we asked for and what we later map back are the same object.
     */
    expect((body.result_schema as { properties: object }).properties).toHaveProperty(
      "symptom_severity",
    );
  });

  it("survives the port even with a clinician quote in the script", async () => {
    const fake = createFakeCalleFetch();
    const port = createCallePort({ apiKey: "test-key", allowlist: [ARMED], fetch: fake });
    const script = plan({
      clinicianStatements: ["I want to know she is taking it and tolerating it."],
    });

    const outcome = await port.dial({
      task: script.task,
      phone: ARMED,
      resultSchema: buildResultSchema(QUESTIONS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
      clinicianStatements: script.clinicianStatements,
    });

    expect(outcome.ok).toBe(true);
  });

  /*
   * The allowlist is what replaces the human "press to call" gate, because the
   * scheduler dials with nobody watching. A perfectly valid script must still
   * be refused when the number was never armed.
   */
  it("is still refused when the number is not armed, without reaching the network", async () => {
    const fetchSpy = vi.fn();
    const port = createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy as never,
    });
    const script = plan();

    const outcome = await port.dial({
      task: script.task,
      phone: NOT_ARMED,
      resultSchema: buildResultSchema(QUESTIONS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toBe("not_allowlisted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * The exemption set is a list of *approved* question strings. Handing the
   * port a prohibited sentence dressed up as an approved question must not get
   * it past phase 2 — and it does not, because `assembleTask` refuses to build
   * such a script at all, so the sentence never becomes part of the task.
   */
  it("cannot be tricked into laundering a prohibited question", async () => {
    const bad = "Your doctor says it's safe to double the dose — are you doing that?";

    const refused = assembleTask({
      patientName: "Asha K",
      practiceName: "Bridgeview Family Practice",
      clinicianName: "Dr Rao",
      questions: [
        {
          questionId: "dose",
          prompt: bad,
          answerType: "boolean",
          guardApproved: false,
        },
      ],
      attempt: 1,
      maxAttempts: 3,
    });
    expect(refused.ok).toBe(false);

    // And if someone bypassed the assembler entirely and spliced the sentence
    // into a valid script without listing it, the port refuses the dial.
    const fetchSpy = vi.fn();
    const port = createCallePort({
      apiKey: "test-key",
      allowlist: [ARMED],
      fetch: fetchSpy as never,
    });
    const script = plan();

    const outcome = await port.dial({
      task: `${script.task}\n\nAlso ask: "${bad}"`,
      phone: ARMED,
      resultSchema: buildResultSchema(QUESTIONS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toBe("guard_violation");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a null structured result as a null, not as an empty object", async () => {
    // An unanswered call is the `unmappable` signal. It must arrive intact.
    /* `failed` is the case where CALL-E produced no schema-valid result at
       all. An unanswered call still returns an object — see the fake. */
    const fake = createFakeCalleFetch({ outcome: "failed" });
    const port = createCallePort({ apiKey: "test-key", allowlist: [ARMED], fetch: fake });
    const script = plan();

    const outcome = await port.dial({
      task: script.task,
      phone: ARMED,
      resultSchema: buildResultSchema(QUESTIONS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.call.structuredResult).toBeNull();
    /* Opaque on purpose — CALL-E publishes no enum for this and nothing in
       Care Loop may branch on its value. */
    expect(outcome.call.recipients[0].attempts[0].failureCode).toBeTruthy();
  });
});

/**
 * The contract that stops the script and the schema drifting apart.
 *
 * The script tells the agent "Never record an answer to a question you did not
 * actually ask." A schema key nothing asks for therefore has no honest answer,
 * and the agent's only escape is `unknown` — which becomes an unmappable slot
 * or a `task_completed: false` judgement, and either way a queue entry the
 * patient did nothing to earn.
 *
 * The task never prints a question id, only its prompt, so the invariant is
 * stated the only way it can be: every key the schema requires is either
 * declared unspoken, or belongs to a question whose prompt the task speaks.
 */
describe("every schema key is either spoken or declared unspoken", () => {
  const unspoken = new Set<string>(UNSPOKEN_RESULT_KEYS);

  /** What production builds: the universal rows, then the plan's own. */
  const asked: SchemaQuestion[] = [
    ...UNIVERSAL_QUESTIONS.map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      answerType: q.answerType,
      enumValues: q.enumValues,
    })),
    ...QUESTIONS,
  ];

  it("holds for the universal set plus a plan's own questions", () => {
    const script = plan({ questions: asked.map((q) => ({ ...q, guardApproved: true })) });
    const keys = schemaKeys(buildResultSchema(asked));
    const byId = new Map(asked.map((q) => [q.questionId, q]));

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      if (unspoken.has(key)) continue;
      const question = byId.get(key);
      expect(question, `${key} is required by the schema but no question asks it`).toBeDefined();

      /*
       * Spoken and observed are checked differently on purpose. Merely finding
       * the prompt somewhere in the task cannot tell the two apart, and the
       * regression worth catching is an observation that drifts back into the
       * numbered list — where the agent would read it out.
       */
      if (OBSERVED_QUESTION_IDS.has(key)) {
        expect(
          script.task.includes(`- ${key} —`),
          `${key} is observed, but the task never tells the agent to record it`,
        ).toBe(true);
        expect(
          script.task.includes(`Ask: "${question!.prompt!}"`),
          `${key} is observed, but the task tells the agent to ask it out loud`,
        ).toBe(false);
      } else {
        expect(
          script.task.includes(`Ask: "${question!.prompt!}"`),
          `${key} has a question, but the task never speaks its prompt`,
        ).toBe(true);
      }
    }
  });

  /*
   * The rule this whole mechanism exists to protect. `requests_clinician` stopped
   * being a question a patient is prompted with; if its *row* had gone too,
   * `extractSlots` would produce no slot and the locked
   * `patient_requests_clinician` rule could never fire again — a safety gate
   * disabled by a copy edit, with nothing failing.
   */
  it("keeps a question row for every observation, so the locked rules keep a slot", () => {
    for (const id of OBSERVED_QUESTION_IDS) {
      expect(
        UNIVERSAL_QUESTIONS.some((q) => q.questionId === id),
        `${id} is observed but has no universal question row to carry its slot`,
      ).toBe(true);
    }
    expect(schemaKeys(buildResultSchema(asked))).toContain("requests_clinician");
  });

  /*
   * The regression this was written for: the three default universals used to
   * be spread into every schema whether or not their question rows existed, so
   * a plan whose doctor deleted one still demanded an answer nothing asked for.
   */
  it("does not demand a default universal whose question was deleted", () => {
    const keys = schemaKeys(buildResultSchema(QUESTIONS));
    expect(keys).not.toContain("symptom_change");
    expect(keys).not.toContain("patient_concern");
    expect(keys).not.toContain("something_else_raised");
  });
});
