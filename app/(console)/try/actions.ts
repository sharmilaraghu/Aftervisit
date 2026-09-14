"use server";

/**
 * The judges' instant call: ring a typed number now, with the real script, and
 * keep nothing.
 *
 * The one dial in Care Loop that writes no row before it rings — the exception
 * AGENTS.md records under "The judges' instant call", so a judge can hear the
 * assistant on their own phone without leaving their number in the database.
 * The price is the one law 1 warns about: there is no endpoint to list calls,
 * so a page closed mid-call cannot show that result again.
 *
 * Everything else a patient's call goes through still runs: a passcode (there is
 * no auth), a number normalised to E.164 or refused, a consent tick box passed as
 * `consentGranted`, the note read and grounded by the same compiler, the script
 * assembled with its AI disclosure and stop-the-call clause, and — inside the
 * port — the guard again and the allowlist. A one-time key means a double press
 * is one CALL-E call.
 */

import { callePortFromEnv, REFUSAL_TEXT } from "@/lib/calle/port";
import { readConfig } from "@/lib/config";
import { compileNote } from "@/lib/plan/compile";
import { DEFAULT_GOAL } from "@/lib/plan/defaults";
import { extractFindings, extractSlots, someoneSpoke, type Finding } from "@/lib/plan/extract";
import { buildResultSchema, isTopicUnit, MAX_TOPICS, type TopicSpec } from "@/lib/plan/result-schema";
import { UNIVERSAL_QUESTIONS } from "@/lib/plan/universal-questions";
import { LANGUAGE_OPTIONS, spokenLanguageName } from "@/lib/patients/languages";
import { maskPhone, normalizePhone, REJECTION_TEXT } from "@/lib/phone/normalize";
import { flattenTranscript } from "@/lib/schedule/tick";
import { assembleTask } from "@/lib/script/build";
import { inspectQuestion, inspectTranscript } from "@/lib/script/guard";
import {
  cleanFirstName,
  isCallId,
  isRequestId,
  MAX_NOTE_LENGTH,
  MIN_NOTE_LENGTH,
  passcodeMatches,
} from "@/lib/try/instant";

/* The fixed observations every call records, cleared by guard phase 1 the way a plan's are. */
const QUESTIONS = UNIVERSAL_QUESTIONS.map((q) => ({
  questionId: q.questionId,
  prompt: q.prompt,
  answerType: q.answerType,
  enumValues: q.enumValues ?? null,
  required: true,
  guardApproved: inspectQuestion(q.prompt).ok,
}));

function locked(): string | null {
  const { tryPasscode } = readConfig();
  return tryPasscode ? null : "This page is locked: no passcode is set on this instance.";
}

export type InstantStart =
  | { ok: true; callId: string; masked: string; language: string; goal: string; topics: TopicSpec[] }
  | { ok: false; reason: string };

export async function startInstantCall(input: {
  passcode: string;
  name: string;
  phone: string;
  language: string;
  note: string;
  attested: boolean;
  requestId: string;
}): Promise<InstantStart> {
  const config = readConfig();
  const closed = locked();
  if (closed) return { ok: false, reason: closed };
  if (!passcodeMatches(input.passcode, config.tryPasscode)) {
    return { ok: false, reason: "That passcode is not right." };
  }
  if (!config.liveCallsEnabled) {
    return { ok: false, reason: "Calls are switched off on this instance: no CALL-E key is set." };
  }
  if (!input.attested) {
    return { ok: false, reason: "Confirm the number is yours, or that its owner agreed to an automated call." };
  }
  if (!isRequestId(input.requestId)) return { ok: false, reason: "Reload the page and try again." };

  const name = cleanFirstName(input.name);
  if (!name.ok) return { ok: false, reason: name.reason };

  // No default country: a number without its code is refused, never guessed.
  const phone = normalizePhone(input.phone);
  if (!phone.ok) {
    return {
      ok: false,
      reason: phone.reason === "empty" ? "Enter the number to call, with its country code." : REJECTION_TEXT[phone.reason],
    };
  }

  // Only a tag from the curated list reaches CALL-E and the script.
  const language = LANGUAGE_OPTIONS.find((o) => o.value === input.language);
  if (!language) return { ok: false, reason: "Pick a language from the list." };

  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, reason: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };
  }

  /*
   * A note is read by the same compiler a consultation note is, so what the call
   * follows up on is grounded in the judge's own words and refused where it reads
   * as advice. No note is a general check-in on the default goal.
   */
  let goal = DEFAULT_GOAL;
  let topics: TopicSpec[] = [];
  if (note.length >= MIN_NOTE_LENGTH) {
    const read = await compileNote({ noteBody: note, fallbackReason: "Follow-up" });
    if (!read.ok) {
      return {
        ok: false,
        reason:
          read.reason === "no_provider"
            ? "The note could not be read: no model is configured. Leave the note empty to call without one."
            : `${read.detail} Nothing was dialled.`,
      };
    }
    goal = read.plan.goal;
    topics = read.plan.watchPoints.map((w) => ({ text: w.text, unit: w.unit ?? null }));
  }

  const script = assembleTask({
    patientName: name.name,
    practiceName: config.practiceName,
    clinicianName: config.clinicianName,
    questions: QUESTIONS,
    goal,
    topics,
    speakLanguage: spokenLanguageName(language.value),
    attempt: 1,
    maxAttempts: 1,
  });
  if (!script.ok) return { ok: false, reason: script.detail };

  const dial = await callePortFromEnv().dial({
    task: script.task,
    phone: phone.e164,
    resultSchema: buildResultSchema(topics),
    idempotencyKey: `try:${input.requestId}`,
    approvedQuestions: script.approvedQuestions,
    clinicianStatements: script.clinicianStatements,
    locale: language.value,
    // Nothing that identifies the person; CALL-E already holds the number.
    metadata: { kind: "instant-try" },
    consentGranted: input.attested,
  });
  if (!dial.ok) {
    return { ok: false, reason: dial.refusal === "api_error" ? `${REFUSAL_TEXT.api_error} ${dial.detail}` : REFUSAL_TEXT[dial.refusal] };
  }

  return {
    ok: true,
    callId: dial.call.id,
    masked: maskPhone(phone.e164),
    language: language.label,
    goal,
    topics,
  };
}

