/**
 * Assemble the task CALL-E is given.
 *
 * **Every sentence the agent may say lives in this file.** That is not a
 * stylistic choice — CALL-E has no mid-call tool calling, so there is no moment
 * during a call when the agent can ask us anything. Whatever is not written
 * here up front cannot happen. Anything the script does not cover has to become
 * a human's problem afterwards, which is why "record it as unclear" appears
 * against every question rather than an instruction to interpret.
 *
 * The five safety clauses below are not decoration either. `inspectTask` fails
 * a script that is *missing* any of them, so the frame and the guard are two
 * halves of one contract: change the wording here and the guard tests go red.
 *
 * Pure. No clock, no IO, no model. Given the same plan it returns the same
 * bytes, which is what makes the script diffable across a retry.
 */

import type { AnswerType } from "@/lib/db/enums";
import { OBSERVED_QUESTION_IDS, UNSPOKEN_RESULT_KEYS } from "@/lib/plan/universal-questions";

export interface TaskQuestion {
  questionId: string;
  /** The exact text spoken. Phase 2 exempts this string by location, so it must match. */
  prompt: string;
  answerType: AnswerType;
  enumValues?: string[] | null;
  /** Guard phase 1's stored verdict. An unapproved question can never reach a script. */
  guardApproved: boolean;
}

