/**
 * The review screen.
 *
 * The one place the product asks a doctor to take responsibility, so everything
 * on it is arranged around that: what the model produced, what code filled in,
 * what it refused, and one button.
 *
 * Every field carries its provenance. That mark is only trustworthy because the
 * compiler's schema made each of these nullable and `applyDefaults` filled the
 * nulls afterwards — the model was never able to claim a value came from the
 * note when it did not.
 */

import { notFound } from "next/navigation";

import { Badge, Breadcrumb, Panel } from "@/components/ui";
import { calendarDaysBetween } from "@/lib/time/clock";
import { ApprovePlan, DemoClock, PlanDraftControls } from "@/components/PlanReview";
import { AddQuestion, QuestionRow } from "@/components/QuestionEditor";
import { EscalationSetup } from "@/components/EscalationSetup";
import { CancelPlan } from "@/components/CancelPlan";
import { ANSWER_LABEL } from "@/lib/plan/clinician-question";
import { getPlanForReview } from "@/lib/db/plans";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import { readConfig } from "@/lib/config";
import { REFUSAL_TEXT } from "@/lib/calle/port";
import { OBSERVED_QUESTION_IDS } from "@/lib/plan/universal-questions";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";
import { CONSENT_LABEL } from "@/lib/patients/labels";
import { expandPlan } from "@/lib/schedule/expand";
import { coverage } from "@/lib/plan/coverage";
import { EXAMPLE_PROMPTS } from "@/lib/plan/examples";
import type { Provenance } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

/**
 * Where a value came from, said plainly.
 *
 * Schedule fields carry three marks, and the one that needs the doctor is the
 * only coloured one: "Not in note — set this" (blue: it informs, nobody is at
 * risk). "From note" prints the note's own words, which code found in the note
 * — so the mark is checkable on the screen instead of trusted. Fields the note
 * never governs (attempts, the reason line) say "Standard" / "Not in note".
 */
type MarkKind = "schedule" | "reason" | "standard";

function ProvenanceMark({
  source,
  quote,
  kind,
}: {
  source: Provenance | undefined;
  quote?: string;
  kind: MarkKind;
}) {
  if (source === "clinician") {
    return (
      <Badge tone="plain" quiet>
        You set this
      </Badge>
    );
  }
  if (source === "note") {
    if (kind !== "schedule") return null;
    const words = quote && quote.length > 32 ? `${quote.slice(0, 31)}…` : quote;
    return (
      <Badge tone="plain" quiet>
        {words ? `From note: “${words}”` : "From note"}
      </Badge>
    );
  }
  if (kind === "standard") {
    return (
      <Badge tone="plain" quiet>
        Standard
      </Badge>
    );
  }
  if (kind === "reason") {
    return (
      <Badge tone="plain" quiet>
        Not in note
      </Badge>
    );
  }
  return (
    <Badge tone="info" quiet>
      Not in note — set this
    </Badge>
  );
}

/** The schedule fields a note can supply, and how the banner names each. */
const SCHEDULE_FIELDS: [field: "cadence" | "durationDays" | "localTime", words: string][] = [
  ["cadence", "how often"],
  ["durationDays", "for how long"],
  ["localTime", "what time"],
];

