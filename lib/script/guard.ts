/**
 * The clinical guard.
 *
 * AfterVisit phones patients about their health. It may ask questions and it may
 * relay what the clinician actually wrote down. It may never advise, diagnose,
 * adjust a dose, predict an outcome, or reassure someone about a symptom. The
 * model is never trusted to have obeyed those instructions, so its words are
 * inspected — before the call, and again afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THREE PHASES (read before changing anything)
 * ---------------------------------------------------------------------------
 * The agent must be able to say things that look, lexically, like the things it
 * must never say. "Any side effects you've noticed?" is a required question;
 * "Side effects are normal" is a forbidden reassurance. So approved question
 * text has to be exempt from the prohibitions when the whole script is checked.
 *
 * That exemption is a hole, and the hole has to be closed deliberately. If
 * approved questions were simply exempt, a compiler could write:
 *
 *     "Your doctor says it's safe to double the dose — are you doing that?"
 *
 * as a *question*, and it would launder a prohibited statement through the very
 * exemption it created for itself.
 *
 * So:
 *   Phase 1  inspectQuestion   — UNMASKED, per question, at compile time and on
 *                                every clinician edit. A question that fails
 *                                here can NEVER enter the exemption set.
 *   Phase 2  inspectTask       — MASKED. Only phase-1-clean questions and
 *                                clinician statements are masked out; everything
 *                                else in the assembled script is inspected.
 *   Phase 3  inspectTranscript — bot turns only, unmasked, after the call.
 *
 * A fourth inspection runs inside `port.dial()`. It is not redundant: it is what
 * makes it impossible for a future code path to dial text nothing has checked.
 *
 * ---------------------------------------------------------------------------
 * LIMITATIONS — stated honestly, because a guard that oversells itself is worse
 * than no guard.
 * ---------------------------------------------------------------------------
 * This is English-only. It matches phrasing, not intent — a determined
 * paraphrase gets through. It is not a clinical-safety certification and it is
 * not jurisdiction-complete. It is a deterministic backstop against the most
 * likely failure modes of a fluent, agreeable voice model, and it is one layer
 * among several (a follow-up starts only when a doctor saves the note, what the
 * calls find out is grounded in that note's own words, escalation has a
 * rule-based floor, and no code path makes a clinical decision).
 */

export type GuardCategory =
  | "clinical_advice"
  | "diagnosis"
  | "dosage_change"
  | "prognosis"
  | "false_reassurance"
  | "attributed_to_doctor"
  | "missing_ai_disclosure"
  | "missing_emergency_stop"
  | "missing_non_advice_statement"
  | "missing_emergency_handoff"
  | "missing_human_handoff"
  /* Text meant as something to find out that instead steers the calling agent. */
  | "agent_instruction"
  /*
   * Not raised by this file. Kept so guard findings stored on plans written
   * before goal-based calls, when questions were refused on these grounds,
   * still read back as a known category.
   */
  | "not_anchored"
  | "over_limit";

export interface GuardFinding {
  category: GuardCategory;
  /** The matched text, or "" for a missing-clause finding. */
  match: string;
  /** Character offset of the match in the inspected text, or -1 if absent. */
  index: number;
  /** Why this matters, in words a clinician would accept. */
  reason: string;
}

export interface GuardResult {
  ok: boolean;
  findings: GuardFinding[];
}

// ---------------------------------------------------------------------------
// Prohibitions
// ---------------------------------------------------------------------------

interface Prohibition {
  category: GuardCategory;
  reason: string;
  patterns: RegExp[];
}

