/**
 * Seed the demo cohort.
 *
 * Two things this script deliberately does *not* do:
 *
 *   - It does not write a `state`, a `contacted` count, a `quietFor` or a week
 *     band. None of those are columns. It writes real plans and real
 *     `scheduled_calls` rows with real outcomes, and the console derives the
 *     roster back out of them. If the derivation is wrong, the seeded roster
 *     looks wrong — which is the point.
 *   - It does not fabricate a `no_answer` that CALL-E never reported. The
 *     seeded misses belong to a patient whose demo line genuinely does not
 *     answer; the live retry ladder is exercised against that line, not against
 *     these rows.
 *
 * Every fixed observation a plan records is run through the real guard, phase
 * 1, and the verdict is stored. One that fails is reported rather than quietly
 * stored.
 *
 * The cohort exists to put every derived state on the roster at once:
 * `escalated`, `never_reached`, `drifting`, `needs_plan`, `on_track` and
 * `completed`, with a week band covering all five day states.
 * None of those is written anywhere — they are what `deriveHealth()` makes of
 * the rows below.
 *
 * Re-runnable: it clears the Aftervisit tables first, in foreign-key order.
 *
 * `--closed` seeds the same patients as finished history instead: every
 * follow-up closed by the doctor with a closing summary, every escalation
 * resolved, no visits waiting and no call still ahead — so a live deployment
 * gets a record to show without the scheduler having anyone to ring. It clears
 * only seeded patients that are not archived, so archived history stays.
 *
 * `--closed` also books visits on earlier days — two seen, each linked to the
 * note its closed course came from, and one patient who never turned up — so
 * the consult history has both endings without anyone waiting today. Waiting
 * patients are left to be booked by hand.
 */

import { config } from "dotenv";

config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql as sqlRaw } from "drizzle-orm";

import * as schema from "../lib/db/schema";
import { newId, idempotencyKey } from "../lib/db/ids";
import { inspectQuestion } from "../lib/script/guard";
import { normalizePhone } from "../lib/phone/normalize";
import { readConfig } from "../lib/config";
import { redFlagsFor } from "../data/red-flags";
import { addDays, localDate, zonedTimeToUtc } from "../lib/time/clock";
import { defaultRules, lockedRules } from "../lib/rules/catalog";
import {
  DEMO_UTTERANCES,
  SEED_PATIENTS,
  SEED_UNPLANNED,
  SEED_CLOSED_EXTRA,
  SEED_NO_SHOWS,
  type SeedDay,
} from "../data/demo-patients";
import { UNIVERSAL_QUESTIONS } from "../lib/plan/universal-questions";
import { buildResultSchema, topicKey, type TopicSpec } from "../lib/plan/result-schema";
import type { PlanRule, RedFlagTerm } from "../lib/rules/types";
import type { StoredTurn } from "../lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Fill in .env before seeding.");
  process.exit(1);
}

const db = drizzle(neon(url), { schema });

/** Finished history only: nothing scheduled, nothing open, nothing waiting. */
const CLOSED = process.argv.includes("--closed");

/** Every number closed seeding writes — and so the only numbers it may clear. */
const CLOSED_PHONES = [...SEED_PATIENTS, ...SEED_CLOSED_EXTRA, ...SEED_NO_SHOWS].map((p) => p.phone);

// ---------------------------------------------------------------------------
// What every call records
// ---------------------------------------------------------------------------

/**
 * The fixed observations, exactly the rows `createPlanFromNote` writes. The
 * agent asks about the note's topics in its own words; these are what it
 * records while doing so, and what the floor and the doctor's view read.
 */
const QUESTIONS = UNIVERSAL_QUESTIONS;

/** One reached call's structured result, shaped as CALL-E returns it for this schema. */
function callResult(input: {
  utterance: string;
  change: "better" | "same" | "worse";
  concern: "not_concerned" | "mildly" | "very";
  goalCovered: "all" | "some" | "none";
  topicAnswers?: string[];
  utteranceTopic?: number;
  /** A measured topic's number on this call, and every topic's unit. */
  measured?: { topic: number; value: string | undefined };
  units?: (string | undefined)[];
}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    reached_patient: "yes",
    requests_clinician: "no",
    emergency_language_heard: "no",
    symptom_change: input.change,
    patient_concern: input.concern,
    something_else_raised: "no",
    goal_covered: input.goalCovered,
    what_else: "unknown",
    call_recap: input.utterance,
  };
  (input.topicAnswers ?? []).forEach((answer, i) => {
    result[topicKey(i)] = {
      ...(input.units?.[i]
        ? { value: input.measured?.topic === i ? (input.measured.value ?? "unknown") : "unknown" }
        : {}),
      answer,
      patient_words: i === input.utteranceTopic ? input.utterance : "unknown",
      clarity: "clear",
    };
  });
  return result;
}