function listWords(words: string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/*
 * What each consent state means for dialling, in one sentence.
 *
 * The label itself comes from `CONSENT_LABEL` — there were four wordings for
 * this one field across four screens, and a safety label that reads differently
 * depending on where you are standing is a label nobody can rely on.
 */
const CONSENT_SENTENCE: Record<string, string> = {
  granted: CONSENT_LABEL.granted,
  declined: CONSENT_LABEL.declined,
  unknown: "Not recorded — nothing will be dialled until it is",
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlanForReview(id);
  if (!plan) notFound();

  /*
   * Observations are not questions and must not be listed as if the agent will
   * read them out. `requests_clinician` sat at number three in "What it will
   * ask" — a leading yes/no in the middle of a clinical survey — and a doctor
   * reading that list was being told the agent would ask it. It does not; it
   * records whether the patient asked for a person, whenever they did.
   */
  const approved = plan.questions.filter(
    (q) => q.guardStatus === "approved" && !OBSERVED_QUESTION_IDS.has(q.questionId),
  );
  const observed = plan.questions.filter(
    (q) => q.guardStatus === "approved" && OBSERVED_QUESTION_IDS.has(q.questionId),
  );
  const rejected = plan.questions.filter((q) => q.guardStatus !== "approved");
  const awaiting = plan.status === "awaiting_approval";

  /* Schedule fields still on a placeholder — the note was silent and nobody
     has chosen a value yet. Empty once the doctor saves the schedule. */
  const missingSchedule = awaiting
    ? SCHEDULE_FIELDS.filter(([field]) => plan.provenance[field] === "default").map(
        ([, words]) => words,
      )
    : [];

  /* Only questions that will be asked count toward covering a watch-point. */
  const report = coverage(
    plan.watchPoints,
    approved.map((q) => ({ prompt: q.prompt, watchPoint: q.watchPoint, source: q.source })),
    EXAMPLE_PROMPTS,
  );
  const covered = report.rows.length - report.uncovered;

  /*
   * The plan's state, as one stamp. "Day 2 of 5" is the only count on the
   * page because it is real data about this patient, not a step in a diagram.
   * Days are calendar days in the patient's zone, the way the schedule counts.
   */
  const status = (() => {
    if (awaiting) return "Plan to review";
    if (plan.status === "active") {
      if (!plan.startsAt) return "Calling";
      const now = new Date();
      if (plan.startsAt > now) return `Calls from ${formatStamp(plan.startsAt, plan.timezone)}`;
      const day = calendarDaysBetween(plan.startsAt, now, plan.timezone) + 1;
      return `Calling · day ${Math.min(day, plan.durationDays)} of ${plan.durationDays}`;
    }
    if (plan.status === "paused") return "Paused";
    if (plan.status === "completed") return "Resolved";
    if (plan.status === "cancelled") return "Cancelled";
    return plan.status.replace(/_/g, " ");
  })();

  /*
   * The same expansion the approve action will run, previewed. A doctor should
   * be told the real time of the first call before they authorise it — "at the
   * next tick" is an internal scheduler noun and tells them nothing.
   */
  const expansion = expandPlan({
    planId: plan.id,
    patientId: plan.patientId,
    timezone: plan.timezone,
    localTime: plan.localTime,
    durationDays: plan.durationDays,
    cadence: plan.cadence as "daily" | "every_other_day" | "weekly",
    timeScale: plan.timeScale,
    now: new Date(),
  });
  const preview = {
    firstCallAt: expansion.occurrences[0]
      ? formatStamp(expansion.occurrences[0].scheduledFor, plan.timezone)
      : "—",
    calls: expansion.occurrences.length,
  };

  /*
   * The note, beside what was made of it.
   *
   * It sat in a panel at the foot of the page, below the plan, the questions,
   * the refusals and the rules — so a doctor checking "From note: …" against
   * what they wrote had to scroll past everything to find it. At desktop width
   * it is a sticky column on the left; on a phone it folds under the heading.
   */
  const noteText = (
    <p className="mono plan-note-body">
      {plan.noteBody}
      {/* Only when the note does not already say it in so many words. */}
      {plan.escalationNote && !plan.noteBody.includes(plan.escalationNote) ? (
        <>
          {"\n\n"}
          <span className="plan-note-escalate">Escalate if: </span>
          {plan.escalationNote}
        </>
      ) : null}
    </p>
  );

  return (
    <div className="plan-page">
      <aside className="plan-note" aria-label="The consultation note">
        <h2 className="caps plan-note-title">The consultation note</h2>
        {noteText}
      </aside>

      <div className="plan-main">
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        {/* One trail for every plan, matching the rail — which marks /plans as
            Follow-ups. A draft's trail said Consults while the rail said
            Follow-ups, and the page disagreed with itself about where you were. */}
        <Breadcrumb
          items={[
            { label: "Follow-ups", href: "/dashboard" },
            { label: plan.patientName, href: `/patients/${plan.patientId}` },
            { label: awaiting ? "Plan to review" : "Plan" },
          ]}
        />
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: "0 0 calc(var(--cell) * 1.5)",
            color: "var(--bench-ink)",
          }}
        >
          {awaiting ? "Approve this plan?" : plan.reason}
        </h1>
        <Badge tone="plain">{status}</Badge>
        {/*
          Nothing about the machinery.

          This line read "compiled by gemini (gemini-2.5-flash)". A doctor
          deciding whether to phone a patient does not need the name of a model,
          and putting one on the screen invites them to weigh it — which is
          exactly the judgement this product says it never asks them to make.
          The provider and model are still persisted on the note, so which
          model compiled it stays checkable in the data; it is simply not a
          thing a clinician is shown.
        */}
      </header>

      <details className="disclosure plan-note-fold">
        <summary>The consultation note</summary>
        {noteText}
      </details>

      {/*
        No patient panel here.

        It printed name, age, number, timezone and language above a plan whose
        approve block restates every one of them at the moment they matter —
        "Care Loop will call X on Y, first call at Z" — so the page said the
        same six facts twice, four screens apart. The corrections drawer moved
        down there with them: the reason to check a number is that you are about
        to authorise calls to it.
      */}
      {plan.compileStatus === "refused" ? (
        <Panel title="The compiler refused" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print)" }}>
              {plan.compileError}
            </p>
            <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14 }}>
              The plan below is blank rather than invented. Set the cadence and add
              the questions yourself, or fix the configuration and write the note again.
            </p>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="The plan"
        /*
          Quiet, always. Approve is the one amber-filled element on this page,
          and a filled status strip beside it would compete with the only action
          the page exists for.
        */
        aside={
          <Badge tone={awaiting ? "amber" : "clear"} quiet>
            {awaiting ? "Awaiting approval" : plan.status}
          </Badge>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {/*
            The gap, said before the values. When the note gives no schedule the
            numbers below are placeholders, and a placeholder printed at the same
            weight as a decision is how a doctor approves a guess. This stays
            until they save the schedule, which is them choosing it.
          */}
          {missingSchedule.length > 0 ? (
            <p
              role="note"
              style={{
                margin: "0 0 calc(var(--cell) * 3)",
                padding: "calc(var(--cell) * 2)",
                background: "var(--info-wash)",
                boxShadow: "inset 0 0 0 1px var(--info)",
                color: "var(--print)",
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              <strong>The note doesn&rsquo;t say {listWords(missingSchedule)} to call.</strong>{" "}
              Those values are placeholders. Set them below before approving.
              {plan.scheduleQuotes.unsupportedCadence
                ? ` The note asks for “${plan.scheduleQuotes.unsupportedCadence}”, which isn't a frequency Care Loop can schedule; choose the nearest.`
                : ""}
            </p>
          ) : null}

          <dl
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 4)",
              margin: "0 0 calc(var(--cell) * 3)",
            }}
          >
            {/*
              The last value says whether a clinician compares this to another
              instance of itself. A cadence, a time and an attempt count are all
              compared by eye and were set as language; the thing being followed
              up on is language and was set the same way. The rule was simply
              not being applied here.
            */}
            {/* How often and for how long are separate rows now: each can come
                from a different place, and one mark could not honestly speak for
                both. */}
            {([
              ["Following up on", plan.reason, "reason", false, "reason"],
              ["How often", plan.cadence.replace(/_/g, " "), "cadence", true, "schedule"],
              ["For", `${plan.durationDays} days`, "durationDays", true, "schedule"],
              ["Best time to call", `${plan.localTime} ${plan.timezone}`, "localTime", true, "schedule"],
              [
                "Attempts",
                `up to ${plan.maxAttempts}, ${plan.retryDelayMinutes} min apart`,
                "maxAttempts",
                true,
                "standard",
              ],
            ] as [string, string, string, boolean, MarkKind][]).map(([label, value, field, mono, kind]) => (
              <div key={label}>
                <dt
                  className="caps"
                  style={{
                    color: "var(--print-3)",
                    display: "flex",
                    gap: "calc(var(--cell) * 0.75)",
                    alignItems: "center",
                    marginBottom: 2,
                  }}
                >
                  {label}
                  <ProvenanceMark
                    source={plan.provenance[field]}
                    kind={kind}
                    quote={plan.scheduleQuotes[field as keyof typeof plan.scheduleQuotes]}
                  />
                </dt>
                <dd
                  className={mono ? "mono" : undefined}
                  style={{ margin: 0, fontSize: 15, color: "var(--print)", lineHeight: 1.4 }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {/*
            The sentence HANDOFF.md insists belongs here. Without it, "7 days"
            reads as seven completed calls, and a clinician would expect the
            plan to keep going until it got them.
          */}
          <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14, lineHeight: 1.55 }}>
            <strong>Calendar days from approval</strong>, not answered calls. A day
            nobody picks up still uses one up.
          </p>

          {awaiting ? <PlanDraftControls
              planId={plan.id}
              durationDays={plan.durationDays}
              localTime={plan.localTime}
              cadence={plan.cadence}
              maxAttempts={plan.maxAttempts}
              startOpen={missingSchedule.length > 0}
            /> : null}
        </div>
      </Panel>

      {/*
        What the note asks to watch, against what will be asked.

        Both failure modes of a compiled plan are readable here rather than in
        a log: a watch-point with no question is the compiler under-reading the
        note, and a question tied to nothing — or copied from the style
        examples — is it over-reading. Printed beside the note's own words, so
        the doctor checks the list against what they wrote.
      */}
      {plan.watchPoints.length > 0 ? (
        <Panel
          title="What the note asks to watch"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {covered} of {report.rows.length} asked
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {report.rows.map((row, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "calc(var(--cell) * 1) calc(var(--cell) * 2)",
                  padding: "calc(var(--cell) * 1.75) calc(var(--cell) * 3)",
                  borderTop: i > 0 ? "1px solid var(--rule-2)" : undefined,
                }}
              >
                <span style={{ flex: "1 1 calc(var(--cell) * 30)", minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
                    {row.watchPoint.text}
                  </span>
                  <span
                    className="mono"
                    style={{ display: "block", marginTop: 2, fontSize: 13, color: "var(--print-3)" }}
                  >
                    &ldquo;{row.watchPoint.quote}&rdquo;
                  </span>
                </span>
                {row.questions.length > 0 ? (
                  <Badge tone="clear" quiet>
                    Asked
                  </Badge>
                ) : (
                  <Badge tone="info" quiet>
                    No question
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {report.orphans.length > 0 || report.templateCopies.length > 0 ? (
            <div
              style={{
                padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
                borderTop: "1px solid var(--rule)",
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--print-2)",
              }}
            >
              {report.orphans.length > 0 ? (
                <p style={{ margin: 0 }}>
                  <strong>Not tied to anything the note asks:</strong>{" "}
                  {report.orphans.join(" · ")}
                </p>
              ) : null}
              {report.templateCopies.length > 0 ? (
                <p style={{ margin: report.orphans.length > 0 ? "calc(var(--cell) * 1) 0 0" : 0 }}>
                  <strong>Same as a style example — check the note asks for it:</strong>{" "}
                  {report.templateCopies.join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title="The questions"
        aside={
          <span className="caps mono" style={{ color: "var(--print-3)" }}>
            {approved.length} questions
          </span>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          {approved.length === 0 ? (
            <p style={{ margin: 0, color: "var(--print-2)", fontSize: 14 }}>
              Nothing to ask yet. A plan with no questions is never dialled.
            </p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: "calc(var(--cell) * 3)" }}>
              {approved.map((q) => (
                <li key={q.id} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
                  <QuestionRow
                    planId={plan.id}
                    questionId={q.id}
                    prompt={q.prompt}
                    /* A locked question backs a rule that can never be removed. */
                    editable={awaiting && q.source !== "locked"}
                    reorderable={awaiting && q.source !== "locked"}
                    meta={
                      <>
                        <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                          {ANSWER_LABEL[q.answerType]}
                          {/* No `questionId`: it is the machine's key for the
                              answer, and a doctor reads snake_case as "not for me". */}
                          {q.enumValues ? `: ${q.enumValues.join(", ")}` : ""}
                          {q.source === "locked" ? " · always asked" : ""}
                        </span>
                        {/* Why this question is here, in the doctor's own words —
                            checked against the note, not asserted by the model. */}
                        {q.anchorQuote ? (
                          <span
                            style={{ display: "block", marginTop: 2, fontSize: 13, color: "var(--print-3)" }}
                          >
                            Asks about{" "}
                            <span className="mono">&ldquo;{q.anchorQuote}&rdquo;</span>
                          </span>
                        ) : q.source === "clinician" ? (
                          <span
                            style={{ display: "block", marginTop: 2, fontSize: 13, color: "var(--print-3)" }}
                          >
                            You added this
                          </span>
                        ) : null}
                      </>
                    }
                  />
                </li>
              ))}
            </ol>
          )}

          {awaiting ? <AddQuestion planId={plan.id} /> : null}

          {/*
            Said plainly, because "why is the agent not asking this?" is the
            question a doctor would otherwise take to the transcript.
          */}
          {observed.length > 0 ? (
            <div
              style={{
                marginTop: "calc(var(--cell) * 3)",
                paddingTop: "calc(var(--cell) * 2.5)",
                borderTop: "1px solid var(--rule)",
              }}
            >
              <p className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
                Recorded from the call, never asked
              </p>
              <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 3)" }}>
                {observed.map((q) => (
                  <li key={q.id} style={{ color: "var(--print-2)", fontSize: 14, marginBottom: 4 }}>
                    {q.prompt}{" "}
                    <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                      · always on
                    </span>
                  </li>
                ))}
              </ul>
              {/* The reasoning, folded: the list above is what a doctor needs. */}
              <details className="disclosure" style={{ marginTop: "calc(var(--cell) * 1.5)" }}>
                <summary>Why this is listened for, not asked</summary>
                <p
                  className="measure"
                  style={{ margin: "calc(var(--cell) * 1) 0 0", color: "var(--print-3)", fontSize: 13 }}
                >
                  Asking whether someone would like a callback invites a polite yes;
                  noticing that they asked for one is the thing the rule is for.
                </p>
              </details>
            </div>
          ) : null}
        </div>
      </Panel>

      {rejected.length > 0 ? (
        <Panel
          title="The refused questions"
          aside={<Badge tone="danger">{rejected.length} refused</Badge>}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 14 }}>
              Shown rather than deleted, because a model attempting to give
              advice is something you should see. Rewriting one puts it back
              through the guard.
            </p>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 14 }}>
              {/*
                Not a nicety: `assembleTask` refuses to build a script while any
                question on the plan is unapproved, so this plan dials nothing
                until each one is rewritten or removed.
              */}
              <strong>A plan with a refused question does not dial at all.</strong> Rewrite
              each one or remove it before you approve.
            </p>
            {rejected.map((q) => (
              <div key={q.id} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
                <QuestionRow
                  planId={plan.id}
                  questionId={q.id}
                  prompt={q.prompt}
                  quoted
                  editable={awaiting && q.source !== "locked"}
                  /*
                    The reason, not just the category. An edit that the guard
                    refuses lands the row here, so this is where the doctor
                    reads why — the inline message they were shown is gone the
                    moment the row moves panels.
                  */
                  meta={(q.guardFindings ?? []).map((f, i) => (
                    <span
                      key={i}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "calc(var(--cell) * 1)",
                        alignItems: "baseline",
                        marginTop: "calc(var(--cell) * 0.75)",
                      }}
                    >
                      <Badge tone="danger" quiet>
                        {f.category.replace(/_/g, " ")}
                      </Badge>
                      <span style={{ fontSize: 13, color: "var(--print-2)", lineHeight: 1.45 }}>
                        {/* A cap refusal has no matched words to quote. */}
                        {f.match ? (
                          <>
                            <span className="mono">&ldquo;{f.match}&rdquo;</span> —{" "}
                          </>
                        ) : null}
                        {f.reason}
                      </span>
                    </span>
                  ))}
                />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="The escalation rules"
        aside={
          <Badge tone="plain" quiet>
            {/* Distinct: two lists can carry the same word, and the panel shows it once. */}
            <span className="mono">
              {new Set(plan.redFlagTerms.map((t) => t.term.toLowerCase())).size}
            </span>{" "}
            words ·{" "}
            <span className="mono">{plan.rules.length}</span> rules
          </Badge>
        }
        style={{ marginBottom: "calc(var(--cell) * 2)" }}
      >
        {plan.status === "completed" || plan.status === "cancelled" ? (
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1)" }}>
              {plan.rules.map((r, i) => (
                <Badge key={i} tone="plain" quiet={r.source !== "locked"}>
                  {r.label}
                  {r.source === "locked" ? " · always on" : ""}
                </Badge>
              ))}
            </div>
            <p style={{ margin: "calc(var(--cell) * 2) 0 0", color: "var(--print-3)", fontSize: 13 }}>
              This plan has finished, so its rules are history and cannot be edited.
            </p>
          </div>
        ) : (
          <EscalationSetup
            planId={plan.id}
            escalationNote={plan.escalationNote}
            terms={plan.redFlagTerms}
            live={plan.status !== "awaiting_approval"}
          />
        )}
      </Panel>

      {awaiting ? (
        <>
        <ApprovePlan
          planId={plan.id}
          patientId={plan.patientId}
          canApprove={approved.length > 0}
          refusedQuestions={rejected.length}
          unsetSchedule={missingSchedule}
          patientName={plan.patientName}
          maskedPhone={maskPhone(plan.phoneE164)}
          {...preview}
          timezone={plan.timezone}
          maxAttempts={plan.maxAttempts}
          consent={CONSENT_SENTENCE[plan.consent] ?? "Not asked yet"}
          language={
            LANGUAGE_OPTIONS.find((o) => o.value === plan.language)?.label ?? plan.language
          }
          {...(() => {
            /*
             * The console no longer carries a standing "calls live" badge, so
             * this screen is the only place the fact appears — and it is the
             * right place: it is the moment it changes a decision. Both causes
             * are checked, because "no key configured" and "number outside the
             * list" produce the same silence and need different fixes.
             */
            const config = readConfig();
            const armed =
              config.allowlistOpen || config.callAllowlist.includes(plan.phoneE164);
            /*
             * Consent first, because consent is the gate — `dial()` refuses
             * anything but `granted`, and the enrolment form defaults an
             * unticked box to `unknown`. Without this check the commonest
             * mistake in the product produced a live "start the follow-up"
             * button, seven dated rows, and every one of them refused: the
             * exact silent failure Care Loop exists to catch, aimed at itself.
             */
            if (plan.consent !== "granted") {
              return {
                willRing: false,
                blockedReason: REFUSAL_TEXT.no_consent,
              };
            }
            if (!config.liveCallsEnabled) {
              return {
                willRing: false,
                blockedReason:
                  "This instance is not configured to place calls, so nothing will " +
                  "ring.",
              };
            }
            if (!armed) {
              return {
                willRing: false,
                /* Name the setting. "Outside the list" describes a cause
                   nobody on this screen can locate: the list is an env var, and
                   an operator reading this needs to know which one and that
                   clearing it opens the instance back up. */
                blockedReason:
                  "CARELOOP_CALL_ALLOWLIST is set on this deployment, and this " +
                  "number is not on it. Clear that variable to let consent be " +
                  "the only gate.",
              };
            }
            return { willRing: true, blockedReason: null };
          })()}
        />
        {/*
          A draft you do not want had no exit. `cancelPlan` accepts an
          `awaiting_approval` plan in SQL and always did; only the button was
          gated on active-or-paused, so a note compiled twice by mistake left a
          permanent "Waiting on your decision" row on the roster.
        */}
        {/* Flex: an inline button in a paragraph overhangs its line box. */}
        <p style={{ margin: "calc(var(--cell) * 2) 0 0", display: "flex" }}>
          <CancelPlan planId={plan.id} patientId={plan.patientId} draft />
        </p>
        {/* Last, and folded: it compresses the calendar for a demo and has no
            place among the clinical settings above. */}
        <DemoClock planId={plan.id} timeScale={plan.timeScale} />
        </>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
          {/*
            The "See the calendar" button that stood here was the second link to
            `/patients/[id]` on this page — the patient's own name at the top is
            the first — and it named a view that does not exist: there is no
            calendar, there is a week band and a call log. It also sat beside
            Cancel, which put navigation and a destructive act in one row.
          */}
          {plan.status === "active" || plan.status === "paused" ? (
            <CancelPlan planId={plan.id} patientId={plan.patientId} />
          ) : null}
          <span className="caps mono" style={{ color: "var(--bench-ink-3)" }}>
            {plan.startsAt && plan.endsAt
              ? `${formatStamp(plan.startsAt, plan.timezone)} → ${formatStamp(plan.endsAt, plan.timezone)}`
              : ""}
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
