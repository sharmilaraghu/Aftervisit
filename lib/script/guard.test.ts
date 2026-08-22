import { describe, it, expect } from "vitest";
import {
  inspectQuestion,
  inspectTask,
  inspectTranscript,
  type GuardCategory,
} from "./guard";

const categories = (result: { findings: { category: GuardCategory }[] }) =>
  result.findings.map((f) => f.category);

/**
 * A script that satisfies every required clause, so tests about prohibitions
 * are not drowned in missing-clause findings.
 */
function safeFrame(body = ""): string {
  return [
    "You are an AI assistant calling on behalf of Bridgeview Family Practice.",
    "Say: I'm an AI assistant calling for Dr Rao's team at Bridgeview.",
    "Ask: Is now a good time to go through a few quick questions?",
    "If they say no, thank them and end the call.",
    "Say: I can't give medical advice, but I'll pass anything on to your care team.",
    "If this is an emergency, tell them to hang up and call emergency services now.",
    "Say: Your care team will call you back about anything I can't answer.",
    body,
  ].join("\n");
}

describe("phase 1 — inspectQuestion, unmasked", () => {
  it("passes an ordinary follow-up question", () => {
    expect(inspectQuestion("Have you noticed any new symptoms since we last spoke?").ok).toBe(true);
  });

  it("passes a question that names a medication and its prescribed use", () => {
    // The product's own adherence question must not trip the dosage rule.
    expect(inspectQuestion("Are you taking the metformin as prescribed?").ok).toBe(true);
  });

  it("passes an open question about side effects", () => {
    // "Any side effects?" is required; only reassurance ABOUT them is forbidden.
    expect(inspectQuestion("Any side effects you've noticed?").ok).toBe(true);
  });

  it("catches advice dressed up as a question", () => {
    const result = inspectQuestion("You should stop taking it — have you?");
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("dosage_change");
  });

  it("catches a dosage change smuggled into a question", () => {
    const result = inspectQuestion("Are you taking two instead of one now?");
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("dosage_change");
  });

  it("catches reassurance phrased as a question", () => {
    const result = inspectQuestion("That's completely normal, isn't it?");
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("false_reassurance");
  });

  it("catches a diagnosis offered as a question", () => {
    const result = inspectQuestion("That sounds like an infection — does that fit?");
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("diagnosis");
  });
});

describe("phase 2 — the laundering trap", () => {
  // This is the reason the guard has three phases rather than one. A question
  // is only exempt because phase 1 already cleared it.
  const laundered = "Your doctor says it's safe to double the dose — are you doing that?";

  it("phase 1 rejects the laundered question, so it can never become exempt", () => {
    const result = inspectQuestion(laundered);
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("clinical_advice");
  });

  it("the same words are caught in an assembled script when NOT approved", () => {
    const result = inspectTask(safeFrame(`Ask: ${laundered}`));
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("clinical_advice");
  });

  it("a phase-1-clean question is genuinely exempt in phase 2", () => {
    const question = "Are you taking the metformin as prescribed?";
    expect(inspectQuestion(question).ok).toBe(true);

    const result = inspectTask(safeFrame(`Ask: ${question}`), {
      approvedQuestions: [question],
    });
    expect(result.ok).toBe(true);
  });

  it("masking is confined to the approved span — advice elsewhere still fires", () => {
    const question = "Are you taking the metformin as prescribed?";
    const result = inspectTask(
      safeFrame(`Ask: ${question}\nThen say: don't worry, that's normal.`),
      { approvedQuestions: [question] },
    );
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("false_reassurance");
  });

  it("masking preserves length, so reported offsets still land on the real match", () => {
    const question = "Are you taking the metformin as prescribed?";
    const task = safeFrame(`Ask: ${question}\nThen say: don't worry about it.`);
    const result = inspectTask(task, { approvedQuestions: [question] });

    const finding = result.findings.find((f) => f.category === "false_reassurance");
    expect(finding).toBeDefined();
    expect(task.slice(finding!.index, finding!.index + finding!.match.length)).toBe(
      finding!.match,
    );
  });
});

