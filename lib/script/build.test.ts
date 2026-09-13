import { describe, expect, it } from "vitest";

import { assembleTask, type TaskInput, type TaskQuestion } from "@/lib/script/build";
import { inspectQuestion, inspectTask } from "@/lib/script/guard";

function question(overrides: Partial<TaskQuestion> = {}): TaskQuestion {
  return {
    questionId: "taking_as_prescribed",
    prompt: "Have you been able to take it as prescribed since we last spoke?",
    answerType: "boolean",
    guardApproved: true,
    ...overrides,
  };
}

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    patientName: "Asha K",
    practiceName: "Bridgeview Family Practice",
    clinicianName: "Dr Rao",
    questions: [question()],
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

function build(overrides: Partial<TaskInput> = {}) {
  const result = assembleTask(input(overrides));
  if (!result.ok) throw new Error(`expected a task, got refusal: ${result.reason}`);
  return result;
}

describe("assembleTask — the guard contract", () => {
  it("produces a script the guard accepts", () => {
    const { task, approvedQuestions } = build();
    const verdict = inspectTask(task, { approvedQuestions });
    expect(verdict.findings).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  /*
   * The five clauses are checked individually rather than as one pass, because
   * a single "the guard is happy" assertion would still be green if the frame
   * lost a clause and gained a different one.
   *
   * Each case strips *every* phrase that satisfies the clause, not just one.
   * The frame says two of these twice on purpose — it discloses it is an AI in
   * the opening line and again as "an automated call", and it offers a human
   * both when the patient declines and at the close. Removing a single
   * occurrence proves nothing, because the other still satisfies the guard.
   */
  it.each([
    ["missing_ai_disclosure", [/AI assistant/gi, /automated call/gi]],
    ["missing_emergency_stop", [/stop asking questions/gi]],
    ["missing_non_advice_statement", [/can't give you medical advice/gi]],
    ["missing_emergency_handoff", [/emergency/gi]],
    ["missing_human_handoff", [/care team/gi]],
  ])("fails as %s once every phrase satisfying it is stripped", (category, patterns) => {
    const { task, approvedQuestions } = build();
    const stripped = (patterns as RegExp[]).reduce((t, p) => t.replace(p, ""), task);
    expect(stripped).not.toEqual(task);

    const verdict = inspectTask(stripped, { approvedQuestions });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.category)).toContain(category);
  });

  it("says it is an AI twice, so losing one line does not lose the disclosure", () => {
    const { task, approvedQuestions } = build();
    expect(inspectTask(task.replace(/AI assistant/gi, ""), { approvedQuestions }).ok).toBe(true);
    expect(inspectTask(task.replace(/automated call/gi, ""), { approvedQuestions }).ok).toBe(true);
  });

  it("keeps every question exempt without exempting anything else", () => {
    const { task, approvedQuestions } = build({
      questions: [
        question(),
        question({
          questionId: "symptom_severity",
          prompt: "Any side effects or new symptoms — would you say none, mild, moderate or severe?",
          answerType: "enum",
          enumValues: ["none", "mild", "moderate", "severe"],
        }),
      ],
    });

    expect(inspectTask(task, { approvedQuestions }).ok).toBe(true);

    // The same script without the exemption set still passes: the frame itself
    // contains nothing the guard prohibits.
    expect(inspectTask(task).ok).toBe(true);
  });

  it("still fails when a prohibited sentence is added outside the questions", () => {
    const { task, approvedQuestions } = build();
    const tampered = task.replace(
      "HOW TO CLOSE",
      "Say: \"Don't worry, that's completely normal.\"\n\nHOW TO CLOSE",
    );

    const verdict = inspectTask(tampered, { approvedQuestions });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.category)).toContain("false_reassurance");
  });
});

