/**
 * The closed vocabularies, as TypeScript unions.
 *
 * These are `text` columns with a CHECK constraint, never `pgEnum`. Three
 * reasons, all of which bite in this repo specifically:
 *
 *   1. Every racy mutation here is a hand-written `sql` fragment (there are no
 *      transactions on the Neon HTTP driver, so a conditional UPDATE is the only
 *      tool). A pgEnum needs `::type` casts in places Postgres cannot infer —
 *      inside arrays, parameterised `IN (…)`, `CASE` arms — and each missing
 *      cast is a runtime error found on demo day. `text` never needs one.
 *   2. `ALTER TYPE … ADD VALUE` cannot run inside a transaction block, and
 *      drizzle-kit wraps migrations in one. Adding a status mid-build would mean
 *      hand-editing `drizzle/*.sql`, which AGENTS.md rule 11 forbids.
 *   3. CALL-E's `failureCode` is an open third-party vocabulary we do not own.
 *      Mixing pgEnum and text columns in one table reads worse than uniform text.
 *
 * `$type<Union>()` gives the compile-time safety; the CHECK gives the database
 * the same guarantee against a typo in a raw fragment.
 */

/** "Never asked" is not "refused". The first-call gate behaves differently for each. */
export type ConsentState = "unknown" | "granted" | "declined";

export type CompileStatus = "pending" | "compiled" | "refused";

/** Lifecycle only. Plan *health* (drifting / on_track / escalated) is derived, never stored. */
export type PlanStatus =
  | "awaiting_approval"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

export type CloseReason =
  | "duration_elapsed"
  | "clinician_closed"
  | "patient_declined"
  | "superseded";

export type Cadence = "daily" | "every_other_day" | "weekly";

/** Where a field's value came from. `locked` marks what a clinician may not delete. */
export type Provenance = "note" | "default" | "clinician" | "locked";

export type AnswerType = "boolean" | "scale_0_10" | "enum" | "text";

/** Guard phase 1, persisted. Only `approved` questions enter the phase-2 exemption set. */
export type GuardStatus = "pending" | "approved" | "rejected";

/** Care Loop's own call lifecycle. */
export type CallStatus =
  | "scheduled"
  | "claimed"
  | "dialing"
  | "completed"
  | "failed"
  | "refused"
  | "skipped"
  | "cancelled";

/**
 * CALL-E's call status, kept in its own column and its own spelling.
 *
 * Note `canceled` (one l) against our `cancelled` (two). They describe different
 * systems and conflating them is how a status check silently never matches.
 */
export type CalleStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

/**
 * Whether we have a structured result, and what kind of nothing it is if not.
 *
 * The single most important distinction in the schema. A jsonb column cannot
 * tell "SQL NULL, we have not fetched a result yet" from "CALL-E returned null,
 * which *means* the answers were unmappable". Conflating those either loses the
 * `unmappable_response` escalation entirely or fires it on every in-flight call.
 */
export type ResultStatus = "pending" | "present" | "null_result";

/** Folded once at finish time; the week band reads this and nothing else. */
export type CallOutcome =
  | "answered"
  | "no_answer"
  | "flagged"
  | "unmappable"
  | "refused";

/** `unmappable` is a real answer state with a real destination, not an absence. */
export type SlotStatus = "answered" | "unmappable" | "missing" | "refused";

export type EscalationStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export type Resolution = "resumed" | "closed" | "contacted_patient" | "no_action";

/** The three honest tick triggers, plus the demo script. */
export type TickTrigger = "page" | "cron" | "poller" | "manual";

/** Why a due call never dialled. Always visible, never silent. */
/**
 * Why an occurrence was never dialled.
 *
 * `too_late` is a safety outcome, not an error: a call is never early but can
 * be arbitrarily late, and nothing ran the scheduler for hours would otherwise
 * mean the whole backlog rings at whatever hour it finally woke up.
 */
export type SkipReason = "plan_paused" | "plan_closed" | "patient_archived" | "too_late";

export type ConsentSource = "registration" | "call";

/**
 * Which model actually compiled the note. `gemini` survives in the CHECK for
 * rows written before the compiler went OpenAI-only; nothing writes it now.
 */
export type CompileProvider = "gemini" | "openai";

/**
 * What the front desk booked. A post-operative visit is still a consultation
 * in every mechanical sense — the difference is what the note is about, and
 * the compiler is told which so it does not have to guess from the prose.
 */
