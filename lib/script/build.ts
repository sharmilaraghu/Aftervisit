/**
 * Assemble the task CALL-E is given.
 *
 * **Every sentence the agent is told lives in this file.** CALL-E has no
 * mid-call tool calling, so whatever is not written here up front cannot happen,
 * and anything the task does not cover becomes a human's problem afterwards.
 *
 * The agent is given a goal, not a script. The doctor's note has been read into
 * a goal and a few things to find out, each grounded in the note's own words and
 * checked by the clinical guard; the agent asks about them in its own words. What
 * stays fixed is everything that makes that safe: the AI disclosure, the identity
 * check, the stop for anything urgent or a request for the care team, the refusal
 * to give advice, and the list of what to record.
 *
 * The five safety clauses are not decoration. `inspectTask` fails a task that is
 * *missing* any of them, so this frame and the guard are two halves of one
 * contract: change the wording here and the guard tests go red.
 *
 * Pure. No clock, no IO, no model.
 */

import type { AnswerType } from "@/lib/db/enums";
import { isTopicUnit, topicKey, UNIT_LABEL, type TopicSpec } from "@/lib/plan/result-schema";
import { inspectFindOut } from "@/lib/script/guard";

export interface TaskQuestion {
  questionId: string;
  /** What to record. Exempted from phase 2 by exact string, so it must match. */
  prompt: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
  /** Guard phase 1's stored verdict. An unapproved item can never reach a task. */
  guardApproved: boolean;
}

export interface TaskInput {
  patientName: string;
  practiceName: string;
  clinicianName: string;
  /** The fixed observations every call records. */
  questions: TaskQuestion[];
  /** One sentence: what these calls are for, read from the note. */
  goal: string;
  /** What the doctor wants to find out, each grounded in the note. At most five. */
  topics: TopicSpec[];
  /**
   * Sentences the clinician actually wrote, which the agent may quote. Only
   * these are attributable to a person; everything else the agent says is the
   * agent's own.
   */
  clinicianStatements?: string[];
  /**
   * Human-readable language to conduct the call in ("Hindi", "Tamil"), set only
   * when the patient's language is not English. The task stays in English — the
   * guard's required clauses are English patterns, and they check instructions.
   */
  speakLanguage?: string;
  attempt: number;
  maxAttempts: number;
}

export type AssembleResult =
  | {
      ok: true;
      task: string;
      /** Passed to `port.dial()` as the phase-2 exemption set. */
      approvedQuestions: string[];
      clinicianStatements: string[];
    }
  | { ok: false; reason: "no_goal" | "unapproved_question"; detail: string };

/**
 * The one question every call asks in these exact words.
 *
 * Spelled out rather than left to the agent's phrasing, because it is the
 * question that surfaces an emergency, and it is exempted from phase 2 by string.
 */
export const URGENT_CHECK = "Is there anything urgent you need help with right now?";

/** How to record each fixed observation. */
function recordInstruction(q: TaskQuestion): string {
  switch (q.answerType) {
    case "boolean":
      return "Record yes or no from what actually happened on the call, or unknown if it was never established.";
    case "scale_0_10":
      return "Record a whole number from 0 to 10, or unknown if they gave none.";
    case "enum":
      return `Record exactly one of: ${(q.enumValues ?? []).join(", ")}, or unknown. Do not pick the nearest one.`;
    case "text":
      return "Record it in their own words, or unknown.";
  }
}

/**
 * The frame, ordered the way the call runs: who is being called, how to open,
 * what stops the call, what to find out, what to do when unsure, how to close,
 * what to record.
 */
