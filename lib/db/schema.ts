/**
 * The Care Loop schema.
 *
 * Three properties of the environment shape almost every decision below, so
 * they are worth stating once at the top:
 *
 *   1. **There are no transactions.** The Neon HTTP driver gives one implicit
 *      transaction per statement. So every mutation that could race is a single
 *      conditional `UPDATE … RETURNING`, and every derived write is idempotent
 *      behind a UNIQUE index. The indexes in this file are not hygiene; they are
 *      the concurrency control.
 *   2. **No endpoint lists CALL-E calls.** A `call_id` we fail to persist is a
 *      result we can never read back. So a row is written before we dial, and
 *      `calleCallId` is stored the instant `create()` returns.
 *   3. **There is no scheduling API.** Care Loop owns the calendar, which is why
 *      `scheduled_calls` exists at all.
 *
 * Enums are `text` + CHECK rather than `pgEnum` — see `lib/db/enums.ts` for why.
 */

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { GuardFinding } from "@/lib/script/guard";
import type { PlanRule, RedFlagTerm } from "@/lib/rules/types";
import type {
  AnswerType,
  Cadence,
  CalleStatus,
  CallOutcome,
  CallStatus,
  CloseReason,
  CompileProvider,
  CompileStatus,
  ConsentSource,
  ConsentState,
  EscalationStatus,
  GuardStatus,
  PlanStatus,
  Provenance,
  Resolution,
  ResultStatus,
  SkipReason,
  SlotStatus,
  TickTrigger,
  TriageStatus,
  TriageVerdict,
  VisitKind,
  VisitStatus,
} from "@/lib/db/enums";
import {
  ANSWER_TYPES,
  CADENCES,
  CALLE_STATUSES,
  CALL_OUTCOMES,
  CALL_STATUSES,
  CLOSE_REASONS,
  COMPILE_PROVIDERS,
  COMPILE_STATUSES,
  CONSENT_SOURCES,
  CONSENT_STATES,
  ESCALATION_STATUSES,
  GUARD_STATUSES,
  PLAN_STATUSES,
  RESOLUTIONS,
  RESULT_STATUSES,
  SKIP_REASONS,
  SLOT_STATUSES,
  TICK_TRIGGERS,
  TRIAGE_STATUSES,
  TRIAGE_VERDICTS,
  VISIT_KINDS,
  VISIT_STATUSES,
} from "@/lib/db/enums";

/** `col in ('a','b')`, or `col is null or col in (…)` for a nullable column. */
function oneOf(column: string, values: readonly string[], nullable = false) {
  const list = values.map((v) => `'${v}'`).join(", ");
  return nullable
    ? sql.raw(`"${column}" is null or "${column}" in (${list})`)
    : sql.raw(`"${column}" in (${list})`);
}

/** Every timestamp in this schema. Never a bare `timestamp` — the DST argument dies without the zone. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** One turn of a call, flattened across CALL-E's inner attempts but still attributable to one. */
export interface StoredTurn {
  attemptId: string;
  offsetSeconds: number;
  speaker: string;
  text: string;
}

export interface StoredConfidence {
  score: number;
  label: string;
}

// ---------------------------------------------------------------------------
// patients
// ---------------------------------------------------------------------------