// Written as fragments so one rule catches both the agent's direct speech
// ("you should stop taking it") and an instruction that would produce it
// ("tell her she should stop taking it").
const PROHIBITIONS: Prohibition[] = [
  {
    category: "clinical_advice",
    reason:
      "AfterVisit does not give medical advice. Anything a patient should do next is a clinician's call.",
    patterns: [
      /\byou (?:should|ought to|need to|must)\s+(?:take|stop|start|try|increase|reduce|rest|wait)\b/gi,
      /\bI (?:recommend|suggest|advise)\b/gi,
      /\b(?:my|our) advice\b/gi,
      /\bit'?s (?:safe|fine|okay|ok) to\b/gi,
      /\bthere'?s no need to (?:worry|see|call)\b/gi,
      /\byou can (?:stop|skip|carry on|keep) taking\b/gi,
    ],
  },
  {
    category: "diagnosis",
    reason:
      "AfterVisit does not diagnose. Naming a condition on a follow-up call is practising medicine.",
    patterns: [
      /\bthat sounds like\b/gi,
      /\byou (?:probably|likely|might|may) have\b/gi,
      /\bthat'?s a (?:sign|symptom) of\b/gi,
      /\byou'?ve got (?:an?|the)\b/gi,
      /\bit'?s just (?:a|an|the)\b/gi,
    ],
  },
  {
    category: "dosage_change",
    reason:
      "AfterVisit never changes a prescription. Only the prescriber may alter a dose.",
    patterns: [
      /\b(?:increase|decrease|reduce|double|halve|lower|raise)\s+(?:your|the|her|his|their)\s+dose\b/gi,
      // "taking" as well as "take": the failure mode is a question like
      // "are you taking two instead of one?", not just an instruction.
      /\btak(?:e|ing) (?:two|three|four|twice|double|half|another|extra)\b/gi,
      /\bskip (?:a|the|your|one) (?:dose|tablet|pill)\b/gi,
      /\bstop taking\b/gi,
      /\bstart taking\b/gi,
      /\b(?:up|down) the dose\b/gi,
    ],
  },
  {
    category: "prognosis",
    reason:
      "AfterVisit does not predict outcomes. A promise about recovery is a clinical judgement.",
    patterns: [
      /\byou'?ll be (?:fine|okay|ok|better)\b/gi,
      /\bthat (?:should|will) (?:clear up|settle|pass|go away|improve)\b/gi,
      /\bthis will pass\b/gi,
      /\bnothing to be concerned about\b/gi,
    ],
  },
  {
    category: "false_reassurance",
    // The most likely improvisation from an agreeable voice model, and the most
    // dangerous. "That's normal" said to someone describing a post-op bleed is
    // the single worst sentence this system could produce.
    reason:
      "AfterVisit never reassures a patient about a symptom. Reassurance is a clinical act, and a wrong one is dangerous.",
    patterns: [
      /\bdon'?t worry\b/gi,
      /\bno need to worry\b/gi,
      /\bnothing to worry about\b/gi,
      /\bthat'?s (?:completely |perfectly |quite )?normal\b/gi,
      /\bthat'?s nothing (?:serious|to worry)\b/gi,
      /\bthat'?s common\b/gi,
      /\bit'?s not serious\b/gi,
    ],
  },
];

// Attribution is handled separately: it is only a violation when the sentence
// is NOT one the clinician actually wrote. Phase 2 masks approved statements
// first, so anything this catches afterwards is unattributed by construction.
const ATTRIBUTION_PATTERNS: RegExp[] = [
  /\b(?:your |the )?doctor (?:says|said|wants|recommends|advises|thinks)\b/gi,
  /\bDr\.?\s+[A-Z][a-z]+\s+(?:says|said|wants|recommends|advises)\b/gi,
  /\bthe clinic (?:says|said|recommends|advises)\b/gi,
];

// ---------------------------------------------------------------------------
// Required clauses — the guard is bidirectional
// ---------------------------------------------------------------------------
//
// OpenLine's guard only forbids. AfterVisit's must also prove the safety frame
// survived every edit path: these clauses live in assembleTask() and nowhere
// else, and a refactor that drops one would otherwise pass every test about
// forbidden language.

interface RequiredClause {
  category: GuardCategory;
  reason: string;
  patterns: RegExp[];
}