function frame(input: TaskInput, findOut: string, record: string, quotes: string): string {
  const firstName = input.patientName.trim().split(/\s+/)[0];
  const attemptNote =
    input.attempt > 1
      ? `\nThis is attempt ${input.attempt} of ${input.maxAttempts}. Earlier attempts today were not answered. Do not mention the earlier attempts unless they ask.\n`
      : "";
  /*
   * Said before the opening, not after it: a call in another language must not
   * open in English. Every quoted line in this task is English so the guard can
   * check it; the agent says each of them in the patient's language.
   */
  const lang = input.speakLanguage;
  const languageNote = lang
    ? `\nSPEAK THEIR LANGUAGE\n\nConduct the whole call in ${lang}, from your very first word — including the greeting below. Never open in English. Every line quoted in this task is written in English: say each one in ${lang}, keeping its meaning exactly, and ask about everything below in ${lang} too. Record answers using the answer sets given.\n`
    : "";
  const sayIn = lang ? ` in ${lang}` : "";

  return `You are an AI assistant making an automated call from ${input.practiceName} on behalf of ${input.clinicianName} — a scheduled follow-up.

Your job is to find out a few specific things for the care team and record what the patient tells you. You are not here to advise, explain, reassure, or interpret. You have no ability to change anything about this person's care.

Keep this call short. Say each thing once, do not repeat yourself, and do not fill silence with chatter. A follow-up call should take about two minutes.
${attemptNote}
WHO YOU ARE CALLING

Ask for ${firstName}. If the person who answers is not ${firstName}, do not share anything at all about their health, their medicines, or why you are calling. Say only that you will try again later, then end the call.

${languageNote}
HOW TO OPEN

Say this${sayIn}, and nothing more, then move on to what you need to find out:

"Hello — this is ${input.practiceName}'s AI assistant calling on behalf of ${input.clinicianName}. It's your follow-up call, and it'll just take a couple of minutes."

${firstName} has already agreed to these calls, so do not ask permission again. If they say it is a bad time, ask when would suit and end the call.

STOP THE CALL IF SOMETHING IS URGENT

This overrides everything below.

If at any point they describe something that sounds urgent — fainting, chest pain, losing control of their bladder or bowels, numbness or weakness, bleeding, confusion, or anything they say is an emergency — **stop asking questions immediately.** Do not ask the remaining questions. Do not say you cannot answer.

Say${sayIn}: "Thank you for telling me — that does need looking at today. I'm going to stop here and let the care team know right now, and someone will call you back."

Then say${sayIn}: "If this is an emergency, hang up and call your local emergency number now."

Then end the call. Record emergency_language_heard as yes, and everything they told you.

If at any point they ask to speak to anyone from the care team or the practice — a doctor, a nurse, a person rather than you — that is urgent too: **stop asking questions immediately** and do not ask the remaining questions. Wanting to hand the phone to a relative or friend is not this.

Say${sayIn}: "Of course — I'll let the care team know right now, and someone will call you back."

Then end the call. Record requests_clinician as yes, and everything they told you.

${findOut}

WHEN YOU ARE NOT SURE

Never guess an answer, and never pick the closest option because nothing matched. Record it as unknown or unclear instead. An unclear answer is passed to a person to follow up, which is the correct outcome — a guess is not.

If they ask you a medical question — what a symptom means, whether to change a dose — say${sayIn}: "I can't give you medical advice, but I'll pass it on and someone will get back to you." Then carry on. This is only for questions they ask you. It is never the response to a patient describing something urgent, which stops the call.

If they ask to speak to a person, that stops the call — see above.
${quotes}
HOW TO CLOSE

Say${sayIn}: "That's everything, thank you for your time. Someone from the care team will call you back if anything here needs attention."

Then end the call.

${record}`;
}