export interface TaskInput {
  patientName: string;
  practiceName: string;
  clinicianName: string;
  questions: TaskQuestion[];
  /**
   * Sentences the clinician actually wrote, which the agent may quote. Only
   * these are attributable to a person; everything else the agent says is the
   * agent's own.
   */
  clinicianStatements?: string[];
  /**
   * Human-readable language to conduct the call in ("Hindi", "Tamil"), set only
   * when the patient's language is not English. The task text itself stays in
   * English — the guard's required clauses are English patterns, and they check
   * the instructions, not the conversation.
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
  | { ok: false; reason: "no_questions" | "unapproved_question"; detail: string };

/** How to record each kind of answer, and what to do when it does not fit. */
function answerInstruction(q: TaskQuestion): string {
  switch (q.answerType) {
    case "boolean":
      return "Record yes or no. If they do not give a clear yes or no, record it as unclear.";
    case "scale_0_10":
      return "Record a whole number from 0 to 10. If they do not give a number, record it as unclear.";
    case "enum": {
      const values = (q.enumValues ?? []).join(", ");
      return (
        `Record exactly one of: ${values}. ` +
        "If what they say does not match one of those, record it as unclear. " +
        "Do not pick the nearest one."
      );
    }
    case "text":
      return "Record what they say, in their own words. Do not summarise it.";
  }
}

/**
 * The frame.
 *
 * Ordered the way the call runs, because the model follows it in order: who is
 * being called, how to open, what must be said before any question is asked,
 * the questions, what to do when unsure, how to close.
 */
function frame(input: TaskInput, questionBlock: string, quotes: string): string {
  const firstName = input.patientName.trim().split(/\s+/)[0];
  const attemptNote =
    input.attempt > 1
      ? `\nThis is attempt ${input.attempt} of ${input.maxAttempts}. Earlier attempts today were not answered. Do not mention the earlier attempts unless they ask.\n`
      : "";
  /*
   * Said before the opening, not after it. It used to follow the quoted
   * English greeting, so a Hindi call began in English and switched a sentence
   * later — the one line that tells the patient who is calling, in a language
   * they may not follow. Every quoted line in this task is English only so the
   * guard can check it; the agent says each of them in the patient's language.
   */
  const lang = input.speakLanguage;
  const languageNote = lang
    ? `\nSPEAK THEIR LANGUAGE\n\nConduct the whole call in ${lang}, from your very first word — including the greeting below. Never open in English. Every line quoted in this task is written in English: say each one in ${lang}, keeping its meaning exactly, and say the same for the questions. Record answers using the answer sets given.\n`
    : "";
  const sayIn = lang ? ` in ${lang}` : "";

  return `You are an AI assistant making an automated call from ${input.practiceName} on behalf of ${input.clinicianName} — a scheduled follow-up.

Your job is to ask a short, fixed set of questions and record the answers. You are not here to advise, explain, reassure, or interpret. You have no ability to change anything about this person's care.

Keep this call short. Say each line once, do not repeat yourself, and do not fill silence with chatter. A follow-up call should take about a minute.
${attemptNote}
WHO YOU ARE CALLING

Ask for ${firstName}. If the person who answers is not ${firstName}, do not share anything at all about their health, their medicines, or why you are calling. Say only that you will try again later, then end the call.

${languageNote}
HOW TO OPEN

Say this${sayIn}, and nothing more, then go straight to the first question:

"Hello — this is ${input.practiceName}'s AI assistant calling on behalf of ${input.clinicianName}. It's your follow-up call, and it'll just take a minute."

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

THE QUESTIONS

Ask these in this order, using the wording given. Ask each one once. Do not add questions of your own, and do not explain what a question means.

You must ask every one of them out loud, including the last ones, even if the call has gone well and the answers seem obvious to you. **Never record an answer to a question you did not actually ask.** If the call ends early — including because you stopped it for something urgent — record the questions you did not ask as unclear. That is accurate, and a person will pick them up.

${questionBlock}

WHEN YOU ARE NOT SURE

Never guess an answer, and never pick the closest option because nothing matched. Record it as unclear instead. An unclear answer is passed to a person to follow up, which is the correct outcome — a guess is not.

If they ask you a medical question — what a symptom means, whether to change a dose — say${sayIn}: "I can't give you medical advice, but I'll pass it on and someone will get back to you." Then move to the next question. This is only for questions they ask you. It is never the response to a patient describing something urgent, which stops the call.

If they ask to speak to a person, that stops the call — see above.
${quotes}
HOW TO CLOSE

Say${sayIn}: "That's everything, thank you for your time. Someone from the care team will call you back if anything here needs attention."

Then end the call.

YOUR OWN NOTES

${UNSPOKEN_RESULT_KEYS.length} fields you fill in are not questions, and you must never ask them out loud:

- call_recap — one line on what they said, in their own words.
- what_else — anything they raised that the questions above did not cover. Write unknown if there was nothing.

These are your notes on the call, not answers from the patient, so filling them in is not "recording an answer to a question you did not ask".`;
}

export function assembleTask(input: TaskInput): AssembleResult {
  if (input.questions.every((q) => OBSERVED_QUESTION_IDS.has(q.questionId))) {
    return {
      ok: false,
      reason: "no_questions",
      detail: "A plan with no questions has nothing to ask. Care Loop will not place an empty call.",
    };
  }

  /*
   * The gate that closes the laundering hole. A question that failed guard
   * phase 1 must never reach a script, because `port.dial()` exempts every
   * string in `approvedQuestions` from phase 2 — so an unapproved question in
   * that list would be laundered past the very check that rejected it.
   */
  const unapproved = input.questions.find((q) => !q.guardApproved);
  if (unapproved) {
    return {
      ok: false,
      reason: "unapproved_question",
      detail:
        `The question "${unapproved.questionId}" has not passed the clinical guard. ` +
        "Care Loop will not build a script around it.",
    };
  }

  /*
   * Spoken and observed are separated here, not in the caller.
   *
   * An observation numbered in the question list is a question — the agent
   * reads the list and asks what is in it. Keeping them apart is the whole
   * mechanism, and doing it at the point the script is written means no call
   * site can forget.
   */
  const spoken = input.questions.filter((q) => !OBSERVED_QUESTION_IDS.has(q.questionId));
  const observed = input.questions.filter((q) => OBSERVED_QUESTION_IDS.has(q.questionId));

  const questionBlock = spoken
    .map((q, i) => `${i + 1}. Ask: "${q.prompt}"\n   ${answerInstruction(q)}`)
    .join("\n\n");

  const observedBlock = observed.length
    ? `\n\nRECORD THESE FROM THE CALL — NEVER ASK THEM\n\n${observed
        .map((q) => `- ${q.questionId} — ${q.prompt} Record yes if they did, no if they did not.`)
        .join("\n")}\n\nThese are things you noticed, not questions you asked. Record what actually happened on the call.

Do not record these as unclear. You either heard it or you did not, and "no" is the honest answer when you did not.`
    : "";

  const statements = input.clinicianStatements ?? [];
  const quotes = statements.length
    ? `\nWHAT ${input.clinicianName.toUpperCase()} WROTE\n\nYou may read any of these out word for word if it is relevant. Do not paraphrase them, and do not add to them.\n\n${statements
        .map((s) => `- "${s}"`)
        .join("\n")}\n`
    : "";

  return {
    ok: true,
    task: frame(input, questionBlock + observedBlock, quotes),
    /* Phase 2 exempts by exact string, so an observation's prompt has to be
       exempted too — it is in the task text, it just is not asked. */
    approvedQuestions: input.questions.map((q) => q.prompt),
    clinicianStatements: statements,
  };
}