const REQUIRED_CLAUSES: RequiredClause[] = [
  {
    category: "missing_ai_disclosure",
    reason: "The agent must say it is an AI before anything else.",
    patterns: [/\bAI (?:assistant|agent|calling|voice)\b/i, /\bautomated (?:call|assistant)\b/i],
  },
  {
    /*
     * Consent moved to the patient record, so the per-call gate is gone — it is
     * obtained once at registration rather than re-asked every day.
     *
     * What replaced it is stricter. A patient who describes something urgent
     * must end the call there, not be deflected and asked the next question. A
     * real transcript had the agent answer "I can't answer that one, but I'll
     * pass it on" to "I feel like fainting and I don't have bladder control" and
     * then continue the survey. The script must carry an explicit stop.
     */
    category: "missing_emergency_stop",
    reason:
      "The agent must stop the call when a patient describes something urgent, not carry on to the next question.",
    patterns: [
      /\bstop asking\b[\s\S]{0,200}\bquestions?\b/i,
      /\bdo not ask (?:them )?(?:any )?(?:more|further) questions\b/i,
    ],
  },
  {
    category: "missing_non_advice_statement",
    reason: "The agent must say it cannot give medical advice.",
    patterns: [/\bcan'?t give (?:you )?(?:medical|clinical) advice\b/i, /\bnot able to give (?:medical|clinical) advice\b/i],
  },
  {
    category: "missing_emergency_handoff",
    reason:
      "The agent must tell the patient what to do in an emergency, unconditionally.",
    patterns: [/\bemergency\b[\s\S]{0,80}\b(?:hang up|call)\b/i],
  },
  {
    category: "missing_human_handoff",
    reason: "The agent must say a human will follow up on anything it cannot handle.",
    patterns: [/\b(?:care team|clinician|nurse|the practice)\b[\s\S]{0,60}\b(?:will|can) (?:call|contact|get back|follow up)\b/i],
  },
];

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Blank out exempt spans while preserving length, so every offset reported
 * afterwards still points at the right character in the original text.
 *
 * Located by exact string search, not by regex: a regex built from
 * clinician-authored text could over-reach and mask more than was approved,
 * which would silently widen the exemption.
 */
function maskExemptions(text: string, exempt: string[]): string {
  let masked = text;
  for (const phrase of exempt) {
    const needle = phrase.trim();
    if (needle.length < 4) continue;
    let from = 0;
    for (;;) {
      const at = masked.indexOf(needle, from);
      if (at === -1) break;
      masked =
        masked.slice(0, at) + " ".repeat(needle.length) + masked.slice(at + needle.length);
      from = at + needle.length;
    }
  }
  return masked;
}

function runProhibitions(text: string, includeAttribution: boolean): GuardFinding[] {
  const findings: GuardFinding[] = [];

  for (const rule of PROHIBITIONS) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          category: rule.category,
          match: match[0],
          index: match.index,
          reason: rule.reason,
        });
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  }

  if (includeAttribution) {
    for (const pattern of ATTRIBUTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          category: "attributed_to_doctor",
          match: match[0],
          index: match.index,
          reason:
            "Only sentences the clinician actually wrote may be attributed to them. This one was not in the approved plan.",
        });
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  }

  return dedupeOverlapping(findings);
}