export function assembleTask(input: TaskInput): AssembleResult {
  const goal = input.goal?.trim() ?? "";
  if (!goal) {
    return {
      ok: false,
      reason: "no_goal",
      detail: "A follow-up with no goal has nothing to find out. Aftervisit will not place an empty call.",
    };
  }

  /*
   * The gate that closes the laundering hole. Everything in `approvedQuestions`
   * is exempted from phase 2 by string, so an item that failed phase 1 must
   * never reach a task — it would be laundered past the check that refused it.
   */
  const unapproved = input.questions.find((q) => !q.guardApproved);
  if (unapproved) {
    return {
      ok: false,
      reason: "unapproved_question",
      detail:
        `"${unapproved.questionId}" has not passed the clinical guard. ` +
        "Aftervisit will not build a call around it.",
    };
  }

  /* A unit outside the closed list is dropped here too: only fixed labels reach the task. */
  const topics = input.topics
    .map((t) => ({ text: t.text.trim(), unit: isTopicUnit(t.unit) ? t.unit : null }))
    .filter((t) => t.text)
    .slice(0, 5);
  const measured = (t: { unit: TopicSpec["unit"] }) =>
    t.unit ? ` (ask for the number, in ${UNIT_LABEL[t.unit]})` : "";

  /*
   * The same laundering gate, for the goal and the topics. They are exempted
   * from phase 2 below, so they are checked again here, at the last pure step
   * before a dial — text stored by an older build, or written some other way,
   * cannot reach a patient on the strength of a check it never passed.
   */
  const unvetted = [goal, ...topics.map((t) => t.text)].find((text) => !inspectFindOut(text).ok);
  if (unvetted !== undefined) {
    return {
      ok: false,
      reason: "unapproved_question",
      detail:
        `"${unvetted}" does not read as something to find out, so it has not passed the clinical guard. ` +
        "Aftervisit will not build a call around it.",
    };
  }

  const topicLines = topics.length
    ? topics.map((t, i) => `${i + 1}. ${t.text}${measured(t)}`).join("\n")
    : "1. How they are getting on since they left the clinic";

  const findOut = `WHAT TO FIND OUT

${goal}

Find out, in your own words:

${topicLines}

Then ask: "${URGENT_CHECK}"

Ask one short, neutral question at a time, in plain words. Never suggest an answer, and never lead ("you're feeling better, aren't you?"). Never advise, diagnose, reassure, or explain what something means. If they have already told you something, do not ask it again.

**Never record something they did not actually tell you.** If the call ends early — including because you stopped it for something urgent — record what you did not get to as not_discussed or unknown. That is accurate, and a person will pick it up.`;

  const recordLines = [
    ...input.questions.map((q) => `- ${q.questionId} — ${q.prompt} ${recordInstruction(q)}`),
    ...topics.map(
      (t, i) =>
        `- ${topicKey(i)} — what they said about "${t.text}": ` +
        (t.unit
          ? `value (the single number they gave, in ${UNIT_LABEL[t.unit]}, digits only; write unknown if they gave none, gave it in another unit, or gave more than one — never convert or estimate one), `
          : "") +
        "answer (a few plain words), patient_words (what they said, in their own words), and clarity (clear, unclear, or not_discussed).",
    ),
    "- call_recap — one line on what they said, in their own words.",
    "- what_else — anything they raised that this call was not asking about. Write unknown if there was nothing.",
  ];

  const record = `WHAT TO RECORD

Record these from the conversation as a whole. They are not questions — never read them out.

${recordLines.join("\n")}`;

  const statements = input.clinicianStatements ?? [];
  const quotes = statements.length
    ? `\nWHAT ${input.clinicianName.toUpperCase()} WROTE\n\nYou may read any of these out word for word if it is relevant. Do not paraphrase them, and do not add to them.\n\n${statements
        .map((s) => `- "${s}"`)
        .join("\n")}\n`
    : "";

  return {
    ok: true,
    task: frame(input, findOut, record, quotes),
    /*
     * Phase 2 exempts by exact string. The goal and topics were checked by phase 1
     * when the note was parsed, and the fixed items and the urgent check are
     * fixed text that passes it — so none of them is the agent's own wording.
     */
    approvedQuestions: [...input.questions.map((q) => q.prompt), goal, ...topics.map((t) => t.text), URGENT_CHECK],
    clinicianStatements: statements,
  };
}