export type VisitKind = "consultation" | "post_op";

/**
 * `waiting` is the doctor's list. `seen` is set by the same conditional UPDATE
 * that attaches the note, so a visit cannot be "seen" without one. `cancelled`
 * exists because a booking that never happened must not sit on the list
 * forever.
 */
export type VisitStatus = "waiting" | "seen" | "cancelled";

/**
 * How a triage verdict was reached.
 *
 * The three failure states exist so that "the model could not judge this call"
 * is a fact a clinician can see, rather than a null anyone can read as "fine".
 * Every one of them carries a verdict of `escalate` — an absent judgement is
 * never `low`.
 */
export type TriageStatus = "ok" | "unavailable" | "error" | "unparseable";

/**
 * What the model thinks this call needs.
 *
 * `severe` pauses the plan; `escalate` queues it while the follow-up keeps
 * dialling; `low` raises nothing. Only `severe` stops care, because a wrong
 * verdict that halts a patient's follow-up is worse than one that queues it.
 */
export type TriageVerdict = "severe" | "escalate" | "low";

/**
 * Derived plan health. Not a column — computed in `lib/patients/kpi.ts` from
 * open escalations, plan status and silence. A stored health value goes stale
 * the moment a patient falls quiet, which is the exact failure this product
 * exists to catch.
 */
export type PlanHealth =
  /** No plan written yet. The quietest a patient can be, so it is shown, not hidden. */
  | "needs_plan"
  /**
   * The window closed and nobody was ever reached.
   *
   * This is the failure the product exists to catch, and it used to render as
   * "Completed" — indistinguishable from a week that went well. A plan can end
   * without contact for entirely mundane reasons (a wrong number, a refused
   * dial, an empty calendar), and every one of them means a patient nobody
   * followed up.
   */
  | "never_reached"
  | "on_track"
  | "drifting"
  | "escalated"
  | "awaiting_approval"
  | "paused"
  | "completed";

/** One cell of the seven-day band. */
export type DayState =
  | "answered"
  | "missed"
  | "flagged"
  | "held"
  | "scheduled"
  | "none";

/** Every list a CHECK constraint needs, spelled once. */
export const CONSENT_STATES = ["unknown", "granted", "declined"] as const;
export const COMPILE_STATUSES = ["pending", "compiled", "refused"] as const;
export const COMPILE_PROVIDERS = ["gemini", "openai"] as const;
export const VISIT_KINDS = ["consultation", "post_op"] as const;
export const VISIT_STATUSES = ["waiting", "seen", "cancelled"] as const;
export const TRIAGE_STATUSES = ["ok", "unavailable", "error", "unparseable"] as const;
export const TRIAGE_VERDICTS = ["severe", "escalate", "low"] as const;
export const PLAN_STATUSES = [
  "awaiting_approval",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;
export const CLOSE_REASONS = [
  "duration_elapsed",
  "clinician_closed",
  "patient_declined",
  "superseded",
] as const;
export const CADENCES = ["daily", "every_other_day", "weekly"] as const;
export const PROVENANCES = ["note", "default", "clinician", "locked"] as const;
export const ANSWER_TYPES = ["boolean", "scale_0_10", "enum", "text"] as const;
export const GUARD_STATUSES = ["pending", "approved", "rejected"] as const;
export const CALL_STATUSES = [
  "scheduled",
  "claimed",
  "dialing",
  "completed",
  "failed",
  "refused",
  "skipped",
  "cancelled",
] as const;
export const CALLE_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
] as const;
export const RESULT_STATUSES = ["pending", "present", "null_result"] as const;
export const CALL_OUTCOMES = [
  "answered",
  "no_answer",
  "flagged",
  "unmappable",
  "refused",
] as const;
export const SLOT_STATUSES = ["answered", "unmappable", "missing", "refused"] as const;
export const ESCALATION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
] as const;
export const RESOLUTIONS = [
  "resumed",
  "closed",
  "contacted_patient",
  "no_action",
] as const;
export const TICK_TRIGGERS = ["page", "cron", "poller", "manual"] as const;
export const SKIP_REASONS = ["plan_paused", "plan_closed", "patient_archived", "too_late"] as const;
export const CONSENT_SOURCES = ["registration", "call"] as const;