export type InstantCheck =
  | { ok: false; reason: string }
  | { ok: true; done: false; status: string }
  | {
      ok: true;
      done: true;
      status: string;
      reached: boolean;
      recap: string | null;
      summary: string | null;
      findings: Finding[];
      /** What a clinician would be shown first on a real follow-up. */
      flags: string[];
      transcript: { speaker: string; text: string }[];
    };

export async function checkInstantCall(
  passcode: string,
  callId: string,
  topics: TopicSpec[],
): Promise<InstantCheck> {
  const closed = locked();
  if (closed) return { ok: false, reason: closed };
  if (!passcodeMatches(passcode, readConfig().tryPasscode)) {
    return { ok: false, reason: "That passcode is not right." };
  }
  if (!isCallId(callId)) return { ok: false, reason: "That is not a call id." };

  let call;
  try {
    // Re-fetched through the authenticated API every time; the page is trusted for the id and nothing else.
    call = await callePortFromEnv().fetchCall(callId);
  } catch {
    return { ok: false, reason: "CALL-E did not answer just now." };
  }

  const status = String(call.status);
  if (!["completed", "failed", "canceled"].includes(status)) return { ok: true, done: false, status };

  const structured = (call.structuredResult ?? null) as Record<string, unknown> | null;
  const transcript = flattenTranscript(call);
  const slots = extractSlots({ structuredResult: structured, questions: QUESTIONS, transcript });

  /* The topics came back from the page, so they only label what CALL-E's own result already holds. */
  const labels: TopicSpec[] = (Array.isArray(topics) ? topics : [])
    .filter((t) => typeof t?.text === "string")
    .slice(0, MAX_TOPICS)
    .map((t) => ({ text: t.text.slice(0, 200), unit: isTopicUnit(t.unit) ? t.unit : null }));

  const flags: string[] = [];
  const said = (id: string) => slots.find((s) => s.questionId === id)?.valueBool === true;
  if (said("requests_clinician")) {
    flags.push("They asked to speak to a person. On a real follow-up this goes straight to a clinician.");
  }
  if (said("emergency_language_heard")) {
    flags.push("They described something urgent. The assistant is told to stop the call; on a real follow-up it escalates at once.");
  }
  const guard = inspectTranscript(transcript.map((t) => ({ speaker: t.speaker, text: t.text })));
  if (!guard.ok) {
    flags.push(`The safety check flagged what the assistant said: ${[...new Set(guard.findings.map((f) => f.category))].join(", ")}.`);
  }

  const recap = typeof structured?.call_recap === "string" && structured.call_recap !== "unknown" ? structured.call_recap : null;

  return {
    ok: true,
    done: true,
    status,
    reached: someoneSpoke({ slots, transcript }),
    recap,
    summary: call.summary ?? null,
    findings: extractFindings(structured, labels),
    flags,
    transcript: transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
  };
}
