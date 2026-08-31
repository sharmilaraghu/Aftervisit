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

import { Badge, Button, Panel } from "@/components/ui";
import { ApprovePlan, PlanDraftControls } from "@/components/PlanReview";
import { RuleEditor } from "@/components/RuleEditor";
import { CancelPlan } from "@/components/CancelPlan";
import { getPlanForReview } from "@/lib/db/plans";
import { formatStamp } from "@/lib/format";
import { maskPhone } from "@/lib/phone/normalize";
import { readConfig } from "@/lib/config";
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

const CONSENT_SENTENCE: Record<string, string> = {
  granted: "Already agreed",
  declined: "Declined — will not be called",
  unknown: "Not asked — the first call opens with the consent gate",
};

const ANSWER_LABEL: Record<string, string> = {
  boolean: "yes / no",
  scale_0_10: "0–10",
  enum: "one of",
  text: "their own words",
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlanForReview(id);
  if (!plan) notFound();

  const approved = plan.questions.filter((q) => q.guardStatus === "approved");
  const rejected = plan.questions.filter((q) => q.guardStatus !== "approved");
  const awaiting = plan.status === "awaiting_approval";
  /* A rule's checkboxes offer exactly what its question can actually answer. */
  const questionEnums = Object.fromEntries(
    plan.questions
      .filter((q) => q.enumValues?.length)
      .map((q) => [q.questionId, q.enumValues as string[]]),
  );

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
        maxWidth: 940,
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header style={{ marginBottom: "calc(var(--cell) * 4)" }}>
        <p style={{ margin: "0 0 calc(var(--cell) * 1)" }}>
          <Button variant="ghost" href={`/patients/${plan.patientId}`}>
            {plan.patientName}
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
        <p className="mono" style={{ margin: 0, color: "var(--bench-ink-2)", fontSize: 14 }}>
          {maskPhone(plan.phoneE164)} · {plan.timezone}
          {plan.compileProvider ? ` · compiled by ${plan.compileProvider} (${plan.compileModel})` : ""}
        </p>
      </header>

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
            {[
              ["Following up on", plan.reason, "reason"],
              ["Cadence", `${plan.cadence.replace(/_/g, " ")} · ${plan.durationDays} days`, "durationDays"],
              ["Local time", `${plan.localTime} ${plan.timezone}`, "localTime"],
              ["Attempts", `up to ${plan.maxAttempts}, ${plan.retryDelayMinutes} min apart`, "maxAttempts"],
            ].map(([label, value, field]) => (
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
                <dd style={{ margin: 0, fontSize: 15, color: "var(--print)", lineHeight: 1.4 }}>
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

          {awaiting ? <PlanDraftControls planId={plan.id} durationDays={plan.durationDays} localTime={plan.localTime} timeScale={plan.timeScale} /> : null}
        </div>
      </Panel>

      <Panel
        title="What it will ask"
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
                  <span style={{ display: "block", color: "var(--print)", fontSize: 15 }}>
                    {q.prompt}
                  </span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                    {ANSWER_LABEL[q.answerType]}
                    {q.enumValues ? `: ${q.enumValues.join(", ")}` : ""} · {q.questionId}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Panel>

      {rejected.length > 0 ? (
        <Panel
          title="Refused by the clinical guard"
          aside={<Badge tone="danger">{rejected.length} refused</Badge>}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          <div style={{ padding: "calc(var(--cell) * 3)" }}>
            <p style={{ margin: "0 0 calc(var(--cell) * 2)", color: "var(--print-2)", fontSize: 14 }}>
              These were produced but will never be asked. They are shown rather
              than deleted, because a model attempting to give advice is
              something you should see.
            </p>
            {rejected.map((q) => (
              <div key={q.id} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
                <p style={{ margin: "0 0 calc(var(--cell) * 0.5)", color: "var(--print)" }}>
                  &ldquo;{q.prompt}&rdquo;
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 0.75)" }}>
                  {(q.guardFindings ?? []).map((f, i) => (
                    <Badge key={i} tone="danger" quiet>
                      {f.category.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="What escalates"
        aside={
          <Badge tone="plain" quiet>
            {plan.rules.length} rules
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
          <RuleEditor
            planId={plan.id}
            initial={plan.rules}
            questionEnums={questionEnums}
            live={plan.status !== "awaiting_approval"}
          />
        )}
      </Panel>

      <Panel title="Your note" style={{ marginBottom: "calc(var(--cell) * 3)" }}>
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
        <ApprovePlan
          planId={plan.id}
          canApprove={approved.length > 0}
          patientName={plan.patientName}
          maskedPhone={maskPhone(plan.phoneE164)}
          {...preview}
          timezone={plan.timezone}
          maxAttempts={plan.maxAttempts}
          consent={CONSENT_SENTENCE[plan.consent] ?? "Not asked yet"}
          allowlisted={
            readConfig().allowlistOpen || readConfig().callAllowlist.includes(plan.phoneE164)
          }
          allowlistOpen={readConfig().allowlistOpen}
        />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)", alignItems: "center" }}>
          <Button variant="ghost" href={`/patients/${plan.patientId}`}>
            See the calendar
          </Button>
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