/** The slots `completeCall` would extract from that result, one per fixed observation. */
function slotRows(
  callId: string,
  patientId: string,
  structured: Record<string, unknown>,
  utterance: string,
  finishedAt: Date,
): Row[] {
  return QUESTIONS.map((q) => {
    const raw = structured[q.questionId];
    const text = typeof raw === "string" ? raw : null;
    return {
      id: newId("slot"),
      callId,
      patientId,
      questionId: q.questionId,
      status: "answered",
      valueBool: q.answerType === "boolean" && (text === "yes" || text === "no") ? text === "yes" : null,
      valueNumber: null,
      valueText: q.answerType === "boolean" ? null : text,
      rawValue: raw ?? null,
      // The patient's words sit on how they said they were, which is the slot
      // the doctor's view quotes.
      utterance: q.questionId === "symptom_change" ? utterance : null,
      utteranceOffsetSeconds: q.questionId === "symptom_change" ? 24 : null,
      extractedAt: finishedAt,
    };
  });
}

/**
 * What each seeded `flagged` day raises.
 *
 * The label and the sentence are the rule catalog's own words, and `severity`
 * is the answer that actually fires that rule — the queue's whole claim is that
 * the rule, the reason and the patient's words are one story. A `null` severity
 * is the unmappable case: CALL-E returned nothing for the slot, and that
 * nothing *is* the signal.
 */
const FLAG_SPECS = {
  /*
   * One row per call, shaped exactly as `completeCall` now writes it: the
   * model's reading is the headline, and whatever the floor caught is listed
   * on the same row rather than raised beside it.
   */
  red_flag_term_heard: {
    ruleId: "llm_triage",
    label: "Read by the assistant",
    urgent: true,
    severity: "severe" as string | null,
    reason:
      "She describes vomiting twice and being unable to keep water down, which is " +
      "one of the conditions you asked to be told about the same day.",
    summary:
      "Reported vomiting twice since yesterday and could not keep water down. She is " +
      "still taking the metformin. No other symptoms were raised." as string | null,
    floorHits: [] as { ruleId: string; label: string; urgent: boolean }[],
  },
  unmappable_response: {
    ruleId: "unmappable_response",
    label: "The call didn't find out what you asked",
    urgent: false,
    severity: "escalate" as string | null,
    reason:
      "She was reached, but the call could not find out what you asked, so nothing " +
      "about how she is doing can be relied on without a person asking her directly.",
    summary:
      'Said the pain was "about the same, more or less" and did not give a number. ' +
      "The rest of the call was clear." as string | null,
    floorHits: [
      { ruleId: "unmappable_response", label: "The call didn't find out what you asked", urgent: false },
    ],
  },
  moderate_symptoms: {
    ruleId: "llm_triage",
    label: "Read by the assistant",
    urgent: false,
    severity: "escalate" as string | null,
    reason:
      "She describes her symptoms as moderate and is more concerned than she was on " +
      "the last call, without describing anything urgent.",
    summary:
      "Symptoms moderate and slightly worse than yesterday. Taking the medication as " +
      "prescribed. Asked whether the dose could be reviewed." as string | null,
    floorHits: [] as { ruleId: string; label: string; urgent: boolean }[],
  },
} as const;

/**
 * An escalation a clinician already dealt with, for `--closed`.
 *
 * Acknowledged an hour after it was raised and resolved two hours later, with
 * the doctor's own record of what they did — a closed file with an open
 * escalation on it would be a contradiction the queue shows.
 */
function resolved(p: (typeof SEED_PATIENTS)[number], raisedAt: Date): Row {
  return {
    status: "resolved",
    acknowledgedAt: new Date(raisedAt.getTime() + 60 * 60 * 1000),
    resolvedAt: new Date(raisedAt.getTime() + 3 * 60 * 60 * 1000),
    resolvedBy: "Dr Rao",
    resolution: p.closed?.resolution ?? "contacted_patient",
    resolutionNote: p.closed?.resolutionNote ?? null,
  };
}

/**
 * The floor every seeded plan carries.
 *
 * Four rules, and no doctor authored any of them — which is the point. What a
 * call *meant* is the model's reading; this is only what must still reach a
 * person when no model is available.
 */
function rulesFor(): PlanRule[] {
  return [...lockedRules(), ...defaultRules()];
}

