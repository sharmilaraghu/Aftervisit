import { describe, expect, it, vi } from "vitest";

import { readTriageAnswer } from "./schema";
import { triageCall, triagePrompt, type TriageInput } from "./triage";

const base: TriageInput = {
  escalationNote: "Vomiting, or not keeping fluids down.",
  noteBody: "Asha K started metformin 500mg BD today. Follow up daily for a week.",
  patientAge: 54,
  reason: "New metformin · tolerance and adherence",
  transcript: [
    { attemptId: "a1", offsetSeconds: 2, speaker: "agent", text: "How have you been?" },
    { attemptId: "a1", offsetSeconds: 8, speaker: "user", text: "I threw up twice yesterday." },
  ],
  slots: [{ questionId: "symptom_severity", status: "answered", value: "severe" }],
  platform: { summary: null, taskCompleted: null, confidence: null, evidence: null },
  ruleHits: [],
  redFlagTerms: ["vomiting", "not keeping fluids down"],
  quietForDays: 1,
  /* No keys. Every test here runs on zero credentials, like the rest of the suite. */
  env: {} as NodeJS.ProcessEnv,
};

describe("triageCall fails closed", () => {
  /*
   * The property the whole design rests on: a call nobody could judge is a call
   * a human is told about. An absent verdict must never read as a quiet call.
   */
  it("escalates when no model is configured", async () => {
    const outcome = await triageCall(base);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.answer.verdict).toBe("escalate");
    expect(outcome.error).toContain("No model is configured");
  });

  it("never answers low on a failure path", async () => {
    const outcome = await triageCall({ ...base, transcript: null });
    expect(outcome.answer.verdict).not.toBe("low");
  });

  /*
   * Deliberately not `severe`. An urgent escalation pauses the plan, so an
   * outage answering `severe` would pause every plan on the roster — the safety
   * mechanism taking the product down.
   */
  it("does not answer severe when the model never ran", async () => {
    const outcome = await triageCall(base);
    expect(outcome.answer.verdict).toBe("escalate");
  });

  it("reports a provider failure as error rather than throwing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/plan/provider", () => ({
      hasProvider: () => true,
      complete: async () => {
        throw new Error("upstream exploded");
      },
      NoProviderError: class extends Error {},
    }));
    const { triageCall: isolated } = await import("./triage");
    const outcome = await isolated(base);
    expect(outcome.status).toBe("error");
    expect(outcome.answer.verdict).toBe("escalate");
    vi.doUnmock("@/lib/plan/provider");
    vi.resetModules();
  });
});

describe("readTriageAnswer", () => {
  const good = {
    verdict: "severe",
    reason: "She described vomiting twice.",
    summary: "Reached, reported vomiting.",
    keyTerms: ["threw up twice"],
    matchedConcerns: ["Vomiting"],
    quote: "I threw up twice yesterday.",
  };

  it("reads a well-formed answer", () => {
    expect(readTriageAnswer(good)?.verdict).toBe("severe");
  });

  /* A verdict outside the enum is unusable, and guessing which one was meant is
     exactly the judgement this component is not allowed to make. */
  it("refuses a verdict outside the ladder", () => {
    expect(readTriageAnswer({ ...good, verdict: "critical" })).toBeNull();
    expect(readTriageAnswer({ ...good, verdict: "" })).toBeNull();
  });

  it("refuses an answer with no reason", () => {
    expect(readTriageAnswer({ ...good, reason: "   " })).toBeNull();
  });

  /* A thinner report is still a usable one — only the verdict and the reason
     are load-bearing. */
  it("tolerates missing lists rather than failing the whole verdict", () => {
    const answer = readTriageAnswer({ ...good, keyTerms: null, matchedConcerns: undefined });
    expect(answer?.keyTerms).toEqual([]);
    expect(answer?.matchedConcerns).toEqual([]);
  });

  it("treats the literal 'unknown' quote as no quote", () => {
    expect(readTriageAnswer({ ...good, quote: "unknown" })?.quote).toBe("");
  });
});

describe("triagePrompt", () => {
  it("gives the doctor's own wording as the standard", () => {
    expect(triagePrompt(base)).toContain("WHAT THE DOCTOR SAID TO WATCH FOR");
    expect(triagePrompt(base)).toContain("not keeping fluids down");
  });

  /* Age is sent because it changes how an answer reads. A name is not, because
     it buys nothing and it is the one identifier we would be handing over. */
  it("sends the age and never the patient's name", () => {
    const prompt = triagePrompt(base);
    expect(prompt).toContain("54");
    expect(prompt).not.toContain("Asha K started metformin".split(" ")[0] + " K,");
  });

  it("says plainly when nobody spoke, rather than sending an empty section", () => {
    expect(triagePrompt({ ...base, transcript: [] })).toContain("Nobody spoke on this call");
  });

  it("labels speakers so the model is not guessing who said what", () => {
    const prompt = triagePrompt(base);
    expect(prompt).toContain("Patient: I threw up twice yesterday.");
    expect(prompt).toContain("Agent: How have you been?");
  });
});

describe("triagePrompt — what replaced the deleted rules", () => {
  /*
   * These words used to feed a substring matcher that fired inside a negation.
   * They are now the doctor's reference standard, judged in context — so the
   * prompt has to both carry them and say that context matters.
   */
  it("hands the doctor's own escalation words to the model, in context", () => {
    const prompt = triagePrompt(base);
    expect(prompt).toContain("WORDS THE DOCTOR ASKED TO BE TOLD ABOUT");
    expect(prompt).toContain("vomiting");
    expect(prompt).toContain("no fever has not reported a fever");
  });

  it("omits the section entirely when the doctor listed no words", () => {
    expect(triagePrompt({ ...base, redFlagTerms: [] })).not.toContain(
      "WORDS THE DOCTOR ASKED TO BE TOLD ABOUT",
    );
  });

  /* Drift is the failure this product exists to catch, and one call in
     isolation cannot show it. */
  it("tells the model how long the patient has been quiet", () => {
    expect(triagePrompt({ ...base, quietForDays: 4 })).toContain(
      "DAYS SINCE THIS PATIENT WAS LAST HEARD FROM\n\n4",
    );
  });

  it("omits that section when the patient has never been heard from", () => {
    expect(triagePrompt({ ...base, quietForDays: null })).not.toContain(
      "DAYS SINCE THIS PATIENT WAS LAST HEARD FROM",
    );
  });
});