export const patients = pgTable(
  "patients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * Age, not date of birth. AGENTS.md rule 8 forbids committing a real name
     * paired with a DOB, and the console only ever renders age — storing a DOB
     * would manufacture precisely the artifact the rule bans.
     */
    age: smallint("age").notNull(),
    /** Written only after `normalizePhone()` returns E.164. The CHECK is the second gate. */
    phoneE164: text("phone_e164").notNull(),
    /**
     * IANA zone. NOT NULL and deliberately **without a default**: a
     * `default 'UTC'` is the precise mechanism by which a plan's "10:00"
     * silently becomes the server's 10:00 and drifts across DST.
     */
    timezone: text("timezone").notNull(),
    /**
     * BCP 47 tag for the language the call is conducted in. Unlike `timezone`
     * this one *does* carry a default: existing rows need a backfill value, and
     * a call in the wrong language is recoverable in a way a call at the wrong
     * hour is not — the patient just answers in English.
     */
    language: text("language").notNull().default("en-US"),
    /** Ternary on purpose — "never asked" must not behave like "refused". */
    aiCallConsent: text("ai_call_consent").$type<ConsentState>().notNull().default("unknown"),
    aiCallConsentAt: ts("ai_call_consent_at"),
    /** The first-call gate writes `call` back here, so the second call does not re-ask. */
    aiCallConsentSource: text("ai_call_consent_source").$type<ConsentSource>(),
    /** Soft delete. Its presence in the claim query is what stops the dialer instantly. */
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("patients_phone_e164", sql.raw(`"phone_e164" ~ '^\\+[1-9][0-9]{6,14}$'`)),
    check("patients_age", sql`${t.age} >= 0 and ${t.age} < 130`),
    check("patients_consent", oneOf("ai_call_consent", CONSENT_STATES)),
    check("patients_consent_source", oneOf("ai_call_consent_source", CONSENT_SOURCES, true)),
    /** The roster's default filter. Partial, so it stays small as history grows. */
    index("idx_patients_active").on(t.archivedAt).where(sql`${t.archivedAt} is null`),
    /**
     * A double-submitted "add patient" form creates two patients on one number,
     * and then two plans phone the same human twice. This is the cheapest
     * possible defence and it is a patient-safety property, not hygiene.
     */
    uniqueIndex("uniq_patients_phone")
      .on(t.phoneE164)
      .where(sql`${t.archivedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// consultation_notes
// ---------------------------------------------------------------------------

/**
 * The doctor's free text, and the model's unmodified answer to it.
 *
 * Not folded onto the plan, for three reasons that each bite:
 *   - `assertGrounded()` must refuse any medication or red-flag term absent from
 *     the note at *dial* time, not only at compile time, because the plan can be
 *     edited in between. The grounding source has to outlive compilation.
 *   - Provenance is derived, never declared. Diffing `compileRaw` (with its
 *     nulls intact) against the finished plan is what makes every "Defaulted"
 *     mark in the review UI checkable rather than a claim.
 *   - One note may produce several plan versions. Denormalising it onto each
 *     would let two copies of the grounding source drift apart.
 */
export const consultationNotes = pgTable(
  "consultation_notes",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    /** There is no auth. The author is a column with a default, not a session. */
    authorName: text("author_name").notNull().default("Dr Rao"),
    body: text("body").notNull(),
    /**
     * What the doctor said to watch out for, in their own words.
     *
     * Kept verbatim and separate from the note because it is handed to the
     * triage model at call time as the doctor's own reference standard. It is
     * also grounded against alongside `body`, so a term written only here is
     * still a term the compiler is allowed to use.
     */
    escalationNote: text("escalation_note"),
    /** Set when a doctor adds to the note and it is re-parsed. */
    amendedAt: ts("amended_at"),
    compileStatus: text("compile_status").$type<CompileStatus>().notNull().default("pending"),
    /** Which model actually ran. Without this, "compiled by gpt-4.1-mini" is unverifiable. */
    compileProvider: text("compile_provider").$type<CompileProvider>(),
    compileModel: text("compile_model"),
    /** The model's output verbatim, nulls and all. The evidence that code applied the defaults. */
    compileRaw: jsonb("compile_raw"),
    /** Printed to the clinician, never swallowed. */
    compileError: text("compile_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("notes_compile_status", oneOf("compile_status", COMPILE_STATUSES)),
    check("notes_compile_provider", oneOf("compile_provider", COMPILE_PROVIDERS, true)),
    index("idx_notes_patient").on(t.patientId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// visits
// ---------------------------------------------------------------------------

/**
 * What the front desk booked.
 *
 * Registration and consultation are two roles on two screens, and this row is
 * the hand-off between them: the desk writes it ahead of time, the doctor's
 * list is every row still `waiting`, and writing the note flips it to `seen`
 * in the same statement that sets `note_id`.
 */
export const visits = pgTable(
  "visits",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    kind: text("kind").$type<VisitKind>().notNull(),
    /**
     * A calendar day, not an instant. The desk books a day and nobody enters a
     * wall-clock time; a `timestamptz` here would invite exactly the
     * server-zone comparison `patients.timezone` exists to prevent.
     */
    visitDate: date("visit_date", { mode: "string" }).notNull(),
    /**
     * The complaint, in the receptionist's words. Context for the doctor and
     * **never a grounding source**: the compiler is grounded against the note
     * alone, at compile time and again before dialling, so a medication named
     * only here would be refused the moment a call was due.
     */
    reportedSymptoms: text("reported_symptoms").notNull(),
    status: text("status").$type<VisitStatus>().notNull().default("waiting"),
    /** Set by the same conditional UPDATE that marks the visit `seen`. */
    noteId: text("note_id").references(() => consultationNotes.id, { onDelete: "restrict" }),
    seenAt: ts("seen_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("visits_kind", oneOf("kind", VISIT_KINDS)),
    check("visits_status", oneOf("status", VISIT_STATUSES)),
    // The consult list's only scan.
    index("idx_visits_waiting")
      .on(t.visitDate, t.createdAt)
      .where(sql`${t.status} = 'waiting'`),
  ],
);

// ---------------------------------------------------------------------------
// follow_up_plans
// ---------------------------------------------------------------------------

export const followUpPlans = pgTable(
  "follow_up_plans",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    noteId: text("note_id")
      .notNull()
      .references(() => consultationNotes.id, { onDelete: "restrict" }),
    /** The v2 editing UI is cut for the demo; the columns stay so cutting it is reversible. */
    version: integer("version").notNull().default(1),
    supersedesPlanId: text("supersedes_plan_id"),

    status: text("status").$type<PlanStatus>().notNull().default("awaiting_approval"),
    /** The roster subtitle: "New metformin · tolerance and adherence". */
    reason: text("reason").notNull(),
    /** Keys the global red-flag list per condition. */
    condition: text("condition"),

    /** A clinical interval, calendar-anchored from approval — not a quota of contacts. */
    durationDays: integer("duration_days").notNull().default(7),
    cadence: text("cadence").$type<Cadence>().notNull().default("daily"),
    /**
     * `HH:MM`, interpreted in the patient's timezone. Deliberately `text` and not
     * `time`: a real `time` column invites a comparison against `now()::time` in
     * server time, which is the exact bug the NOT NULL timezone exists to prevent.
     */
    localTime: text("local_time").notNull().default("10:00"),
    /**
     * 1 = real time, 1440 = one clinical day per minute. Applied **once**, in
     * `expand.ts`. Everything downstream sees real timestamps and is unaware of it,
     * so the mechanism under demo is byte-identical to production.
     */
    timeScale: integer("time_scale").notNull().default(1),

    /** The retry ladder, on the plan so a clinician can see why a retry happened when it did. */
    maxAttempts: integer("max_attempts").notNull().default(3),
    retryDelayMinutes: integer("retry_delay_minutes").notNull().default(120),

    startsAt: ts("starts_at"),
    /** New occurrences may not pass this. Retries may. */
    endsAt: ts("ends_at"),
    approvedAt: ts("approved_at"),
    approvedBy: text("approved_by"),

    /**
     * The closed rule DSL, as jsonb rather than a table.
     *
     * The pure evaluator consumes the whole set at once and nothing queries
     * across individual rules. A row-per-rule table would invite someone to join
     * it into a decision path, which is precisely the impurity that makes the
     * evaluator's floor uncheckable. The three locked rules
     * are re-asserted here by code at approval, so a malformed edit cannot drop them.
     */
    rules: jsonb("rules").$type<PlanRule[]>().notNull().default(sql`'[]'::jsonb`),
    redFlagTerms: jsonb("red_flag_terms")
      .$type<RedFlagTerm[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Field name → where its value came from. One map, not a `_source` column per
     * field: the review UI reads the whole thing at once by name, and doubling the
     * table's width to store it columnwise buys nothing.
     */
    provenance: jsonb("provenance")
      .$type<Record<string, Provenance>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * The exact CALL-E resultSchema, frozen at approval. Without it a superseded
     * plan's older calls become uninterpretable — you cannot map yesterday's
     * structuredResult with today's question set.
     */
    resultSchema: jsonb("result_schema").notNull().default(sql`'{}'::jsonb`),
    /**
     * The note's own words behind each schedule field the compiler took from
     * it — `{cadence, durationDays, localTime, unsupportedCadence}`. A value is
     * only marked "From note" when its quote is found in the note by code, so
     * the review screen can print the words rather than ask to be trusted.
     */
    scheduleQuotes: jsonb("schedule_quotes"),
    /**
     * What the note asks to be watched, `[{text, quote}]`, as the compiler read
     * it. Kept on the plan rather than only on questions, so a watch-point no
     * question covers is still visible to the doctor as a gap.
     */
    watchPoints: jsonb("watch_points"),

    pausedAt: ts("paused_at"),
    pausedReason: text("paused_reason"),
    /** Makes "which escalation do I resolve to resume this?" a lookup, not a guess. */
    pausedByEscalationId: text("paused_by_escalation_id"),
    resumedAt: ts("resumed_at"),
    resumedBy: text("resumed_by"),

    closedAt: ts("closed_at"),
    closeReason: text("close_reason").$type<CloseReason>(),
    /**
     * What the clinician wrote when they ended this episode.
     *
     * The one thing a patient's history needs that nothing else records: the
     * calls say what was asked and answered, `close_reason` says the episode
     * ended, and neither says how it resolved. Nullable because the other three
     * close reasons are not a clinician sitting down to write.
     */
    closingSummary: text("closing_summary"),
    /**
     * How the patient is doing, as of the last call triage could read.
     *
     * Written from `call_triage.summary` only when triage succeeded — a
     * fail-closed reading never overwrites the last good one, so an outage
     * leaves the doctor with yesterday's words and a note that today's call
     * needs reading, rather than with nothing.
     */
    conditionSummary: text("condition_summary"),
    conditionSummaryAt: ts("condition_summary_at"),
    conditionSummaryCallId: text("condition_summary_call_id"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("plans_status", oneOf("status", PLAN_STATUSES)),
    check("plans_cadence", oneOf("cadence", CADENCES)),
    check("plans_close_reason", oneOf("close_reason", CLOSE_REASONS, true)),
    check("plans_duration", sql`${t.durationDays} > 0`),
    check("plans_time_scale", sql`${t.timeScale} > 0`),
    check("plans_max_attempts", sql`${t.maxAttempts} > 0`),
    check("plans_local_time", sql.raw(`"local_time" ~ '^[0-2][0-9]:[0-5][0-9]$'`)),
    /**
     * One live plan per patient. The race is a double-clicked Approve, or two
     * tabs approving two drafts: two active plans means two independent
     * schedulers dialling the same patient on the same day. The second approval
     * fails loudly instead.
     */
    uniqueIndex("uniq_live_plan_per_patient")
      .on(t.patientId)
      .where(sql`${t.status} in ('active', 'paused')`),
    /** The duration-elapsed sweep, run on every tick. */
    index("idx_plans_due_close")
      .on(t.endsAt)
      .where(sql`${t.status} = 'active'`),
    index("idx_plans_patient").on(t.patientId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// plan_questions
// ---------------------------------------------------------------------------

/**
 * One row per question. Not a jsonb array on the plan, for three reasons:
 *
 *   1. `questionId` is half of `unique(call_id, question_id)` on the slots. A
 *      slug living only inside a jsonb array has no canonical spelling and no
 *      uniqueness guarantee — one typo and idempotent extraction stops working
 *      silently.
 *   2. **The guard's phase-1 verdict must be persisted.** `port.dial()` takes
 *      `approvedQuestions` as its phase-2 exemption set. If that set were
 *      recomputed at dial time by different code than approved it at compile
 *      time, the laundering hole documented in `lib/script/guard.ts` reopens. It
 *      must be *read*, not recalculated.
 *   3. The review UI edits questions one at a time, and each edit re-runs phase 1.
 */
export const planQuestions = pgTable(
  "plan_questions",
  {
    id: text("id").primaryKey(),
    /** Cascade is safe here: a question has no meaning without its plan, and nothing FKs to it. */
    planId: text("plan_id")
      .notNull()
      .references(() => followUpPlans.id, { onDelete: "cascade" }),
    /** The stable slug: the CALL-E resultSchema key and the slot's question_id. */
    questionId: text("question_id").notNull(),
    /**
     * Sparse, not sequential. Fractional so a reorder is one single-row UPDATE
     * to a midpoint between neighbours: a permutation UPDATE is unsafe under
     * the non-deferrable `uniq_q_ordinal`, and there are no transactions on the
     * Neon HTTP driver to make one atomic.
     */
    ordinal: doublePrecision("ordinal").notNull(),
    /** When a compile last mentioned this question. Older than `notes.amended_at`
        means the newest note no longer covers it — shown, never auto-deleted. */
    lastCompileAt: ts("last_compile_at"),
    /**
     * When this question joined a plan that was already running.
     *
     * Null for everything the plan was approved with. Set only by an
     * append-only merge, so a doctor reading a call from day 2 can tell which
     * questions did not exist yet when it was placed.
     */
    addedAt: ts("added_at"),
    /** The exact text spoken. This string, verbatim, is what guard phase 2 masks by location. */
    prompt: text("prompt").notNull(),
    /**
     * The words in the note this question serves, quoted by the compiler and
     * checked against the note by code. Null for universal and clinician-added
     * questions — those answer to a person, not to a passage.
     */
    anchorQuote: text("anchor_quote"),
    /** The doctor's watch-point this question covers, in the compiler's words. */
    watchPoint: text("watch_point"),
    answerType: text("answer_type").$type<AnswerType>().notNull(),
    /** For `enum`. Absence from this set is what makes an answer unmappable. */
    enumValues: jsonb("enum_values").$type<string[]>(),
    required: boolean("required").notNull().default(true),
    /** `locked` questions back the three permanent rules; the UI refuses to delete them. */
    source: text("source").$type<Provenance>().notNull().default("default"),
    /** Phase-1 result. Only `approved` rows enter the exemption set. */
    guardStatus: text("guard_status").$type<GuardStatus>().notNull().default("pending"),
    guardFindings: jsonb("guard_findings").$type<GuardFinding[]>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("questions_answer_type", oneOf("answer_type", ANSWER_TYPES)),
    check("questions_guard_status", oneOf("guard_status", GUARD_STATUSES)),
    check("questions_source", sql.raw(`"source" in ('note', 'default', 'clinician', 'locked')`)),
    /** Two questions sharing a slug would collapse into one slot. */
    uniqueIndex("uniq_q_slug").on(t.planId, t.questionId),
    /**
     * Deterministic script order. Two questions at position 3 make `assembleTask`
     * non-deterministic, and the guard's exact-string masking unreliable with it.
     */
    uniqueIndex("uniq_q_ordinal").on(t.planId, t.ordinal),
  ],
);

// ---------------------------------------------------------------------------
// scheduled_calls
// ---------------------------------------------------------------------------

/**
 * One row per (plan, occurrence, attempt).
 *
 * Occurrences are materialised eagerly at approval — seven dated rows appearing
 * at once is the argument the product is making. Attempts beyond the first are
 * inserted lazily, only because an attempt actually failed.
 *
 * NAMING HAZARD: our `attempt` is a Care Loop retry, which is a **separate
 * CALL-E call task**. CALL-E's own `recipient.attempts[]` are dial attempts
 * *inside* one call task. They are different numbers and must never be compared.
 */
export const scheduledCalls = pgTable(
  "scheduled_calls",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => followUpPlans.id, { onDelete: "restrict" }),
    /**
     * Denormalised, and immutable so it cannot drift. The roster, the week band
     * and the queue all filter by patient; carrying it here avoids a join through
     * `follow_up_plans` on the hottest read in the application.
     */
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    /** Calendar day index within the window, 1..N. A real column, per the key format. */
    occurrence: integer("occurrence").notNull(),
    /** 1..maxAttempts. A real column, per the key format. */
    attempt: integer("attempt").notNull().default(1),
    /** Stored, not recomputed at dial time, so the database enforces what CALL-E dedupes on. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** A real UTC instant, already divided by timeScale. Everything here on is scale-blind. */
    scheduledFor: ts("scheduled_for").notNull(),

    status: text("status").$type<CallStatus>().notNull().default("scheduled"),
    claimedAt: ts("claimed_at"),
    /** The `tick_runs.id` that took it, so a stuck row is traceable to a tick. */
    claimedBy: text("claimed_by"),

    /** The exact assembled script, written *before* dialling. The audit answer to "what did it say?". */
    task: text("task"),
    /** Persisted the instant `create()` returns. There is no endpoint to look a call up without it. */
    calleCallId: text("calle_call_id"),
    dialedAt: ts("dialed_at"),

    calleStatus: text("calle_status").$type<CalleStatus>(),
    /** The terminal attempt's code. `no_answer` drives the retry ladder, so it is a column. */
    calleFailureCode: text("calle_failure_code"),
    calleFailureMessage: text("calle_failure_message"),
    /**
     * Who or what picked up: human, ivr, voicemail, unknown.
     *
     * CALL-E exposes no built-in answered-by field; the documented way to get
     * one is a per-recipient structured result, which Care Loop never sent. So
     * "the patient answered" and "the answerphone answered" were the same row,
     * and the retry ladder could dial a voicemail box three times.
     */
    answeredBy: text("answered_by"),

    /** See `ResultStatus` — this is the SQL-NULL versus JSON-null distinction, made explicit. */
    resultStatus: text("result_status").$type<ResultStatus>().notNull().default("pending"),
    structuredResult: jsonb("structured_result"),
    /** CALL-E's own summary. Displayed, never used for a decision. */
    summary: text("summary"),
    taskCompleted: boolean("task_completed"),
    completionConfidence: jsonb("completion_confidence").$type<StoredConfidence>(),
    evidence: jsonb("evidence").$type<string[]>(),
    /** Stored in full — the queue shows the patient's own words, not a summary of them. */
    transcript: jsonb("transcript").$type<StoredTurn[]>(),
    /**
     * The entire Call payload, losslessly. There is no endpoint that lists calls,
     * so a field we forgot to promote to a column is a field we can never recover.
     * One blob removes that whole class of regret.
     */
    calleRaw: jsonb("calle_raw"),
    /** Guard phase 3, bot turns only. A patient saying "I stopped taking it" is data. */
    transcriptGuardFindings: jsonb("transcript_guard_findings").$type<GuardFinding[]>(),

    /** A refused dial is a visible row with a reason. Never a silent skip. */
    refusalReason: text("refusal_reason"),
    refusalDetail: text("refusal_detail"),
    skipReason: text("skip_reason").$type<SkipReason>(),

    /**
     * The one derived value this schema stores.
     *
     * Folding it needs the slots, the transcript and the failure code together,
     * and the roster would otherwise re-derive it for N patients × 7 days on
     * every page load. It is written inside the same conditional UPDATE that
     * finishes the call, so it can never disagree with `status`.
     */
    outcome: text("outcome").$type<CallOutcome>(),
    /** The lazy retry chain, so the UI can say "attempt 2 of 3". */
    retryOfCallId: text("retry_of_call_id"),
    /** The idempotency latch for finishing: the waiter and the reconciler race here routinely. */
    finishedAt: ts("finished_at"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("calls_status", oneOf("status", CALL_STATUSES)),
    check("calls_calle_status", oneOf("calle_status", CALLE_STATUSES, true)),
    check("calls_result_status", oneOf("result_status", RESULT_STATUSES)),
    check("calls_outcome", oneOf("outcome", CALL_OUTCOMES, true)),
    check("calls_skip_reason", oneOf("skip_reason", SKIP_REASONS, true)),
    check("calls_occurrence", sql`${t.occurrence} > 0`),
    check("calls_attempt", sql`${t.attempt} > 0`),
    /**
     * The insurance the `resultStatus` distinction needs: nothing else can catch
     * "wrote structured_result but forgot to move result_status off pending".
     */
    check(
      "calls_result_consistency",
      sql.raw(`("structured_result" is not null) = ("result_status" = 'present')`),
    ),
    /**
     * The anti-double-dial invariant, and the single most important constraint in
     * the schema. Two ticks racing to create the same retry both run
     * `ON CONFLICT DO NOTHING`; exactly one gets a row back and dials.
     */
    uniqueIndex("uniq_call_slot").on(t.planId, t.occurrence, t.attempt),
    /** The same invariant expressed in CALL-E's own terms. */
    uniqueIndex("uniq_call_idem").on(t.idempotencyKey),
    /** Two of our rows pointing at one CALL-E call would let one result finish both. */
    uniqueIndex("uniq_calle_call_id")
      .on(t.calleCallId)
      .where(sql`${t.calleCallId} is not null`),
    /** The batch-claim scan. Partial, so it holds the work queue and not the history. */
    index("idx_calls_due")
      .on(t.scheduledFor)
      .where(sql`${t.status} = 'scheduled'`),
    /** Rows an `after()` waiter abandoned when the route's max duration expired. */
    index("idx_calls_reconcile")
      .on(t.dialedAt)
      .where(sql`${t.status} in ('claimed', 'dialing')`),
    index("idx_calls_patient_time").on(t.patientId, t.scheduledFor),
    index("idx_calls_plan_occ").on(t.planId, t.occurrence),
  ],
);

// ---------------------------------------------------------------------------
// extracted_slots
// ---------------------------------------------------------------------------

export const extractedSlots = pgTable(
  "extracted_slots",
  {
    id: text("id").primaryKey(),
    callId: text("call_id")
      .notNull()
      .references(() => scheduledCalls.id, { onDelete: "cascade" }),
    /** Denormalised: every KPI reads slots across time per patient and must not join three tables. */
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    /**
     * Matches `plan_questions.question_id`, but deliberately **not** a foreign key:
     * a plan can be superseded and its questions replaced while historical slots
     * must stay readable. A dangling slug is a rendering problem; a broken FK is
     * a failed write.
     */
    questionId: text("question_id").notNull(),
    /** `unmappable` is a real status with a real destination — it escalates by default. */
    status: text("status").$type<SlotStatus>().notNull(),

    /** Typed columns rather than one jsonb `value`, so the KPIs are plain SQL aggregates. */
    valueBool: boolean("value_bool"),
    /** `integer`, never `numeric`: Drizzle returns numeric as a *string* and breaks arithmetic. */
    valueNumber: integer("value_number"),
    valueText: text("value_text"),
    /** What CALL-E put under this key before mapping — evidence the mapper mapped, not invented. */
    rawValue: jsonb("raw_value"),

    /**
     * The patient's verbatim words, copied from the transcript at extraction.
     * Denormalised on purpose: the queue renders the words behind each flag from
     * a single row read, with no transcript scan and no risk that a later re-scan
     * picks a different turn.
     */
    utterance: text("utterance"),
    /** Points back into `scheduled_calls.transcript` so "full transcript" lands on the right line. */
    utteranceOffsetSeconds: integer("utterance_offset_seconds"),
    extractedAt: ts("extracted_at").notNull().defaultNow(),
  },
  (t) => [
    check("slots_status", oneOf("status", SLOT_STATUSES)),
    check("slots_scale_range", sql`${t.valueNumber} is null or (${t.valueNumber} >= 0 and ${t.valueNumber} <= 10)`),
    /** What makes re-extraction — after a reconcile, after a re-fetch — a no-op. */
    uniqueIndex("uniq_slot").on(t.callId, t.questionId),
    /** "Has this patient's score been rising?", adherence over the window, the drift sweep. */
    index("idx_slots_patient_q").on(t.patientId, t.questionId, t.extractedAt),
  ],
);

// ---------------------------------------------------------------------------
// escalations
// ---------------------------------------------------------------------------

export const escalations = pgTable(
  "escalations",
  {
    id: text("id").primaryKey(),
    /** The human handle. Rendered `ESC-0031`; a clinician reads a number, not a uuid. */
    ref: bigserial("ref", { mode: "number" }).notNull(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    planId: text("plan_id")
      .notNull()
      .references(() => followUpPlans.id, { onDelete: "restrict" }),
    /** Nullable: the drift sweep raises with no call attached, because silence is the signal. */
    callId: text("call_id").references(() => scheduledCalls.id, { onDelete: "set null" }),
    slotId: text("slot_id").references(() => extractedSlots.id, { onDelete: "set null" }),

    /** Catalog id. No FK — rules live in code, and a rules table invites runtime rule authoring. */
    ruleId: text("rule_id").notNull(),
    /** Snapshotted: relabelling the catalog must not rewrite what a clinician was told last week. */
    ruleLabel: text("rule_label").notNull(),
    /** Only urgent pauses a plan. Stored, so the decision stays auditable after a catalog change. */
    urgent: boolean("urgent").notNull(),
    /** The plain sentence the queue prints. Composed by the pure engine: routing, never a verdict. */
    reason: text("reason").notNull(),
    /** Verbatim, denormalised, so the queue is one query with no joins. */
    utterance: text("utterance"),

    /**
     * The model's verdict, when a model produced one. Null on a pure-engine
     * row, which is the honest answer: a rule has no opinion about degree, it
     * only knows that it matched.
     */
    severity: text("severity").$type<TriageVerdict>(),
    /** The model's account of the call, for a clinician who was not on it. */
    summary: text("summary"),
    /** Deep link to the verdict and the evidence behind it. */
    triageId: text("triage_id"),
    /** Set when a clinician has actually read it — see the `acknowledged` status. */
    acknowledgedAt: ts("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),

    /**
     * The idempotency anchor. `${planId}:${ruleId}:${callId}` for call-derived
     * rules, `${planId}:drift:${patientLocalDate}` for the sweep — and that date
     * **must** be computed in the patient's timezone, or a sweep at 23:00 UTC
     * double-raises for Asia/Kolkata and skips a day for America/Los_Angeles.
     */
    dedupeKey: text("dedupe_key").notNull(),

    status: text("status").$type<EscalationStatus>().notNull().default("open"),
    /** True only on the escalation whose pause UPDATE actually returned a row. */
    pausedPlan: boolean("paused_plan").notNull().default(false),
    raisedAt: ts("raised_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolution: text("resolution").$type<Resolution>(),
    /**
     * What the clinician actually did about it.
     *
     * The queue could record that an escalation was closed and never what
     * happened — so "I rang her, she is fine" had nowhere to live, and the next
     * person read the same evidence from scratch.
     */
    resolutionNote: text("resolution_note"),
    /**
     * What the floor caught on this call, alongside the model's reading.
     *
     * One call used to produce one row per rule hit *plus* one for triage — a
     * real declined call raised three, two of them saying the same thing in
     * worse words. A clinician takes one action per call, so a call is one row,
     * and the rules it tripped are listed on it rather than beside it.
     */
    floorHits: jsonb("floor_hits").$type<{ ruleId: string; label: string; urgent: boolean }[]>(),
  },
  (t) => [
    check("esc_status", oneOf("status", ESCALATION_STATUSES)),
    check("esc_resolution", oneOf("resolution", RESOLUTIONS, true)),
    /**
     * The whole safety of "re-evaluate a finished call as often as you like"
     * rests here. A reconcile that re-reads a call re-runs the pure engine and
     * re-raises; this makes the second raise a no-op returning zero rows, so the
     * plan is not paused twice and the clinician is not notified twice.
     */
    uniqueIndex("uniq_esc_dedupe").on(t.dedupeKey),
    /** The /queue page's only query, sorted exactly as it is rendered. */
    index("idx_queue")
      .on(t.urgent, t.raisedAt)
      .where(sql`${t.status} in ('open', 'acknowledged')`),
    index("idx_esc_patient").on(t.patientId, t.raisedAt),
  ],
);

// ---------------------------------------------------------------------------
// call_triage
// ---------------------------------------------------------------------------

/**
 * What a model made of one finished call.
 *
 * A separate table rather than columns on `escalations`, for two reasons. The
 * verdict is about the **call**: the rules may raise zero or three escalations
 * for one call, and hanging a copy of the verdict off each is a denormalisation
 * that can disagree with itself. And a row that exists with
 * `status = 'unavailable'` says "the model could not judge this call" out loud,
 * where a null severity column would read as "not done yet" — the same
 * ambiguity `result_status` exists elsewhere in this schema to kill.
 *
 * `verdict` is NOT NULL by design. Every failure path writes `escalate`; there
 * is no state in which an absent judgement can be mistaken for a quiet call.
 */
export const callTriage = pgTable(
  "call_triage",
  {
    id: text("id").primaryKey(),
    callId: text("call_id")
      .notNull()
      .references(() => scheduledCalls.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    planId: text("plan_id")
      .notNull()
      .references(() => followUpPlans.id, { onDelete: "restrict" }),

    status: text("status").$type<TriageStatus>().notNull(),
    verdict: text("verdict").$type<TriageVerdict>().notNull(),
    /** One or two sentences. Why this verdict — never a diagnosis. */
    reason: text("reason").notNull(),
    /** What happened on the call, for a clinician who was not on it. */
    summary: text("summary"),
    /** Phrases copied from the transcript, never paraphrased. */
    keyTerms: jsonb("key_terms").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Which of the doctor's own escalation conditions this call touched. */
    matchedConcerns: jsonb("matched_concerns")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** One line the patient actually said. Evidence, not summary. */
    quote: text("quote"),

    /** Which model ran, so the claim stays checkable here too. */
    provider: text("provider").$type<CompileProvider>(),
    model: text("model"),
    /** The model's answer verbatim — the same evidence discipline as `compile_raw`. */
    raw: jsonb("raw"),
    /** Printed to the clinician on a failure, never swallowed. */
    error: text("error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("triage_status", oneOf("status", TRIAGE_STATUSES)),
    check("triage_verdict", oneOf("verdict", TRIAGE_VERDICTS)),
    check("triage_provider", oneOf("provider", COMPILE_PROVIDERS, true)),
    /** One verdict per call. Re-reading a finished call must never re-charge the model. */
    uniqueIndex("uniq_triage_call").on(t.callId),
    index("idx_triage_patient").on(t.patientId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// tick_runs
// ---------------------------------------------------------------------------

/**
 * The scheduler's audit trail, and a cheap mutex.
 *
 * The lease is **not** load-bearing for correctness — the per-row conditional
 * claim in `select.ts` already makes concurrent ticks safe. It exists because
 * three trigger sources (a page load, a cron POST, a client poller) can fire
 * inside the same second, and one no-op beats a thundering herd. Do not remove
 * the row-level claim guard on the assumption that this lease protects it.
 */
export const tickRuns = pgTable(
  "tick_runs",
  {
    id: text("id").primaryKey(),
    /** Answers "did the cron actually run?" on stage, instead of a black box. */
    trigger: text("trigger").$type<TickTrigger>().notNull(),
    lease: text("lease").notNull().default("global"),
    startedAt: ts("started_at").notNull().defaultNow(),
    /** NULL means running. Also the stale-lease clock. */
    finishedAt: ts("finished_at"),

    expanded: integer("expanded").notNull().default(0),
    /** Calls retired for being too late to place, rather than dialled at 2am. */
    retired: integer("retired").notNull().default(0),
    claimed: integer("claimed").notNull().default(0),
    dialed: integer("dialed").notNull().default(0),
    refused: integer("refused").notNull().default(0),
    finished: integer("finished").notNull().default(0),
    escalated: integer("escalated").notNull().default(0),

    error: text("error"),
  },
  (t) => [
    check("tick_trigger", oneOf("trigger", TICK_TRIGGERS)),
    uniqueIndex("uniq_tick_lease")
      .on(t.lease)
      .where(sql`${t.finishedAt} is null`),
    index("idx_tick_recent").on(t.startedAt),
  ],
);

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
export type ConsultationNote = typeof consultationNotes.$inferSelect;
export type NewConsultationNote = typeof consultationNotes.$inferInsert;
export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;
export type FollowUpPlan = typeof followUpPlans.$inferSelect;
export type NewFollowUpPlan = typeof followUpPlans.$inferInsert;
export type PlanQuestion = typeof planQuestions.$inferSelect;
export type NewPlanQuestion = typeof planQuestions.$inferInsert;
export type ScheduledCall = typeof scheduledCalls.$inferSelect;
export type NewScheduledCall = typeof scheduledCalls.$inferInsert;
export type ExtractedSlot = typeof extractedSlots.$inferSelect;
export type NewExtractedSlot = typeof extractedSlots.$inferInsert;
export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
export type TickRun = typeof tickRuns.$inferSelect;
export type NewTickRun = typeof tickRuns.$inferInsert;
