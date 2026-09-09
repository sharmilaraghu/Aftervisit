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

import { notFound, redirect } from "next/navigation";

import { Badge, Button, Panel } from "@/components/ui";
import { ApprovePlan, PlanDraftControls } from "@/components/PlanReview";
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
import type { Provenance } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

/** The mark. `default` is the one that has to be visible; the rest are context. */
function ProvenanceMark({ source }: { source: Provenance | undefined }) {
  if (source === "note") return null;
  if (source === "clinician") {
    return (
      <Badge tone="info" quiet>
        You set this
      </Badge>
    );
  }
  return (
    <Badge tone="info" quiet>
      Defaulted
    </Badge>
  );
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

  /* A draft is not a record yet — it is step 5 of the wizard, and there is one
     approve screen rather than two that have to be kept saying the same thing. */
  if (plan.status === "awaiting_approval") redirect(`/plan/new?plan=${plan.id}&step=5`);

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

  return (
    <div
      style={{
        maxWidth: 944,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          {/* Where it goes, not just what it is. A patient's name alone in a
              box is a label; a doctor scanning for the way out reads a verb. */}
          <Button variant="ghost" href={`/patients/${plan.patientId}`}>
            Back to {plan.patientName}
          </Button>
        </p>
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
        {/*
          Nothing about the machinery.

          This line read "compiled by gemini (gemini-2.5-flash)". A doctor
          deciding whether to phone a patient does not need the name of a model,
          and putting one on the screen invites them to weigh it — which is
          exactly the judgement this product says it never asks them to make.
          The provider and model are still persisted on the note, so "compiled
          by one model with another as a fallback" stays checkable in the data;
          it is simply not a thing a clinician is shown.
        */}
      </header>

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
            {([
              ["Following up on", plan.reason, "reason", false],
              [
                "Cadence",
                `${plan.cadence.replace(/_/g, " ")} · ${plan.durationDays} days`,
                "durationDays",
                true,
              ],
              ["Best time to call", `${plan.localTime} ${plan.timezone}`, "localTime", true],
              [
                "Attempts",
                `up to ${plan.maxAttempts}, ${plan.retryDelayMinutes} min apart`,
                "maxAttempts",
                true,
              ],
            ] as [string, string, string, boolean][]).map(([label, value, field, mono]) => (
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
                  <ProvenanceMark source={plan.provenance[field]} />
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
            <strong>Seven days means seven calendar days from approval</strong>, not
            seven answered calls. A day nobody picks up still uses up a day. Retries
            may land after the end date; a new day&rsquo;s call may not.
          </p>

          {awaiting ? <PlanDraftControls
              planId={plan.id}
              durationDays={plan.durationDays}
              localTime={plan.localTime}
              timeScale={plan.timeScale}
              cadence={plan.cadence}
              maxAttempts={plan.maxAttempts}
            /> : null}
        </div>
      </Panel>

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
                      <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                        {ANSWER_LABEL[q.answerType]}
                        {q.enumValues ? `: ${q.enumValues.join(", ")}` : ""} · {q.questionId}
                        {q.source === "locked" ? " · locked" : ""}
                      </span>
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
                      · {q.questionId} · locked
                    </span>
                  </li>
                ))}
              </ul>
              <p
                className="measure"
                style={{ margin: "calc(var(--cell) * 1.5) 0 0", color: "var(--print-3)", fontSize: 13 }}
              >
                The agent listens for these rather than putting them to the patient.
                Asking someone whether they would like a callback invites a polite
                yes; noticing that they asked for one is the thing the rule is for.
              </p>
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
              These will never be asked. They are shown rather than deleted,
              because a model attempting to give advice is something you should
              see. Rewriting one puts it back through the guard; nothing here can
              be approved any other way.
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
                        <span className="mono">&ldquo;{f.match}&rdquo;</span> — {f.reason}
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
                  {r.source === "locked" ? " · locked" : ""}
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

      <Panel title="The consultation note" style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <div style={{ padding: "calc(var(--cell) * 3)" }}>
          <p
            className="mono"
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              color: "var(--print-2)",
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            {plan.noteBody}
          </p>

        </div>
      </Panel>

      {awaiting ? (
        <>
        <ApprovePlan
          planId={plan.id}
          patientId={plan.patientId}
          canApprove={approved.length > 0}
          refusedQuestions={rejected.length}
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
                  "ring. The plan will run and every call will be refused with a " +
                  "reason on the record.",
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
        <p style={{ margin: "calc(var(--cell) * 2) 0 0" }}>
          <CancelPlan planId={plan.id} patientId={plan.patientId} draft />
        </p>
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
  );
}
