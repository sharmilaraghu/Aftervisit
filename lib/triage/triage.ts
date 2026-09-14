/**
 * Reading a finished call, so a doctor does not have to.
 *
 * **This decides.** It reads the transcript, sets the severity, writes the
 * sentence a clinician actually reads, and names which of the doctor's own
 * escalation conditions the call touched. It used to sit on top of ten rule
 * kinds that matched on typed slots; those are gone, because deciding what a
 * patient meant from a substring is not a thing code can do well. A real call
 * proved it: the rules reported "answer could not be mapped" for a line that
 * declined, and this said "the call ended immediately with no speech from the
 * patient."
 *
 * **A small floor remains underneath, and that is the point.** Four rules —
 * the patient asked for a person, emergency language, an answer nobody could
 * map, nobody answered at all — still fire with no model available. So a
 * provider outage degrades the product to *unjudged but still escalated*,
 * rather than to silence. That is the whole reason `evaluate()` was kept.
 *
 * **This never speaks to a patient.** It reads a transcript that already
 * happened and writes to a clinician. The clinical guard governs what the agent
 * *says*, and nothing in this file can reach a patient's ear.
 */

import { complete, hasProvider, NoProviderError } from "@/lib/plan/provider";
import { TRIAGE_SCHEMA, readTriageAnswer, type TriageAnswer } from "@/lib/triage/schema";
import type { CompileProvider, TriageStatus } from "@/lib/db/enums";
import type { StoredConfidence, StoredTurn } from "@/lib/db/schema";
import type { Finding } from "@/lib/plan/extract";
import { UNIT_LABEL } from "@/lib/plan/result-schema";

/**
 * Long enough for a real answer, short enough that a hung provider cannot hold
 * a console page open. `complete()` has no timeout of its own and `tick()` runs
 * on page loads, so without this one stuck request stalls the console for
 * everyone looking at it.
 */
const TIMEOUT_MS = 20_000;

const SYSTEM = `You read one finished follow-up phone call and tell a clinician what it amounts to.

You are a reader, not a clinician. You never diagnose, never advise, never reassure, and never decide anything about this patient's care. Your job is to say what happened and how much attention it needs.

Rules you must follow exactly:

1. Use only what is in the transcript. Never infer a symptom the patient did not describe, and never add a clinical term they did not use.
2. The doctor's own escalation conditions, when given, are the standard. If the patient's words touch one of them, say so in the doctor's wording.
3. Answer severe only when the patient described something a clinician should see today. A plan is paused on severe, and a paused plan stops calling a patient who may still need calling.
4. Never answer low from an absence of evidence. If nobody spoke, if the call cut out, or if you cannot tell, answer escalate and say why.
5. Quote the patient exactly. Never tidy their grammar, and never put words in their mouth.`;

export interface TriageInput {
  /** The doctor's own list of what to escalate on, verbatim. */
  escalationNote: string | null;
  /** The consultation note, for what this follow-up is actually about. */
  noteBody: string;
  /** Age only — never the name. */
  patientAge: number | null;
  reason: string;
  /** What the call set out to find out. */
  goal?: string | null;
  /** What the patient said about each thing the note asked about. */
  findings?: Finding[];
  transcript: StoredTurn[] | null;
  slots: { questionId: string; status: string; value: string | null }[];
  /** CALL-E's own read of the call. Stored on every call and, until now, unused. */
  platform: {
    summary: string | null;
    taskCompleted: boolean | null;
    confidence: StoredConfidence | null;
    evidence: string[] | null;
  };
  /** What the floor already flagged, so the model is not guessing at it. */
  ruleHits: { ruleLabel: string; urgent: boolean }[];
  /**
   * The doctor's own escalation vocabulary.
   *
   * These words used to feed a substring matcher in the rule engine, which
   * fired inside a negation ("no fever"), ran against a heuristically chosen
   * utterance, and could never say why it matched. Handing them to the model
   * instead makes them what they always were: the doctor's reference standard,
   * read in context.
   */
  redFlagTerms: string[];
  /** Calendar days since this patient was last heard from, in their own zone. */
  quietForDays: number | null;
  env?: NodeJS.ProcessEnv;
}

export type TriageOutcome = {
  status: TriageStatus;
  answer: TriageAnswer;
  provider: CompileProvider | null;
  model: string | null;
  raw: unknown;
  error: string | null;
};

/**
 * The verdict used whenever the model did not give us one.
 *
 * `escalate`, never `low`. A call nobody could judge is a call a human should
 * look at — and it is deliberately not `severe`, because an outage must not
 * pause every plan on the roster.
 */
function failClosed(status: TriageStatus, error: string): TriageOutcome {
  return {
    status,
    answer: {
      verdict: "escalate",
      reason:
        "AfterVisit could not read this call automatically, so it is being shown to you " +
        "unjudged. The safety floor that runs without a model found nothing further.",
      summary: "",
      keyTerms: [],
      matchedConcerns: [],
      quote: "",
    },
    provider: null,
    model: null,
    raw: null,
    error,
  };
}