/** The CALL-E resultSchema, frozen onto the plan when it starts. The real builder. */
function resultSchemaFor(topics: TopicSpec[] = []): Record<string, unknown> {
  return buildResultSchema(topics);
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Built {
  patients: Row[];
  visits: Row[];
  notes: Row[];
  plans: Row[];
  questions: Row[];
  calls: Row[];
  slots: Row[];
  escalations: Row[];
  /**
   * The model's reading of every answered call, shaped as `completeCall`
   * writes it. Without these the doctor's view could not tell "no concerns
   * raised" from "nobody has read it yet", which is the distinction it exists
   * to draw.
   */
  triage: Row[];
  /** Prompts whose guard verdict was not the one the seed expected, either way. */
  guardSurprises: string[];
  overrides: string[];
}

/** Days of the window that already happened. The rest are still ahead. */
function elapsedDays(week: SeedDay[]): number {
  return week.filter((d) => d !== "scheduled" && d !== "none").length;
}

/**
 * Day `n` of the window as a real instant.
 *
 * Anchored so the last elapsed day sits half a day in the past and the first
 * future day sits half a day ahead — no occurrence lands exactly on `now`,
 * where a tick could claim it mid-demo before anyone has looked at the roster.
 */
/**
 * When occurrence `n` was, or will be, placed.
 *
 * This used to be `now + (n - elapsed - 0.5) days` — an offset from whenever the
 * seed happened to run — so the fixtures scheduled every call at the wall-clock
 * time of the seeding, whatever the plan said. A plan printing "Local time
 * 10:00 Europe/London" had calls landing at 18:49 London, which makes the one
 * claim the schedule panel exists to make demonstrably untrue in the demo data.
 *
 * It now does what `expandPlan` does: take the calendar day in the patient's
 * own zone, then resolve the plan's local time against that day. Same helper,
 * same DST handling, so the fixtures and the real path cannot disagree.
 */
function occurrenceAt(
  now: number,
  n: number,
  elapsed: number,
  timezone: string,
  localTime: string,
): Date {
  const dayOffset = n - elapsed - 1;
  const date = addDays(localDate(new Date(now), timezone), dayOffset);
  return zonedTimeToUtc(date, localTime, timezone);
}

function transcriptFor(firstName: string, utterance: string): StoredTurn[] {
  const attemptId = "seed-attempt";
  return [
    /* The configured practice and clinician, so a seeded transcript says what
       a real call from this deployment would. */
    {
      attemptId,
      offsetSeconds: 2,
      speaker: "bot",
      text: `Hello, this is an AI assistant calling from ${readConfig().practiceName} on behalf of ${readConfig().clinicianName}.`,
    },
    { attemptId, offsetSeconds: 9, speaker: "bot", text: `Am I speaking with ${firstName}?` },
    { attemptId, offsetSeconds: 14, speaker: "user", text: "Yes, speaking." },
    { attemptId, offsetSeconds: 18, speaker: "bot", text: "How have things been since your visit?" },
    { attemptId, offsetSeconds: 24, speaker: "user", text: utterance },
    { attemptId, offsetSeconds: 31, speaker: "bot", text: "Thank you. Someone from the care team will follow up if anything needs attention. Goodbye." },
  ];
}

function build(): Built {
  const now = Date.now();
  const out: Built = {
    patients: [],
    visits: [],
    notes: [],
    plans: [],
    questions: [],
    calls: [],
    slots: [],
    escalations: [],
    triage: [],
    guardSurprises: [],
    overrides: [],
  };

  /*
   * Patients with nothing hanging off them. `needs_plan` is derived from the
   * absent plan row, so this loop writes one row each and that is the state.
   */
  /* Closed history has no one waiting — only a patient who never turned up. */
  for (const p of CLOSED ? SEED_NO_SHOWS : SEED_UNPLANNED) {
    const patientId = newId("pat");
    out.patients.push({
      id: patientId,
      name: p.name,
      age: p.age,
      phoneE164: p.phone,
      timezone: p.timezone,
      language: p.language,
      aiCallConsent: p.consent,
      aiCallConsentAt: p.consent === "unknown" ? null : new Date(now - 8 * DAY_MS),
      aiCallConsentSource: p.consent === "unknown" ? null : "registration",
      createdAt: new Date(now - 1 * DAY_MS),
      updatedAt: new Date(now - 1 * DAY_MS),
    });
    /* Booked for today, in their own zone, and still waiting for the doctor —
       or, for closed history, a day that has passed and a patient who never came. */
    const daysAgo = CLOSED ? (p.daysAgo ?? 3) : 0;
    out.visits.push({
      id: newId("vis"),
      patientId,
      kind: p.visit.kind,
      visitDate: localDate(new Date(now - daysAgo * DAY_MS), p.timezone),
      reportedSymptoms: p.visit.reportedSymptoms,
      status: CLOSED ? "no_show" : "waiting",
      createdAt: new Date(now - (daysAgo + 1) * DAY_MS),
    });
  }

  for (const p of CLOSED ? [...SEED_PATIENTS, ...SEED_CLOSED_EXTRA] : SEED_PATIENTS) {
    // A real, armed number can replace the fiction one at seed time. It is read
    // from the environment and never written back to the repository.
    let phone = p.phone;
    // Not for closed history: nothing rings, so a real number has no reason to be stored.
    if (p.phoneOverrideEnv && !CLOSED) {
      const raw = process.env[p.phoneOverrideEnv];
      if (raw) {
        const normalized = normalizePhone(raw);
        if (normalized.ok) {
          phone = normalized.e164;
          out.overrides.push(`${p.name} ← ${p.phoneOverrideEnv}`);
        } else {
          console.warn(
            `  ${p.phoneOverrideEnv} is set but not usable (${normalized.reason}). ` +
              `Keeping the fiction number for ${p.name}.`,
          );
        }
      }
    }

    const patientId = newId("pat");
    const noteId = newId("note");
    const planId = newId("pln");
    const firstName = p.name.split(" ")[0];
    /* Closed: every day of the window happened, so a call still ahead becomes one that was answered. */
    const week: SeedDay[] = CLOSED ? p.week.map((d) => (d === "scheduled" ? "answered" : d)) : p.week;
    const elapsed = elapsedDays(week);
    /* A course is as long as its week — seven for the main cohort, shorter for some closed ones. */
    const days = week.length;

    out.patients.push({
      id: patientId,
      name: p.name,
      age: p.age,
      phoneE164: phone,
      timezone: p.timezone,
      language: p.language,
      aiCallConsent: p.consent,
      aiCallConsentAt: p.consent === "unknown" ? null : new Date(now - 8 * DAY_MS),
      aiCallConsentSource: p.consent === "unknown" ? null : "registration",
      createdAt: new Date(now - 9 * DAY_MS),
      updatedAt: new Date(now - 9 * DAY_MS),
    });

    /* Back today with something new: a waiting visit on the doctor's list,
       with this patient's earlier follow-up to read beside it. */
    /* Closed history: the consultation this course came from, seen and written up
       the day the note was — the way Save and start follow-up leaves a visit. */
    if (p.visit && CLOSED) {
      const seenAt = new Date(now - (elapsed + 1) * DAY_MS);
      out.visits.push({
        id: newId("vis"),
        patientId,
        kind: p.visit.kind,
        visitDate: localDate(seenAt, p.timezone),
        reportedSymptoms: p.visit.reportedSymptoms,
        status: "seen",
        noteId,
        seenAt,
        createdAt: new Date(seenAt.getTime() - 2 * 60 * 60 * 1000),
      });
    }

    if (p.visitToday && !CLOSED) {
      out.visits.push({
        id: newId("vis"),
        patientId,
        kind: p.visitToday.kind,
        visitDate: localDate(new Date(now), p.timezone),
        reportedSymptoms: p.visitToday.reportedSymptoms,
        status: "waiting",
        createdAt: new Date(now - 60 * 60 * 1000),
      });
    }

    out.notes.push({
      id: noteId,
      patientId,
      authorName: "Dr Rao",
      body: p.note,
      escalationNote: p.escalationNote ?? null,
      // Seeded plans were compiled before this build; recording a provider we
      // did not actually run would be the one dishonest field in the file.
      compileStatus: "compiled",
      compileProvider: null,
      compileModel: null,
      compileRaw: null,
      createdAt: new Date(now - (elapsed + 1) * DAY_MS),
    });

    /*
     * The treatment that came before this one.
     *
     * Seeded because the patient page can now show a history and an empty
     * history proves nothing. Both endings that are a *decision* are covered:
     * one plan the doctor finished, one replaced mid-course by a rewrite. The
     * plans that merely ran out of calendar are already everywhere else.
     */
    let priorPlanId: string | null = null;
    if (p.priorPlan) {
      const prior = p.priorPlan;
      priorPlanId = newId("pln");
      const priorNoteId = newId("note");
      const priorStart = new Date(now - prior.startedDaysAgo * DAY_MS);
      const priorClose = new Date(now - prior.closedDaysAgo * DAY_MS);
      /* The earlier course ran at the same hour as the current one. */
      const priorLocalTime = p.timezone === "Asia/Kolkata" ? "17:30" : "10:00";

      out.notes.push({
        id: priorNoteId,
        patientId,
        authorName: "Dr Rao",
        body: prior.note,
        compileStatus: "compiled",
        compileProvider: null,
        compileModel: null,
        compileRaw: null,
        createdAt: priorStart,
      });

      out.plans.push({
        id: priorPlanId,
        patientId,
        noteId: priorNoteId,
        version: 1,
        status: "completed",
        reason: prior.reason,
        condition: prior.condition,
        durationDays: 7,
        cadence: "daily",
        localTime: priorLocalTime,
        timeScale: 1,
        maxAttempts: 3,
        retryDelayMinutes: 120,
        startsAt: priorStart,
        endsAt: new Date(priorStart.getTime() + 7 * DAY_MS),
        approvedAt: priorStart,
        approvedBy: "Dr Rao",
        closedAt: priorClose,
        closeReason: prior.closeReason,
        closedBy: "Dr Rao",
        rules: rulesFor(),
        redFlagTerms: redFlagsFor(prior.condition).map((term) => ({
          term,
          source: "default" as const,
        })),
        provenance: {
          cadence: "note",
          durationDays: "note",
          localTime: "default",
          maxAttempts: "default",
          retryDelayMinutes: "default",
        },
        resultSchema: resultSchemaFor(),
        createdAt: priorStart,
        updatedAt: priorClose,
      });

      QUESTIONS.forEach((q, i) => {
        const verdict = inspectQuestion(q.prompt);
        out.questions.push({
          id: newId("q"),
          planId: priorPlanId as string,
          questionId: q.questionId,
          ordinal: i + 1,
          prompt: q.prompt,
          answerType: q.answerType,
          enumValues: q.enumValues ?? null,
          required: true,
          source: q.source,
          guardStatus: verdict.ok ? "approved" : "rejected",
          guardFindings: verdict.ok ? null : verdict.findings,
        });
      });

      const priorSaid = DEMO_UTTERANCES[prior.condition] ?? ["Yes, all fine."];
      for (let n = 1; n <= prior.answered; n++) {
        const callId = newId("sc");
        /* Prior courses honour the same local time, for the same reason. */
        const at = zonedTimeToUtc(
          addDays(localDate(priorStart, p.timezone), n - 1),
          priorLocalTime,
          p.timezone,
        );
        const utterance = priorSaid[(n - 1) % priorSaid.length];
        /* A course from before goal-based calls: no topics on it. */
        const structured = callResult({
          utterance,
          change: n === 1 ? "same" : "better",
          concern: "not_concerned",
          goalCovered: "all",
        });
        const finishedAt = new Date(at.getTime() + 4 * 60 * 1000);

        out.calls.push({
          id: callId,
          planId: priorPlanId,
          patientId,
          occurrence: n,
          attempt: 1,
          idempotencyKey: idempotencyKey(priorPlanId, n, 1),
          scheduledFor: at,
          status: "completed",
          dialedAt: at,
          calleStatus: "completed",
          resultStatus: "present",
          structuredResult: structured,
          summary: `Follow-up call ${n} of 7. Patient reached.`,
          taskCompleted: true,
          completionConfidence: { score: 0.94, label: "high" },
          evidence: [utterance],
          transcript: transcriptFor(firstName, utterance),
          outcome: "answered",
          finishedAt,
        });

        out.slots.push(...slotRows(callId, patientId, structured, utterance, finishedAt));
      }
    }

    /* One value for the plan and every call it schedules, so the panel that
       prints "Local time 10:00" and the rows that actually fire cannot say
       different things. */
    const planLocalTime = p.timezone === "Asia/Kolkata" ? "17:30" : "10:00";
    const startsAt = occurrenceAt(now, 1, elapsed, p.timezone, planLocalTime);
    const endsAt = occurrenceAt(now, days, elapsed, p.timezone, planLocalTime);
    const redFlagTerms: RedFlagTerm[] = redFlagsFor(p.condition).map((term) => ({
      term,
      source: "default",
    }));

    const planRow: Row = {
      id: planId,
      patientId,
      noteId,
      version: p.priorPlan?.closeReason === "superseded" ? 2 : 1,
      supersedesPlanId: p.priorPlan?.closeReason === "superseded" ? priorPlanId : null,
      status: CLOSED ? "completed" : p.planStatus,
      reason: p.reason,
      condition: p.condition,
      goal: p.goal,
      durationDays: days,
      cadence: "daily",
      localTime: planLocalTime,
      timeScale: 1,
      maxAttempts: 3,
      retryDelayMinutes: 120,
      startsAt,
      endsAt,
      approvedAt: new Date(now - (elapsed + 1) * DAY_MS),
      approvedBy: "Dr Rao",
      /* A completed current plan ran out of calendar and nobody closed the
         file — the doctor's "Finished" band, with no closing note yet. */
      closeReason: CLOSED ? "clinician_closed" : p.planStatus === "completed" ? "duration_elapsed" : null,
      closedAt: CLOSED
        ? new Date(endsAt.getTime() + 3 * 60 * 60 * 1000)
        : p.planStatus === "completed"
          ? endsAt
          : null,
      /* Closed by the doctor, in their words — what takes a patient off the "Finished" band. */
      ...(CLOSED ? { closingSummary: p.closed?.summary ?? "Follow-up complete." } : {}),
      rules: rulesFor(),
      redFlagTerms,
      provenance: {
        // Every seeded reason and goal is written from its note.
        reason: "note",
        goal: "note",
        cadence: "note",
        durationDays: "note",
        localTime: p.scheduleQuotes?.localTime ? "note" : "default",
        maxAttempts: "default",
        retryDelayMinutes: "default",
      },
      resultSchema: resultSchemaFor(p.watchPoints),
      scheduleQuotes: p.scheduleQuotes ?? null,
      watchPoints: p.watchPoints,
      createdAt: new Date(now - (elapsed + 1) * DAY_MS),
      updatedAt: new Date(now - (elapsed + 1) * DAY_MS),
    };
    out.plans.push(planRow);

    QUESTIONS.forEach((q, i) => {
      // The real guard, on the real prompt. Not a stored assumption.
      const verdict = inspectQuestion(q.prompt);
      if (!verdict.ok) {
        out.guardSurprises.push(`${q.questionId}: ${verdict.findings.map((f) => f.category).join(", ")}`);
      }
      out.questions.push({
        id: newId("q"),
        planId,
        questionId: q.questionId,
        ordinal: i + 1,
        prompt: q.prompt,
        answerType: q.answerType,
        enumValues: q.enumValues ?? null,
        required: true,
        source: q.source,
        guardStatus: verdict.ok ? "approved" : "rejected",
        guardFindings: verdict.ok ? null : verdict.findings,
      });
    });

    const utterances = DEMO_UTTERANCES[p.condition] ?? ["Yes, all fine."];
    let reachedCount = 0;
    /* The last call triage read, for the plan's condition summary. A holder
       object, not a `let`, so the assignment inside the loop survives narrowing. */
    const last: { reached: { summary: string | null; at: Date; callId: string } | null } = {
      reached: null,
    };
    const lastReachedIndex = week.reduce(
      (acc, d, i) => (d === "answered" || d === "flagged" ? i : acc),
      -1,
    );

    week.forEach((day, index) => {
      const occurrence = index + 1;
      const at = occurrenceAt(now, occurrence, elapsed, p.timezone, planLocalTime);

      if (day === "none") return;

      if (day === "scheduled") {
        out.calls.push({
          id: newId("sc"),
          planId,
          patientId,
          occurrence,
          attempt: 1,
          idempotencyKey: idempotencyKey(planId, occurrence, 1),
          scheduledFor: at,
          status: "scheduled",
          resultStatus: "pending",
        });
        return;
      }

      if (day === "held") {
        out.calls.push({
          id: newId("sc"),
          planId,
          patientId,
          occurrence,
          attempt: 1,
          idempotencyKey: idempotencyKey(planId, occurrence, 1),
          scheduledFor: at,
          status: "skipped",
          skipReason: "plan_paused",
          resultStatus: "pending",
        });
        return;
      }

      if (day === "missed") {
        // Three attempts, each a real failed dial carrying CALL-E's own code.
        for (let attempt = 1; attempt <= 3; attempt++) {
          const dialedAt = new Date(at.getTime() + (attempt - 1) * 2 * 60 * 60 * 1000);
          out.calls.push({
            id: newId("sc"),
            planId,
            patientId,
            occurrence,
            attempt,
            idempotencyKey: idempotencyKey(planId, occurrence, attempt),
            scheduledFor: dialedAt,
            status: "failed",
            dialedAt,
            calleStatus: "failed",
            /* A SIP decline, not the tidy string this codebase used to look
               for. The real one was "603"; nothing may branch on it. */
            calleFailureCode: "603",
            calleFailureMessage: "The call was not answered.",
            resultStatus: "null_result",
            outcome: "no_answer",
            finishedAt: new Date(dialedAt.getTime() + 90 * 1000),
          });
        }
        return;
      }

      // answered | flagged — the patient was reached and spoke.
      const callId = newId("sc");
      const triageId = newId("tri");
      const flagged = day === "flagged";
      const utterance = flagged
        ? (utterances.at(-1) ?? "Something is wrong.")
        : (utterances[reachedCount % Math.max(1, utterances.length - (p.condition === "new_metformin" ? 1 : 0))] ??
           "Yes, all fine.");
      reachedCount += 1;

      const spec = FLAG_SPECS[p.flagRule ?? "red_flag_term_heard"];
      /*
       * An unmappable answer is not a severity. CALL-E returns null for the
       * slot it could not map, and that null *is* the escalation signal — so
       * the seeded row has to carry the null rather than a stand-in value,
       * or the queue would show a rule that its own evidence contradicts.
       */
      /* The floor's own hit is what says this call had an unmappable answer —
         the severity is the model's, and the two are different facts. */
      const unmappable =
        flagged && spec.floorHits.some((h) => h.ruleId === "unmappable_response");
      const structured = callResult({
        utterance,
        change: flagged && !unmappable ? "worse" : reachedCount === 1 ? "same" : "better",
        concern: flagged ? (unmappable ? "mildly" : spec.urgent ? "very" : "mildly") : "not_concerned",
        /* The floor's goal-level reading: an unmappable day found out nothing. */
        goalCovered: unmappable ? "none" : "all",
        topicAnswers: p.topicAnswers,
        utteranceTopic: p.utteranceTopic,
        units: p.watchPoints.map((w) => w.unit),
        measured: p.measured
          ? { topic: p.measured.topic, value: p.measured.values[(reachedCount - 1) % p.measured.values.length] }
          : undefined,
      });

      const finishedAt = new Date(at.getTime() + 4 * 60 * 1000);
      out.calls.push({
        id: callId,
        planId,
        patientId,
        occurrence,
        attempt: 1,
        idempotencyKey: idempotencyKey(planId, occurrence, 1),
        scheduledFor: at,
        status: "completed",
        dialedAt: at,
        calleStatus: "completed",
        resultStatus: "present",
        structuredResult: structured,
        summary: `Follow-up call ${occurrence} of ${days}. Patient reached.`,
        taskCompleted: true,
        completionConfidence: { score: 0.94, label: "high" },
        evidence: [utterance],
        transcript: transcriptFor(firstName, utterance),
        outcome: flagged ? "flagged" : "answered",
        finishedAt,
      });

      /*
       * The model's reading of this call, as `completeCall` would have stored
       * it. A flagged day carries the verdict its escalation shows; an answered
       * one reads low. The last answered call of a patient with a written
       * condition summary carries that summary, because it is what the
       * doctor's view reads as how they are doing.
       */
      const triageSummary = flagged
        ? spec.summary
        : index === lastReachedIndex && p.conditionSummary
          ? p.conditionSummary
          : `Reached and answered every question. In their words: "${utterance}"`;
      out.triage.push({
        id: triageId,
        callId,
        patientId,
        planId,
        status: "ok",
        verdict: flagged ? (spec.severity === "severe" ? "severe" : "escalate") : "low",
        reason: flagged
          ? spec.reason
          : "Nothing in the call matched a condition you asked to hear about.",
        summary: triageSummary,
        keyTerms: [],
        matchedConcerns: [],
        quote: utterance,
        provider: null,
        model: null,
        raw: null,
        error: null,
        createdAt: finishedAt,
      });
      last.reached = { summary: triageSummary, at: finishedAt, callId };

      out.slots.push(...slotRows(callId, patientId, structured, utterance, finishedAt));

      if (flagged) {
        out.escalations.push({
          id: newId("esc"),
          patientId,
          planId,
          callId,
          ruleId: spec.ruleId,
          ruleLabel: spec.label,
          urgent: spec.urgent,
          reason: spec.reason,
          severity: spec.severity,
          summary: spec.summary,
          floorHits: spec.floorHits.length > 0 ? [...spec.floorHits] : null,
          utterance,
          /* One row per call, matching what `completeCall` writes. */
          triageId,
          dedupeKey: `${planId}:call:${callId}`,
          ...(CLOSED ? resolved(p, finishedAt) : { status: "open" }),
          // Only an urgent escalation stops a plan, and only the plan it
          // actually stopped may claim it did.
          pausedPlan: spec.urgent && p.planStatus === "paused",
          raisedAt: finishedAt,
        });
      }
    });

    /* How they are doing, as the tick keeps it: the last reading's summary. */
    if (last.reached) {
      planRow.conditionSummary = last.reached.summary;
      planRow.conditionSummaryAt = last.reached.at;
      planRow.conditionSummaryCallId = last.reached.callId;
    }

    // A patient who has gone quiet across three exhausted occurrences gets one
    // routine escalation, attached to the last attempt that failed.
    const missedDays = week.filter((d) => d === "missed").length;
    if (missedDays >= 3) {
      const lastMissed = [...out.calls].reverse().find(
        (c) => c.planId === planId && c.outcome === "no_answer",
      );
      /* Closed: raised when the third quiet day ended, not "just now" — the week after it happened too. */
      const raisedAt =
        CLOSED && lastMissed
          ? new Date((lastMissed.finishedAt as Date).getTime() + 2 * 60 * 60 * 1000)
          : new Date(now - 0.4 * DAY_MS);
      out.escalations.push({
        id: newId("esc"),
        patientId,
        planId,
        callId: lastMissed?.id ?? null,
        ruleId: "no_answer_exhausted",
        ruleLabel: "Every attempt went unanswered",
        urgent: false,
        severity: "escalate" as string | null,
        summary:
          "Three attempts and nobody spoke on any of them. There is no transcript to " +
          "read, which is itself the finding." as string | null,
        floorHits: [
          {
            ruleId: "no_answer_exhausted",
            label: "Every attempt went unanswered",
            urgent: false,
          },
        ] as { ruleId: string; label: string; urgent: boolean }[] | null,
        reason:
          "Attempts 1, 2 and 3 all went unanswered. Nobody " +
          `has heard from this patient in ${missedDays} days.`,
        utterance: null,
        dedupeKey: `${planId}:no_answer_exhausted:${lastMissed?.id ?? "none"}`,
        ...(CLOSED ? resolved(p, raisedAt) : { status: "open" }),
        pausedPlan: false,
        raisedAt,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Remove only what the seed created.
 *
 * Matched on the US fiction-reserved 555-01xx range — `+1 xxx 555 01xx` — which
 * is the one thing every seeded patient has and no real patient ever can. A
 * blanket delete would take a clinician's own records with it.
 */
async function clearSeeded(): Promise<number> {
  const rows = (
    await db.execute(
      /* Closed seeding leaves archived patients alone: their history was kept on purpose. */
      /* Closed seeding clears exactly the numbers it writes and never an archived
         record, so a patient booked by hand is untouched even on a fiction number. */
      CLOSED
        ? sqlRaw`select id from patients where archived_at is null
                 and phone_e164 in (${sqlRaw.join(CLOSED_PHONES.map((ph) => sqlRaw`${ph}`), sqlRaw`, `)})`
        : sqlRaw`select id from patients where phone_e164 like '+1%55501__'`,
    )
  ).rows as { id: string }[];

  for (const { id } of rows) {
    // Children first: every foreign key to `patients` is `restrict`, so a bare
    // delete fails once a seeded patient has plans and calls hanging off them.
    await db.execute(sqlRaw`delete from extracted_slots where patient_id = ${id}`);
    await db.execute(sqlRaw`delete from escalations where patient_id = ${id}`);
    await db.execute(sqlRaw`delete from scheduled_calls where patient_id = ${id}`);
    await db.execute(
      sqlRaw`delete from plan_questions where plan_id in (select id from follow_up_plans where patient_id = ${id})`,
    );
    await db.execute(sqlRaw`delete from follow_up_plans where patient_id = ${id}`);
    await db.execute(sqlRaw`delete from visits where patient_id = ${id}`);
    await db.execute(sqlRaw`delete from consultation_notes where patient_id = ${id}`);
    await db.execute(sqlRaw`delete from patients where id = ${id}`);
  }
  return rows.length;
}

async function main() {
  // `--clear` removes the demo cohort and stops, leaving real records alone.
  if (process.argv.includes("--clear")) {
    const removed = await clearSeeded();
    console.log(`\n  Removed ${removed} seeded patient(s) and everything hanging off them.`);
    console.log("  Patients added through the console were not touched.\n");
    return;
  }

  const built = build();

  if (built.guardSurprises.length) {
    console.error("\n  Guard phase 1 did not say what the seed expected. Seeding anyway:");
    for (const r of built.guardSurprises) console.error(`    ✗ ${r}`);
    console.error("");
  }

  // Foreign-key order. Every FK to patients and plans is `restrict`, so a stray
  // delete errors rather than silently erasing call history — clearing the demo
  // means saying so explicitly, child rows first.
  console.log("  Clearing previously seeded rows…");
  await clearSeeded();

  console.log("  Inserting…");
  await db.insert(schema.patients).values(built.patients as never);
  // Notes before visits: a seen visit points at the note it was written up in.
  // Empty inserts are skipped, because drizzle refuses them.
  if (built.notes.length) await db.insert(schema.consultationNotes).values(built.notes as never);
  if (built.visits.length) await db.insert(schema.visits).values(built.visits as never);
  if (built.plans.length) await db.insert(schema.followUpPlans).values(built.plans as never);
  if (built.questions.length) await db.insert(schema.planQuestions).values(built.questions as never);
  // Chunked: the HTTP driver has a statement size ceiling and the transcript
  // column is not small.
  for (let i = 0; i < built.calls.length; i += 40) {
    await db.insert(schema.scheduledCalls).values(built.calls.slice(i, i + 40) as never);
  }
  // After the calls they read, before the escalations that point at them.
  for (let i = 0; i < built.triage.length; i += 40) {
    await db.insert(schema.callTriage).values(built.triage.slice(i, i + 40) as never);
  }
  for (let i = 0; i < built.slots.length; i += 100) {
    await db.insert(schema.extractedSlots).values(built.slots.slice(i, i + 100) as never);
  }
  if (built.escalations.length) await db.insert(schema.escalations).values(built.escalations as never);

  console.log("");
  console.log(`  patients            ${built.patients.length}`);
  console.log(`  visits              ${built.visits.length}`);
  console.log(`  consultation_notes  ${built.notes.length}`);
  console.log(`  follow_up_plans     ${built.plans.length}`);
  console.log(`  plan_questions      ${built.questions.length}`);
  console.log(`  scheduled_calls     ${built.calls.length}`);
  console.log(`  extracted_slots     ${built.slots.length}`);
  console.log(`  escalations         ${built.escalations.length}`);
  console.log(`  call_triage         ${built.triage.length}`);
  if (built.overrides.length) {
    console.log("");
    console.log("  Phone numbers taken from the environment:");
    for (const o of built.overrides) console.log(`    ${o}`);
  }
  console.log("");
  console.log("  Seeded. Every patient is fictional; every committed number is 555-01xx.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
