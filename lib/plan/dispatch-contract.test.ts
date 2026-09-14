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
import { buildResultSchema, schemaKeys, topicKey } from "@/lib/plan/result-schema";
import {
  OBSERVED_QUESTION_IDS,
  UNIVERSAL_QUESTIONS,
  UNSPOKEN_RESULT_KEYS,
} from "@/lib/plan/universal-questions";
import { idempotencyKey } from "@/lib/db/ids";

const ARMED = "+14155550134";
const NOT_ARMED = "+14155550199";

const GOAL = "Find out whether she is taking the new tablet and how she is tolerating it.";
const TOPICS = [{ text: "whether she is taking metformin" }, { text: "any side effects or new symptoms" }];
const ROWS = UNIVERSAL_QUESTIONS.map((q) => ({ ...q, guardApproved: true }));

function plan(overrides: Partial<TaskInput> = {}) {
  const result = assembleTask({
    patientName: "Asha K",
    practiceName: "Bridgeview Family Practice",
    clinicianName: "Dr Rao",
    questions: ROWS,
    goal: GOAL,
    topics: TOPICS,
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
      resultSchema: buildResultSchema(TOPICS),
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
     * the HTTP API, which is snake_case, and the SDK converts on both sides.
     */
    const properties = (body.result_schema as { properties: object }).properties;
    expect(properties).toHaveProperty("goal_covered");
    expect(properties).toHaveProperty("topic_2");
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
      resultSchema: buildResultSchema(TOPICS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
      clinicianStatements: script.clinicianStatements,
    });

    expect(outcome.ok).toBe(true);
  });

  it("survives the port in another language", async () => {
    const fake = createFakeCalleFetch();
    const port = createCallePort({ apiKey: "test-key", allowlist: [ARMED], fetch: fake });
    const script = plan({ speakLanguage: "Hindi" });

    const outcome = await port.dial({
      task: script.task,
      phone: ARMED,
      resultSchema: buildResultSchema(TOPICS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
      locale: "hi-IN",
    });

    expect(outcome.ok).toBe(true);
  });

  /*
   * The allowlist is the deployment lock. A perfectly valid script must still
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
      resultSchema: buildResultSchema(TOPICS),
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
   * The exemption set carries the goal and the topics. Handing the port a
   * prohibited sentence spliced into a valid script without listing it must not
   * get it past phase 2 — and a rejected row never becomes part of a task.
   */
  it("cannot be tricked into laundering a prohibited sentence", async () => {
    const bad = "Your doctor says it's safe to double the dose — are you doing that?";

    const refused = assembleTask({
      patientName: "Asha K",
      practiceName: "Bridgeview Family Practice",
      clinicianName: "Dr Rao",
      questions: [{ questionId: "dose", prompt: bad, answerType: "boolean", guardApproved: false }],
      goal: GOAL,
      topics: TOPICS,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(refused.ok).toBe(false);

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
      resultSchema: buildResultSchema(TOPICS),
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
    const fake = createFakeCalleFetch({ outcome: "failed" });
    const port = createCallePort({ apiKey: "test-key", allowlist: [ARMED], fetch: fake });
    const script = plan();

    const outcome = await port.dial({
      task: script.task,
      phone: ARMED,
      resultSchema: buildResultSchema(TOPICS),
      idempotencyKey: idempotencyKey("pln_abc", 1, 1),
      consentGranted: true,
      approvedQuestions: script.approvedQuestions,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.call.structuredResult).toBeNull();
    expect(outcome.call.recipients[0].attempts[0].failureCode).toBeTruthy();
  });
});

/**
 * The contract that stops the script and the schema drifting apart.
 *
 * A schema key the task never mentions has no honest answer, and the agent's
 * only escape is `unknown` — a queue entry the patient did nothing to earn. So
 * every key the schema requires is told to the agent under WHAT TO RECORD, and
 * none of them is something it reads out.
 */
describe("every schema key is something the task tells the agent to record", () => {
  it("holds for the fixed rows plus a plan's topics", () => {
    const script = plan();
    const keys = schemaKeys(buildResultSchema(TOPICS));
    const record = script.task.slice(script.task.indexOf("WHAT TO RECORD"));

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(record.includes(`- ${key} —`), `${key} is in the schema but never named to record`).toBe(true);
      expect(script.task.includes(`Ask: "`), "the task reads a scripted question out").toBe(false);
    }
    expect(keys).toContain(topicKey(TOPICS.length - 1));
  });

  /*
   * The rule this whole mechanism exists to protect. If a floor rule's row had
   * gone, `extractSlots` would produce no slot and the locked rule could never
   * fire again — a safety gate disabled by a copy edit, with nothing failing.
   */
  it("keeps a row for every observation, and every observation is unspoken", () => {
    for (const key of schemaKeys(buildResultSchema([]))) {
      if ((UNSPOKEN_RESULT_KEYS as readonly string[]).includes(key)) continue;
      expect(OBSERVED_QUESTION_IDS.has(key), `${key} has no observed universal row`).toBe(true);
    }
    for (const id of ["requests_clinician", "emergency_language_heard", "goal_covered", "reached_patient"]) {
      expect(UNIVERSAL_QUESTIONS.some((q) => q.questionId === id)).toBe(true);
    }
  });
});