describe("assembleTask — what it refuses", () => {
  it("refuses a plan with no questions", () => {
    const result = assembleTask(input({ questions: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_questions");
  });

  /*
   * The laundering hole, closed. `port.dial()` exempts every string in
   * `approvedQuestions` from phase 2 — so if a question that failed phase 1
   * could reach a script, listing it would carry it straight past the check
   * that rejected it.
   */
  it("refuses to build around a question the guard rejected", () => {
    const bad = "Your doctor says it's safe to double the dose — are you doing that?";
    expect(inspectQuestion(bad).ok).toBe(false);

    const result = assembleTask(
      input({ questions: [question({ questionId: "dose", prompt: bad, guardApproved: false })] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unapproved_question");
    expect(result.detail).toContain("dose");
  });
});

describe("assembleTask — the script itself", () => {
  it("is deterministic, so a retry sends the same bytes", () => {
    expect(build().task).toEqual(build().task);
  });

  it("asks questions in order, with their wording preserved exactly", () => {
    const first = question();
    const second = question({
      questionId: "severity",
      prompt: "How would you rate the pain out of ten?",
      answerType: "scale_0_10",
    });
    const { task } = build({ questions: [first, second] });

    expect(task).toContain(`1. Ask: "${first.prompt}"`);
    expect(task).toContain(`2. Ask: "${second.prompt}"`);
    expect(task.indexOf(first.prompt)).toBeLessThan(task.indexOf(second.prompt));
  });

  it("offers the enum values and forbids picking the nearest one", () => {
    const { task } = build({
      questions: [
        question({
          answerType: "enum",
          enumValues: ["none", "mild", "moderate", "severe"],
        }),
      ],
    });
    expect(task).toContain("Record exactly one of: none, mild, moderate, severe");
    expect(task).toContain("Do not pick the nearest one");
  });

  it("tells the agent to record an unclear answer rather than guess", () => {
    const { task } = build();
    expect(task).toContain("record it as unclear");
    expect(task).toContain("Never guess an answer");
  });

  /*
   * Consent lives on the patient record now, obtained once at registration. A
   * daily call that re-asks permission is a longer call for no gain, and the
   * real transcript spent forty-five seconds on preamble before its first
   * question.
   */
  it("does not ask permission again on the call", () => {
    const { task } = build();
    expect(task).not.toMatch(/is now a good time/i);
    expect(task).toContain("has already agreed to these calls");
  });

  it("opens in one line and says so", () => {
    const { task } = build();
    expect(task).toContain("Keep this call short");
    expect(task).toContain("Say this, and nothing more");
  });

  /*
   * The failure this rewrite exists for. A patient said "I feel like fainting
   * and I don't have bladder control"; the agent replied "I can't answer that
   * one, but I'll pass it on" and asked the next question.
   */
  it("stops the call on something urgent rather than deflecting", () => {
    const { task } = build();
    expect(task).toContain("stop asking questions immediately");
    expect(task).toContain("Do not ask the remaining questions");
    expect(task).toContain("let the care team know right now");
    // And the deflection is explicitly scoped away from that case.
    expect(task).toContain("It is never the response to a patient describing something urgent");
  });

  it("refuses to discuss the patient with whoever else answers", () => {
    const { task } = build();
    expect(task).toContain("Ask for Asha.");
    expect(task).toContain("do not share anything at all about their health");
  });

  it("never contains a phone number", () => {
    const { task } = build();
    expect(task).not.toMatch(/\+\d{7,}/);
  });

  it("quotes the clinician only word for word, and only when there is something to quote", () => {
    const statement = "I want to know she is taking it and tolerating it.";
    const { task, clinicianStatements } = build({ clinicianStatements: [statement] });
    expect(task).toContain(`- "${statement}"`);
    expect(task).toContain("Do not paraphrase them");
    expect(clinicianStatements).toEqual([statement]);

    expect(build().task).not.toContain("WROTE");
  });

  it("mentions the attempt number only on a retry", () => {
    expect(build({ attempt: 1 }).task).not.toContain("attempt 1 of 3");
    const retry = build({ attempt: 2 }).task;
    expect(retry).toContain("This is attempt 2 of 3");
    expect(retry).toContain("Do not mention the earlier attempts");
  });
});

describe("assembleTask — asking for a person, and other languages", () => {
  /*
   * A patient who asks for the care team is not answering the next question.
   * It stopped the call no differently from a closing — "record that they
   * asked and close politely" — and left the agent free to finish the list.
   */
  it("treats a request for the care team as a stop: skip the rest, say it will be passed on", () => {
    const { task } = build();
    expect(task).toContain("ask to speak to anyone from the care team or the practice");
    expect(task).toContain("I'll let the care team know right now, and someone will call you back.");
    const section = task.slice(task.indexOf("ask to speak to anyone from the care team"));
    expect(section).toContain("stop asking questions immediately");
    expect(section).toContain("do not ask the remaining questions");
    // Tied to the field the extractor reads — the floor rule that pauses the plan.
    expect(section).toContain("Record requests_clinician as yes");
    // A relative on the line is not a request for the care team.
    expect(section).toContain("Wanting to hand the phone to a relative or friend is not this");
  });

  it("opens in the patient's language, from the first word", () => {
    const { task } = build({ speakLanguage: "Hindi" });
    const note = task.indexOf("SPEAK THEIR LANGUAGE");
    const open = task.indexOf("HOW TO OPEN");
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(open);
    expect(task).toContain("Never open in English");
    expect(task).toContain("Say this in Hindi, and nothing more");
    expect(task).toContain('Say in Hindi: "Thank you for telling me');
  });

  it("keeps English calls unchanged in shape", () => {
    const { task } = build();
    expect(task).not.toContain("SPEAK THEIR LANGUAGE");
    expect(task).toContain("Say this, and nothing more");
  });

  it("a non-English task still passes every guard clause", () => {
    const { task, approvedQuestions } = build({ speakLanguage: "Tamil" });
    expect(inspectTask(task, { approvedQuestions }).findings).toEqual([]);
  });
});