describe("phase 2 — attribution to the clinician", () => {
  it("allows a sentence the clinician actually wrote", () => {
    const statement = "Dr Rao wants to know how the swelling is doing.";
    const result = inspectTask(safeFrame(`Say: ${statement}`), {
      clinicianStatements: [statement],
    });
    expect(categories(result)).not.toContain("attributed_to_doctor");
  });

  it("catches an invented attribution", () => {
    const result = inspectTask(safeFrame("Say: your doctor says you can stop the tablets."));
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("attributed_to_doctor");
  });
});

describe("phase 2 — required clauses (the guard is bidirectional)", () => {
  it("passes a complete safety frame", () => {
    expect(inspectTask(safeFrame()).ok).toBe(true);
  });

  it("reports a missing AI disclosure", () => {
    const task = safeFrame().replace(/.*AI assistant.*\n?/g, "");
    expect(categories(inspectTask(task))).toContain("missing_ai_disclosure");
  });

  it("reports a missing consent gate", () => {
    const task = safeFrame().replace(/.*good time.*\n?/g, "");
    expect(categories(inspectTask(task))).toContain("missing_consent_gate");
  });

  it("reports a missing non-advice statement", () => {
    const task = safeFrame().replace(/.*can't give medical advice.*\n?/g, "");
    expect(categories(inspectTask(task))).toContain("missing_non_advice_statement");
  });

  it("reports a missing emergency handoff", () => {
    const task = safeFrame().replace(/.*emergency.*\n?/g, "");
    expect(categories(inspectTask(task))).toContain("missing_emergency_handoff");
  });

  it("reports a missing human handoff", () => {
    const task = safeFrame().replace(/.*care team will call.*\n?/gi, "");
    expect(categories(inspectTask(task))).toContain("missing_human_handoff");
  });

  it("a missing clause is reported even when nothing prohibited is present", () => {
    const result = inspectTask("Ask: how are you feeling?");
    expect(result.ok).toBe(false);
    expect(result.findings.every((f) => f.category.startsWith("missing_"))).toBe(true);
  });
});

describe("phase 3 — inspectTranscript, bot turns only", () => {
  it("catches the agent giving dosage advice", () => {
    const result = inspectTranscript([
      { speaker: "agent", text: "You could take two instead of one until it settles." },
    ]);
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("dosage_change");
  });

  it("catches the agent reassuring a patient", () => {
    const result = inspectTranscript([
      { speaker: "assistant", text: "Don't worry, that's completely normal after surgery." },
    ]);
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("false_reassurance");
  });

  it("does NOT flag the same words spoken by the patient", () => {
    // The patient disclosing this is exactly what the call is for. Flagging it
    // would punish the disclosure.
    const result = inspectTranscript([
      { speaker: "patient", text: "I stopped taking it last week." },
      { speaker: "user", text: "The nurse told me it's completely normal." },
    ]);
    expect(result.ok).toBe(true);
  });

  it("inspects the agent's turns in a mixed transcript", () => {
    const result = inspectTranscript([
      { speaker: "agent", text: "Have you noticed any new symptoms?" },
      { speaker: "patient", text: "My ankle is really swollen." },
      { speaker: "agent", text: "That sounds like an infection." },
    ]);
    expect(result.ok).toBe(false);
    expect(categories(result)).toContain("diagnosis");
  });

  it("passes a clean call", () => {
    const result = inspectTranscript([
      { speaker: "agent", text: "Have you noticed any new symptoms since we last spoke?" },
      { speaker: "patient", text: "No, I've been fine." },
      { speaker: "agent", text: "Thank you. I'll pass that on to your care team." },
    ]);
    expect(result.ok).toBe(true);
  });
});
