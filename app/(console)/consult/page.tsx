/**
 * Consults: the doctor's day.
 *
 * A row is a patient and what they say is wrong. Opening one is the whole
 * clinical workflow — read, examine, write the note — and the note is what
 * turns this row into a plan. A visit stays on the list until that happens,
 * which is the point: a patient the desk registered and nobody saw is not a
 * thing this list lets go quiet. That is why an overdue visit gets its own tab
 * and is named on Today's, rather than falling off the day it was booked for.
 */

import Link from "next/link";

import {
  Avatar,
  Badge,
  Button,
  Notice,
  Panel,
  Segmented,
} from "@/components/ui";
import {
  getSeenVisitsOn,
  getWaitingVisits,
  type SeenVisit,
  type WaitingVisit,
} from "@/lib/db/visits";
import { CONSENT_LABEL, CONSENT_TONE } from "@/lib/patients/labels";
import { localDate } from "@/lib/time/clock";
import { PRACTICE_TIMEZONE } from "@/lib/patients/timezones";
import { formatCalendarDay } from "@/lib/format";
import type { VisitKind } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

const VISIT_KIND_LABEL: Record<VisitKind, string> = {
  consultation: "Consultation",
  post_op: "Post-op",
};

type Day = "today" | "upcoming" | "overdue";
const DAYS: readonly Day[] = ["today", "upcoming", "overdue"];

function Row({
  visit,
  href,
  next,
  landed,
}: {
  visit: WaitingVisit;
  href: string;
  next: string;
  landed: boolean;
}) {
  /* Consent is a fact about the patient, so it sits with the patient's
     details; the right edge is kept for the visit and the one thing to do. */
  return (
    <div className={landed ? "visit-row row-landed" : "visit-row"}>
      <Avatar name={visit.patientName} />
      <div className="visit-body">
        <p style={{ margin: "0 0 calc(var(--cell) * 0.5)", fontSize: 17, fontWeight: 700 }}>
          {visit.patientName}
        </p>
        <p
          className="mono"
          style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)", fontSize: 13 }}
        >
          {/* No phone number: this is the doctor's list, and the doctor
              never dials from it. The front desk's screens keep the number. */}
          {visit.age} ·{" "}
          <span style={{ whiteSpace: "nowrap" }}>{formatCalendarDay(visit.visitDate)}</span>
        </p>
        <p
          className="measure"
          style={{ margin: "0 0 calc(var(--cell) * 1.25)", fontSize: 14, lineHeight: 1.5 }}
        >
          {visit.reportedSymptoms}
        </p>
        <Badge tone={CONSENT_TONE[visit.consent]} quiet>
          {CONSENT_LABEL[visit.consent]}
        </Badge>
      </div>
      <div className="visit-tags">
        <Badge tone="plain" quiet>
          {VISIT_KIND_LABEL[visit.kind]}
        </Badge>
        <Button
          variant="onLabel"
          href={href}
          className="visit-cta"
          ariaLabel={`${next}: ${visit.patientName}`}
        >
          {next}
        </Button>
      </div>
    </div>
  );
}

const TITLE: Record<Day, (n: number) => string> = {
  today: (n) =>
    n === 0 ? "Nobody is waiting today." : n === 1 ? "One patient waiting today." : `${n} patients waiting today.`,
  upcoming: (n) =>
    n === 0 ? "Nothing booked ahead." : n === 1 ? "One visit booked ahead." : `${n} visits booked ahead.`,
  overdue: (n) =>
    n === 0 ? "Nothing overdue." : n === 1 ? "One visit from an earlier day." : `${n} visits from earlier days.`,
};

const PANEL_TITLE: Record<Day, string> = {
  today: "Waiting",
  upcoming: "Booked ahead",
  overdue: "Overdue",
};