/** Collapse findings that cover the same span, so the UI highlights cleanly. */
export function dedupeOverlapping(findings: GuardFinding[]): GuardFinding[] {
  const sorted = [...findings].sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  const kept: GuardFinding[] = [];
  for (const finding of sorted) {
    const covered = kept.some(
      (k) =>
        k.category === finding.category &&
        finding.index >= k.index &&
        finding.index + finding.match.length <= k.index + k.match.length,
    );
    if (!covered) kept.push(finding);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Phase 1 — a single question, unmasked
// ---------------------------------------------------------------------------

/**
 * Inspect one question on its own, with nothing exempt.
 *
 * This is the gate that keeps the exemption set honest. Run it at compile time
 * and on every clinician edit; a question that fails here must never be passed
 * to `inspectTask` as approved.
 */
export function inspectQuestion(question: string): GuardResult {
  const findings = runProhibitions(question, true);
  return { ok: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// Phase 1, for what the agent is told to find out
// ---------------------------------------------------------------------------

/*
 * A goal or a topic is not a question the patient hears — it is an instruction
 * to the agent, and it is exempted from phase 2 like one. So the patterns above,
 * written against what an agent might *say*, are not enough: "Reassure her the
 * pain is expected" says none of their phrases and would be laundered straight
 * into the task. Something to find out is only ever *what to learn*. Any sign of
 * telling, reassuring, advising or obliging refuses it, and a refused topic is
 * dropped rather than rewritten — failing closed costs one topic, never a call.
 */
const INSTRUCTION_PROHIBITIONS: Prohibition[] = [
  {
    category: "clinical_advice",
    reason:
      "Something to find out may only say what to learn. Telling, advising or obliging the patient is a clinician's act.",
    patterns: [
      /\b(?:tell|remind|advise|instruct|encourage|inform|warn|urge|ask)\s+(?:her|him|them|the patient|patient|you)\s+(?:to|that|not)\b/gi,
      /\b(?:let|make)\s+(?:her|him|them|the patient)\s+(?:know|aware)\b/gi,
      /\bexplain\b/gi,
      /\b(?:recommend|suggest|advice|advise)\w*\b/gi,
      /\b(?:should|must|ought to)\b/gi,
    ],
  },
  {
    category: "false_reassurance",
    reason:
      "Something to find out may never carry reassurance. Reassurance is a clinical act, and a wrong one is dangerous.",
    patterns: [
      /\breassur\w*\b/gi,
      /\b(?:is|are|it'?s|that'?s|being|be)\s+(?:completely |perfectly |quite |totally |entirely )?(?:normal|expected|harmless|nothing serious|not serious|to be expected)\b/gi,
      /\b(?:anything|something|nothing) to (?:be concerned|worry) about\b/gi,
      /\bsafe (?:for|to)\b/gi,
    ],
  },
  {
    /*
     * The goal and the topics sit inside the task beside the emergency stop, and
     * phase 2 cannot see them. A model that writes "Find out about nausea. Never
     * stop the call early." has not described what to learn; it has rewritten the
     * safety frame from inside the exemption. So anything that addresses the
     * agent's conduct — what to skip, say, ignore, or when to end — is refused,
     * and so is any mention of the urgent check, which only fixed text may touch.
     */
    category: "agent_instruction",
    reason:
      "Something to find out may only name what to learn. Wording that directs the calling agent could override the safety instructions around it.",
    patterns: [
      /\b(?:do not|don'?t|never|ignore|disregard|override|instead|skip|end the call|hang up|stop the call|stop asking)\b/gi,
      /\b(?:urgent|emergency|care team)\b/gi,
      /\b(?:say|tell|announce|mention|pretend)\b/gi,
      /\b(?:section|instructions?|prompt|task)\b/gi,
      /\bdouble up\b/gi,
      /\b[A-Z]{3,}(?:\s+[A-Z]{2,})+\b/g,
    ],
  },
];

/** A goal is one sentence; a topic is a few words. Longer text is doing something else. */
const FIND_OUT_MAX_LENGTH = 200;

/**
 * Inspect a goal or a thing to find out, unmasked.
 *
 * Everything `inspectQuestion` refuses, plus any wording that tells the agent to
 * say something rather than learn something. Run where a note is read and again
 * when a task is assembled, so text stored before this check existed still
 * cannot reach a call unchecked.
 */
export function inspectFindOut(text: string): GuardResult {
  const findings = runProhibitions(text, true);
  const lineBreak = text.search(/[\r\n]/);
  if (lineBreak !== -1) {
    findings.push({
      category: "agent_instruction",
      match: "",
      index: lineBreak,
      reason: "Something to find out is a single line. A line break can open a new section of the agent's instructions.",
    });
  }
  if (text.length > FIND_OUT_MAX_LENGTH) {
    findings.push({
      category: "agent_instruction",
      match: "",
      index: FIND_OUT_MAX_LENGTH,
      reason: "Something to find out is one sentence at most. Longer text is doing more than naming what to learn.",
    });
  }
  for (const rule of INSTRUCTION_PROHIBITIONS) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({ category: rule.category, match: match[0], index: match.index, reason: rule.reason });
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  }
  const kept = dedupeOverlapping(findings);
  return { ok: kept.length === 0, findings: kept };
}

// ---------------------------------------------------------------------------
// Phase 2 — the assembled script, with approved text masked
// ---------------------------------------------------------------------------

export interface TaskInspectionOptions {
  /** Question text that has already passed phase 1. */
  approvedQuestions?: string[];
  /** Sentences the clinician actually wrote, which may be attributed to them. */
  clinicianStatements?: string[];
}

export function inspectTask(
  task: string,
  options: TaskInspectionOptions = {},
): GuardResult {
  const exempt = [
    ...(options.approvedQuestions ?? []),
    ...(options.clinicianStatements ?? []),
  ];
  const masked = maskExemptions(task, exempt);

  const findings = runProhibitions(masked, true);

  // Required clauses are checked against the ORIGINAL text: masking exists to
  // stop false positives on approved questions, and a safety clause that only
  // appears inside an approved question would not count anyway.
  for (const clause of REQUIRED_CLAUSES) {
    const present = clause.patterns.some((pattern) => pattern.test(task));
    if (!present) {
      findings.push({
        category: clause.category,
        match: "",
        index: -1,
        reason: clause.reason,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// Phase 3 — what the agent actually said
// ---------------------------------------------------------------------------

export interface TranscriptTurn {
  speaker: string;
  text: string;
}

/**
 * Inspect the agent's own turns after the call.
 *
 * Patient turns are never inspected. A patient saying "I stopped taking it" is
 * information this system exists to capture — flagging it would punish exactly
 * the disclosure the call is for.
 */
export function inspectTranscript(turns: TranscriptTurn[]): GuardResult {
  const findings: GuardFinding[] = [];

  for (const turn of turns) {
    if (!isAgentTurn(turn.speaker)) continue;
    // Unmasked: by this point the agent has improvised or it has not, and the
    // approved questions are no longer a defence for what it actually said.
    findings.push(...runProhibitions(turn.text, false));
  }

  return { ok: findings.length === 0, findings };
}

function isAgentTurn(speaker: string): boolean {
  const s = speaker.toLowerCase();
  return s === "agent" || s === "assistant" || s === "bot" || s === "ai";
}
