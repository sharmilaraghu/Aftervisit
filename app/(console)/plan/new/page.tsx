/**
 * Writing a follow-up, all five steps, one route.
 *
 * Steps 1 to 3 are panes of a single client form; 4 and 5 are rendered here
 * because they need the compiled questions, and those do not exist until the
 * form is submitted. The seam is deliberate and it is the only one: before it
 * nothing has been written, after it the draft is a row and every edit is an
 * edit to the plan itself. That is what makes going back from step 4 safe —
 * there is no half-state to lose, because there is no half-state.
 *
 * `?patient=` is the returning patient: step 1 opens on their record and
 * nothing clinical comes with it.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, Button, Panel } from "@/components/ui";
import { Wizard } from "@/components/Wizard";
import { Stepper } from "@/components/Stepper";
import { ApprovePlan, PlanDraftControls } from "@/components/PlanReview";
import { AddQuestion, QuestionRow } from "@/components/QuestionEditor";
import { EscalationSetup } from "@/components/EscalationSetup";
import { CancelPlan } from "@/components/CancelPlan";
import { revisePlanAction, startPlanAction } from "@/app/(console)/patients/actions";
import { EMPTY_PATIENT_FORM } from "@/lib/patients/form";
import { getPatient } from "@/lib/db/patients";
import { getPlanForReview } from "@/lib/db/plans";
import { hasProvider } from "@/lib/plan/provider";
import { ANSWER_LABEL } from "@/lib/plan/clinician-question";
import { OBSERVED_QUESTION_IDS } from "@/lib/plan/universal-questions";
import { LANGUAGE_OPTIONS } from "@/lib/patients/languages";
import { CONSENT_LABEL } from "@/lib/patients/labels";
import { expandPlan } from "@/lib/schedule/expand";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import { readConfig } from "@/lib/config";
import { REFUSAL_TEXT } from "@/lib/calle/port";

export const dynamic = "force-dynamic";

const CONSENT_SENTENCE: Record<string, string> = {
  granted: CONSENT_LABEL.granted,
  declined: CONSENT_LABEL.declined,
  unknown: "Not recorded — nothing will be dialled until it is",
};

const SHELL = {
  maxWidth: 944,
  margin: "0 auto",
  padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
} as const;

/**
 * Whether approving will genuinely make this phone ring, and why not.
 *
 * Consent first, because consent is the gate — `dial()` refuses anything but
 * `granted`. Both other causes are checked because "no key configured" and
 * "number outside the list" produce the same silence and need different fixes.
 */
function dialability(consent: string, phoneE164: string) {
  const config = readConfig();
  if (consent !== "granted") {
    return { willRing: false, blockedReason: REFUSAL_TEXT.no_consent };
  }
  if (!config.liveCallsEnabled) {
    return {
      willRing: false,
      blockedReason:
        "This instance is not configured to place calls, so nothing will ring. The " +
        "plan will run and every call will be refused with a reason on the record.",
    };
  }
  if (!(config.allowlistOpen || config.callAllowlist.includes(phoneE164))) {
    return {
      willRing: false,
      blockedReason:
        "CARELOOP_CALL_ALLOWLIST is set on this deployment, and this number is not " +
        "on it. Clear that variable to let consent be the only gate.",
    };
  }
  return { willRing: true, blockedReason: null };
}