/** The user message. Separated so it can be asserted on without a provider. */
export function triagePrompt(input: TriageInput): string {
  const parts: string[] = [];

  if (input.escalationNote?.trim()) {
    parts.push(`WHAT THE DOCTOR SAID TO WATCH FOR\n\n${input.escalationNote.trim()}`);
  }
  parts.push(`WHAT THIS FOLLOW-UP IS ABOUT\n\n${input.reason}\n\n${input.noteBody.trim()}`);
  if (input.patientAge !== null) parts.push(`PATIENT AGE\n\n${input.patientAge}`);

  if (input.goal?.trim()) {
    parts.push(`WHAT THIS CALL SET OUT TO FIND OUT\n\n${input.goal.trim()}`);
  }
  if (input.findings?.length) {
    const lines = input.findings
      .map(
        (f) =>
          `- ${f.topic}: ${f.clarity ?? "not recorded"}` +
          (f.value !== null ? ` · ${f.value}${f.unit ? ` ${UNIT_LABEL[f.unit]}` : ""}` : "") +
          (f.answer ? ` — ${f.answer}` : "") +
          (f.patientWords ? ` ("${f.patientWords}")` : ""),
      )
      .join("\n");
    parts.push(`WHAT THE PATIENT SAID, BY TOPIC\n\n${lines}`);
  }

  if (input.slots.length > 0) {
    const lines = input.slots
      .map((s) => `- ${s.questionId}: ${s.status}${s.value ? ` — ${s.value}` : ""}`)
      .join("\n");
    parts.push(`WHAT WAS RECORDED\n\n${lines}`);
  }

  if (input.redFlagTerms.length > 0) {
    parts.push(
      `WORDS THE DOCTOR ASKED TO BE TOLD ABOUT\n\n${input.redFlagTerms.join(", ")}\n\n` +
        "Judge them in context. A patient saying they have no fever has not reported a fever.",
    );
  }

  if (input.quietForDays !== null) {
    parts.push(`DAYS SINCE THIS PATIENT WAS LAST HEARD FROM\n\n${input.quietForDays}`);
  }

  if (input.ruleHits.length > 0) {
    const lines = input.ruleHits
      .map((h) => `- ${h.ruleLabel}${h.urgent ? " (urgent)" : ""}`)
      .join("\n");
    parts.push(`WHAT THE SAFETY FLOOR ALREADY FLAGGED\n\n${lines}`);
  }

  const platform = input.platform;
  if (platform.summary || platform.evidence?.length) {
    const bits = [platform.summary ?? ""];
    if (platform.taskCompleted !== null) {
      bits.push(`Reached an end state: ${platform.taskCompleted ? "yes" : "no"}`);
    }
    if (platform.evidence?.length) bits.push(`Evidence: ${platform.evidence.join("; ")}`);
    parts.push(`WHAT THE CALLING PLATFORM MADE OF IT\n\n${bits.filter(Boolean).join("\n")}`);
  }

  const turns = input.transcript ?? [];
  parts.push(
    turns.length > 0
      ? `THE TRANSCRIPT\n\n${turns
          .map((t) => `${isAgent(t.speaker) ? "Agent" : "Patient"}: ${t.text}`)
          .join("\n")}`
      : "THE TRANSCRIPT\n\nThere is none. Nobody spoke on this call.",
  );

  return parts.join("\n\n");
}

function isAgent(speaker: string): boolean {
  return ["agent", "assistant", "bot", "ai"].includes(speaker.toLowerCase());
}

/**
 * Read a call. Never throws.
 *
 * Every failure path returns a usable outcome carrying `verdict: "escalate"`,
 * because the caller runs inside the scheduler and a thrown error there would
 * abandon the rest of the queue for one unreadable call.
 */
export async function triageCall(input: TriageInput): Promise<TriageOutcome> {
  const env = input.env ?? process.env;

  if (!hasProvider(env)) {
    return failClosed("unavailable", new NoProviderError().message);
  }

  let result;
  try {
    result = await Promise.race([
      complete(
        { system: SYSTEM, user: triagePrompt(input), schema: TRIAGE_SCHEMA, name: "call_triage" },
        env,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    return failClosed(
      "error",
      error instanceof Error ? error.message : "The call could not be read.",
    );
  }

  const answer = readTriageAnswer(result.raw);
  if (!answer) {
    const outcome = failClosed("unparseable", "The model's answer could not be read.");
    return { ...outcome, provider: result.provider, model: result.model, raw: result.raw };
  }

  return {
    status: "ok",
    answer,
    provider: result.provider,
    model: result.model,
    raw: result.raw,
    error: null,
  };
}