export default async function ConsultPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; registered?: string }>;
}) {
  const { day: dayParam, registered } = await searchParams;
  const day: Day = DAYS.includes(dayParam as Day) ? (dayParam as Day) : "today";

  const visits = await getWaitingVisits();

  /* "Today" on the practice's clock. A server in another zone must not push a
     booking for this morning into "booked ahead". */
  const today = localDate(new Date(), PRACTICE_TIMEZONE);
  const seen: SeenVisit[] = await getSeenVisitsOn(today);

  const buckets: Record<Day, WaitingVisit[]> = {
    today: visits.filter((v) => v.visitDate === today),
    upcoming: visits.filter((v) => v.visitDate > today),
    overdue: visits.filter((v) => v.visitDate < today),
  };
  const shown = buckets[day];
  const justRegistered = registered ? visits.find((v) => v.id === registered) : undefined;

  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        padding: "calc(var(--cell) * 5) calc(var(--cell) * 3) calc(var(--cell) * 10)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 3)",
          marginBottom: "calc(var(--cell) * 3)",
        }}
      >
        <div>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: "0 0 calc(var(--cell) * 1)",
              color: "var(--bench-ink)",
            }}
          >
            {TITLE[day](shown.length)}
          </h1>
          {/* The day's progress, in one line. It was a four-cell figure row
              that repeated the counts on the tabs directly beneath it. */}
          <p style={{ margin: 0, color: "var(--bench-ink-2)" }}>
            {day === "today" ? (
              <>
                <span className="mono">{buckets.today.length}</span> waiting ·{" "}
                <span className="mono">{seen.length}</span> seen
              </>
            ) : day === "upcoming" ? (
              "Booked for a later day."
            ) : (
              "Booked for an earlier day and not yet seen."
            )}
          </p>
        </div>
        {visits.length === 0 ? (
          <span style={{ marginLeft: "auto" }}>
            {/* The page's one amber, and only when there is nothing else to do here. */}
            <Button variant="primary" href="/register">
              Register a patient
            </Button>
          </span>
        ) : null}
      </header>

      {justRegistered ? (
        <Notice label="Registered">
          {justRegistered.patientName} is booked for{" "}
          <span className="mono">{formatCalendarDay(justRegistered.visitDate)}</span> and is on the list below.
        </Notice>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "calc(var(--cell) * 2)",
          marginBottom: "calc(var(--cell) * 2)",
        }}
      >
        <Segmented
          label="Which day"
          current={day}
          options={[
            { key: "today", label: "Today", count: buckets.today.length, href: "/consult" },
            {
              key: "upcoming",
              label: "Booked ahead",
              count: buckets.upcoming.length,
              href: "/consult?day=upcoming",
            },
            {
              key: "overdue",
              label: "Overdue",
              count: buckets.overdue.length,
              href: "/consult?day=overdue",
            },
          ]}
        />
        {day === "today" && buckets.overdue.length > 0 ? (
          <Link href="/consult?day=overdue" style={{ textDecoration: "none" }}>
            <Badge tone="plain" quiet>
              {buckets.overdue.length} still waiting from earlier days
            </Badge>
          </Link>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <Panel
          title={PANEL_TITLE[day]}
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {shown.length}
            </span>
          }
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          {shown.map((v) => (
            <Row
              key={v.id}
              visit={v}
              href={`/consult/${v.id}`}
              next="Write note"
              landed={v.id === registered}
            />
          ))}
        </Panel>
      ) : (
        <Panel title={PANEL_TITLE[day]} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}>
            {day === "today"
              ? "Nobody is booked for today. The front desk registers a patient from Patients and books the visit; it appears here until you write its note. The follow-up is compiled from that note, and nothing is dialled until you approve it."
              : day === "upcoming"
                ? "No visits are booked for a later day."
                : "Every visit from an earlier day has been seen."}
          </p>
          {/* A next step, not a dead end. Outlined: when the list is not empty
              the page's one amber belongs to the rows' work, not to this. */}
          {day !== "overdue" && visits.length > 0 ? (
            <div style={{ padding: "0 calc(var(--cell) * 3) calc(var(--cell) * 3)" }}>
              <Button variant="onLabel" href="/register">
                Register a patient
              </Button>
            </div>
          ) : null}
        </Panel>
      )}

      {day === "today" && seen.length > 0 ? (
        <Panel
          title="Seen today"
          aside={
            <span className="caps mono" style={{ color: "var(--print-3)" }}>
              {seen.length}
            </span>
          }
        >
          {seen.map((v) => (
            <Row
              key={v.id}
              visit={v}
              href={v.planId ? `/plans/${v.planId}` : `/patients/${v.patientId}`}
              next={v.planId ? "Open plan" : "Open record"}
              landed={false}
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