export default async function PlanWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; patient?: string; step?: string }>;
}) {
  const { plan: planId, patient: patientId, step } = await searchParams;

  /* ------------------------------------------------------------ steps 1 to 3 */
  if (!planId) {
    const patient = patientId ? await getPatient(patientId) : null;
    if (patientId && !patient) notFound();

    return (
      <div style={SHELL}>
        <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: 0,
              color: "var(--bench-ink)",
            }}
          >
            {patient ? `New follow-up for ${patient.name}.` : "Add a patient."}
          </h1>
        </header>

        <Wizard
          action={startPlanAction}
          patientId={patient?.id}
          canCompile={hasProvider()}
          initial={{
            errors: {},
            values: {
              ...EMPTY_PATIENT_FORM.values,
              /* A returning patient keeps their record and nothing else. The
                 note, the escalating conditions and the schedule are about the
                 problem they have come back with, not the last one. */
              name: patient?.name ?? "",
              age: patient ? String(patient.age) : "",
              phone: patient?.phoneE164 ?? "",
              timezone: patient?.timezone ?? "",
              language: patient?.language ?? "en-US",
              consent: patient?.aiCallConsent ?? "unknown",
            },
          }}
        />
      </div>
    );
  }

  /* ------------------------------------------------------------ steps 4 and 5 */
  const plan = await getPlanForReview(planId);
  if (!plan) notFound();

  /* An approved plan is no longer a draft, and its questions cannot change
     under calls already placed against them. */
  if (plan.status !== "awaiting_approval") redirect(`/plans/${plan.id}`);

  /*
   * Stepping back into a compiled draft. The form opens on the saved values —
   * the patient's record, the note as written, and whatever schedule the plan
   * ended up with, whether the doctor chose it or the note implied it.
   */
  if (step === "1" || step === "2" || step === "3") {
    return (
      <div style={SHELL}>
        <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
          <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
            <Link href={`/plan/new?plan=${plan.id}&step=4`} className="backlink">
              Back to the questions
            </Link>
          </p>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: 0,
              color: "var(--bench-ink)",
            }}
          >
            {plan.patientName}.
          </h1>
        </header>

        <Wizard
          action={revisePlanAction}
          patientId={plan.patientId}
          planId={plan.id}
          canCompile={hasProvider()}
          openAt={Number(step) as 1 | 2 | 3}
          initial={{
            errors: {},
            values: {
              ...EMPTY_PATIENT_FORM.values,
              name: plan.patientName,
              age: String(plan.patientAge),
              phone: plan.phoneE164,
              timezone: plan.timezone,
              language: plan.language,
              consent: plan.consent,
              note: plan.noteBody,
              escalationNote: plan.escalationNote ?? "",
              timeScale: String(plan.timeScale),
              localTime: plan.localTime,
              cadence: plan.cadence,
              durationDays: String(plan.durationDays),
            },
          }}
        />
      </div>
    );
  }

  const at = step === "5" ? 5 : 4;

  /*
   * Observations are not questions and must not be listed as if the agent will
   * read them out. It does not; it records whether the patient asked for a
   * person, whenever they did.
   */
  const approved = plan.questions.filter(
    (q) => q.guardStatus === "approved" && !OBSERVED_QUESTION_IDS.has(q.questionId),
  );
  const observed = plan.questions.filter(
    (q) => q.guardStatus === "approved" && OBSERVED_QUESTION_IDS.has(q.questionId),
  );
  const rejected = plan.questions.filter((q) => q.guardStatus !== "approved");

  /* The same expansion the approve action will run, previewed. A doctor should
     be told the real time of the first call before they authorise it. */
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

  return (
    <div style={SHELL}>
      <header style={{ marginBottom: "calc(var(--cell) * 3)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Link href={`/patients/${plan.patientId}`} className="backlink">
            Back to {plan.patientName}
          </Link>
        </p>
        <h1
          className="display"
          style={{
            fontSize: "clamp(28px, 3.6vw, 44px)",
            margin: 0,
            color: "var(--bench-ink)",
          }}
        >
          {at === 4 ? "What it will ask." : "Approve this plan?"}
        </h1>
      </header>

      {/* Steps 1 to 3 are behind a route now, so the stepper links back into
          the form rather than switching a pane. */}
      <Stepper current={at} reached={5} planId={plan.id} />

      {at === 4 ? (
        <>
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
                        editable={q.source !== "locked"}
                        reorderable={q.source !== "locked"}
                        meta={
                          <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                            {ANSWER_LABEL[q.answerType]}
                            {q.enumValues ? `: ${q.enumValues.join(", ")}` : ""} ·{" "}
                            {q.source === "note"
                              ? "from your note"
                              : q.source === "clinician"
                                ? "you added this"
                                : q.source === "locked"
                                  ? "locked"
                                  : "defaulted"}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ol>
              )}

              <AddQuestion planId={plan.id} />

              {observed.length > 0 ? (
                <div
                  style={{
                    marginTop: "calc(var(--cell) * 3)",
                    paddingTop: "calc(var(--cell) * 2.5)",
                    borderTop: "1px solid var(--rule)",
                  }}
                >
                  <p
                    className="caps"
                    style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}
                  >
                    Recorded from the call, never asked
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "calc(var(--cell) * 3)" }}>
                    {observed.map((q) => (
                      <li
                        key={q.id}
                        style={{ color: "var(--print-2)", fontSize: 14, marginBottom: 4 }}
                      >
                        {q.prompt}{" "}
                        <span className="mono" style={{ fontSize: 13, color: "var(--print-3)" }}>
                          · locked
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p
                    className="measure"
                    style={{
                      margin: "calc(var(--cell) * 1.5) 0 0",
                      color: "var(--print-3)",
                      fontSize: 13,
                    }}
                  >
                    Asking whether someone would like a callback invites a polite
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
                <p
                  style={{
                    margin: "0 0 calc(var(--cell) * 2)",
                    color: "var(--print-2)",
                    fontSize: 14,
                  }}
                >
                  {/*
                    Not a nicety: `assembleTask` refuses to build a script while
                    any question on the plan is unapproved, so this plan dials
                    nothing until each one is rewritten or removed.
                  */}
                  <strong>A plan with a refused question does not dial at all.</strong>{" "}
                  Rewrite each one or remove it. They are shown rather than deleted,
                  because a model attempting to give advice is something you should see.
                </p>
                {rejected.map((q) => (
                  <div key={q.id} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
                    <QuestionRow
                      planId={plan.id}
                      questionId={q.id}
                      prompt={q.prompt}
                      quoted
                      editable={q.source !== "locked"}
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
                          <span
                            style={{ fontSize: 13, color: "var(--print-2)", lineHeight: 1.45 }}
                          >
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

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "center",
            }}
          >
            <Button variant="ghost" href={`/plan/new?plan=${plan.id}&step=3`}>
              Back
            </Button>
            <Button variant="primary" href={`/plan/new?plan=${plan.id}&step=5`}>
              Review the plan
            </Button>
          </div>
        </>
      ) : (
        <>
          <Panel title="The schedule" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
            <div style={{ padding: "calc(var(--cell) * 3)" }}>
              <p
                style={{
                  margin: "0 0 calc(var(--cell) * 2)",
                  color: "var(--print-2)",
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                <strong>
                  {plan.durationDays} days means {plan.durationDays} calendar days from
                  approval
                </strong>
                , not {plan.durationDays} answered calls. A day nobody picks up still
                uses up a day.
              </p>
              <PlanDraftControls
                planId={plan.id}
                durationDays={plan.durationDays}
                localTime={plan.localTime}
                timeScale={plan.timeScale}
                cadence={plan.cadence}
                maxAttempts={plan.maxAttempts}
              />
            </div>
          </Panel>

          <Panel
            title="The escalation rules"
            aside={
              <Badge tone="plain" quiet>
                {/* Distinct: two lists can carry the same word. */}
                <span className="mono">
                  {new Set(plan.redFlagTerms.map((t) => t.term.toLowerCase())).size}
                </span>{" "}
                words · <span className="mono">{plan.rules.length}</span> rules
              </Badge>
            }
            style={{ marginBottom: "calc(var(--cell) * 2)" }}
          >
            <EscalationSetup
              planId={plan.id}
              escalationNote={plan.escalationNote}
              terms={plan.redFlagTerms}
              live={false}
            />
          </Panel>

          <Panel title="The consultation note" style={{ marginBottom: "calc(var(--cell) * 3)" }}>
            <div style={{ padding: "calc(var(--cell) * 3)" }}>
              <p
                className="mono measure"
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

          <ApprovePlan
            planId={plan.id}
            patientId={plan.patientId}
            canApprove={approved.length > 0}
            refusedQuestions={rejected.length}
            patientName={plan.patientName}
            maskedPhone={maskPhone(plan.phoneE164)}
            firstCallAt={
              expansion.occurrences[0]
                ? formatStamp(expansion.occurrences[0].scheduledFor, plan.timezone)
                : "—"
            }
            calls={expansion.occurrences.length}
            timezone={plan.timezone}
            maxAttempts={plan.maxAttempts}
            consent={CONSENT_SENTENCE[plan.consent] ?? "Not asked yet"}
            language={
              LANGUAGE_OPTIONS.find((o) => o.value === plan.language)?.label ?? plan.language
            }
            {...dialability(plan.consent, plan.phoneE164)}
          />

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "calc(var(--cell) * 1.5)",
              alignItems: "center",
              marginTop: "calc(var(--cell) * 2)",
            }}
          >
            <Link href={`/plan/new?plan=${plan.id}&step=4`} className="backlink">
              Back to the questions
            </Link>
            <CancelPlan planId={plan.id} patientId={plan.patientId} draft />
          </div>
        </>
      )}
    </div>
  );
}
