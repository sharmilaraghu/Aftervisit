/**
 * Consults: the doctor's day.
 *
 * A row is a patient and what they say is wrong. Opening one is the whole
 * clinical workflow — read, examine, write the note — and the note is what
 * turns this row into a plan. A visit stays on the list until that happens,
 * or until the doctor says the patient never came: a patient the desk
 * registered and nobody saw is not a thing this list lets go quiet.
 *
 * The day, as figures first. Booked, waiting, seen, didn't turn up — each with
 * the colour the rest of the console gives that state: amber is the work still
 * to do, green is done, blue informs, grey is a fact with nothing to act on.
 * The bar under them is the day's progress at a glance.
 *
 * One list, no tabs. A future visit appears on its date; a missed one sits at
 * the top as "From earlier days" until someone writes its note or marks it.
 *
 * Below the day, "Last 7 days": the seen and didn't-turn-up visits of the
 * week before today. Not "this week" — on a Monday that would be a lie. The figures stay about today; this is only so a
 * morning with nobody booked yet still shows what came before it.
 */

import { Avatar, Badge, Button, Notice, Panel } from "@/components/ui";
import { ArrivedButton, NoShowButton } from "@/components/VisitActions";
import {
  getNoShowsOn,
  getPastVisits,
  getSeenVisitsOn,
  getWaitingVisits,
  type PastVisit,
  type SeenVisit,
  type WaitingVisit,
} from "@/lib/db/visits";
import { addDays, localDate } from "@/lib/time/clock";
import { PRACTICE_TIMEZONE } from "@/lib/patients/timezones";
import { formatCalendarDay } from "@/lib/format";
import type { VisitKind } from "@/lib/db/enums";

export const dynamic = "force-dynamic";

const VISIT_KIND_LABEL: Record<VisitKind, string> = {
  consultation: "Consultation",
  post_op: "Post-op",
};

/* `past` is a visit from an earlier day that ended: it carries its date and how it ended. */
type RowMode = "waiting" | "next" | "seen" | "noshow" | "past";

function Row({
  visit,
  mode,
  href,
  landed = false,
}: {
  visit: WaitingVisit & { status?: string };
  mode: RowMode;
  href: string;
  landed?: boolean;
}) {
  /* Not "Open plan": an approved plan's page redirects to the patient record,
     so the button named a screen the click never reached. */
  const cta = mode === "waiting" || mode === "next" ? "Write note" : "View patient record";
  return (
    <div className={landed ? "visit-row row-landed" : "visit-row"} data-mode={mode}>
      <Avatar name={visit.patientName} />
      <div className="visit-body">
        <p style={{ margin: "0 0 calc(var(--cell) * 0.5)", fontSize: 17, fontWeight: 700 }}>
          {visit.patientName}{" "}
          <span className="mono" style={{ fontSize: 13, fontWeight: 400, color: "var(--print-3)" }}>
            {visit.age}
          </span>
          {mode === "past" ? (
            <span className="mono" style={{ fontSize: 13, fontWeight: 400, color: "var(--print-3)" }}>
              {" · "}
              {formatCalendarDay(visit.visitDate)}
            </span>
          ) : null}
          {mode === "next" ? (
            <span className="visit-next" aria-label="Next patient">
              Next
            </span>
          ) : null}
        </p>
        {/* No phone and no consent badge: this is the doctor's list, and both
            are the front desk's fields. Dialling still refuses without consent. */}
        <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--print-2)" }}>
          {visit.reportedSymptoms}
        </p>
      </div>
      <div className="visit-tags">
        {/* Post-op in blue: it changes what the note has to cover. */}
        <Badge tone={visit.kind === "post_op" ? "info" : "plain"} quiet>
          {VISIT_KIND_LABEL[visit.kind]}
        </Badge>
        {mode === "past" ? (
          <Badge tone={visit.status === "seen" ? "clear" : "plain"} quiet>
            {visit.status === "seen" ? "Seen" : "Didn't turn up"}
          </Badge>
        ) : null}
        {mode === "waiting" || mode === "next" ? (
          <NoShowButton visitId={visit.id} patientName={visit.patientName} />
        ) : null}
        {mode === "noshow" ? (
          <ArrivedButton visitId={visit.id} patientName={visit.patientName} />
        ) : null}
        <Button
          /* The page's one amber: the next patient's note. */
          variant={mode === "next" ? "primary" : "onLabel"}
          href={href}
          className="visit-cta"
          ariaLabel={`${cta}: ${visit.patientName}`}
        >
          {cta}
        </Button>
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="caps mono" style={{ color: "var(--print-3)" }}>
      {n}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="consult-stat" data-tone={tone}>
      <span className="mono consult-stat-value">{value}</span>
      <span className="consult-stat-label">{label}</span>
    </div>
  );
}

export default async function ConsultPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const { registered } = await searchParams;

  const visits = await getWaitingVisits();

  /* "Today" on the practice's clock. A server in another zone must not push a
     booking for this morning onto tomorrow. */
  const today = localDate(new Date(), PRACTICE_TIMEZONE);
  const [seen, noShows, past]: [SeenVisit[], WaitingVisit[], PastVisit[]] = await Promise.all([
    getSeenVisitsOn(today),
    getNoShowsOn(today),
    getPastVisits(addDays(today, -7), today),
  ]);

  const waitingToday = visits.filter((v) => v.visitDate === today);
  const earlier = visits.filter((v) => v.visitDate < today);
  const justRegistered = registered ? visits.find((v) => v.id === registered) : undefined;
  const waiting = waitingToday.length + earlier.length;
  const booked = waitingToday.length + seen.length + noShows.length;
  /* The next note to write: the oldest missed visit, else today's first. */
  const nextId = (earlier[0] ?? waitingToday[0])?.id;

  const row = (v: WaitingVisit) => (
    <Row
      key={v.id}
      visit={v}
      mode={v.id === nextId ? "next" : "waiting"}
      href={`/consult/${v.id}`}
      landed={v.id === registered}
    />
  );

  const pct = (n: number) => (booked === 0 ? 0 : (n / booked) * 100);

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
          <p className="caps mono" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--bench-ink-3)" }}>
            {formatCalendarDay(today)}
          </p>
          <h1
            className="display"
            style={{
              fontSize: "clamp(28px, 3.6vw, 44px)",
              margin: 0,
              color: "var(--bench-ink)",
            }}
          >
            {waiting === 0
              ? booked > 0
                ? "Everyone is seen."
                : "Nobody is waiting today."
              : waiting === 1
                ? "One patient waiting."
                : `${waiting} patients waiting.`}
          </h1>
        </div>
        {/* No "Register a patient" here. Registering and booking are the front
            desk's work, on Patients; this is the doctor's day. */}
      </header>

      {/* The day in figures, and the same figures as one bar. */}
      <section aria-label="Today in numbers" className="consult-stats">
        <Stat label="Booked today" value={booked} tone="plain" />
        <Stat label="Waiting" value={waiting} tone="amber" />
        <Stat label="Seen" value={seen.length} tone="clear" />
        <Stat label="Didn't turn up" value={noShows.length} tone="muted" />
        {earlier.length > 0 ? <Stat label="From earlier days" value={earlier.length} tone="info" /> : null}
      </section>
      {booked > 0 ? (
        <div className="consult-progress" role="img" aria-label={`${seen.length} of ${booked} seen`}>
          <span data-tone="clear" style={{ width: `${pct(seen.length)}%` }} />
          <span data-tone="muted" style={{ width: `${pct(noShows.length)}%` }} />
          <span data-tone="amber" style={{ width: `${pct(waitingToday.length)}%` }} />
        </div>
      ) : null}

      {justRegistered ? (
        <Notice label="Registered">
          {justRegistered.patientName} is booked for{" "}
          <span className="mono">{formatCalendarDay(justRegistered.visitDate)}</span>
          {justRegistered.visitDate > today
            ? " and will appear here on that day."
            : " and is on the list below."}
        </Notice>
      ) : null}

      {/* First, because it is the one that can go quiet: booked, never seen,
          and no plan — so nobody will ever phone them. */}
      {earlier.length > 0 ? (
        <Panel
          title="From earlier days — not yet seen"
          aside={<Count n={earlier.length} />}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          {earlier.map(row)}
        </Panel>
      ) : null}

      {waitingToday.length > 0 ? (
        <Panel
          title="Waiting"
          aside={<Count n={waitingToday.length} />}
          style={{ marginBottom: "calc(var(--cell) * 2)" }}
        >
          {waitingToday.map(row)}
        </Panel>
      ) : booked === 0 ? (
        <Panel title="Waiting" style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          <p className="measure" style={{ margin: 0, padding: "calc(var(--cell) * 3)", fontSize: 14 }}>
            Nobody is booked for today. The front desk registers a patient from Patients and
            books the visit; it appears here on that day until you write its note. The follow-up
            is read from that note, and its calls start when you save it.
          </p>
        </Panel>
      ) : null}

      {seen.length > 0 ? (
        <Panel title="Seen today" aside={<Count n={seen.length} />} style={{ marginBottom: "calc(var(--cell) * 2)" }}>
          {seen.map((v) => (
            <Row key={v.id} visit={v} mode="seen" href={`/followups/${v.patientId}`} />
          ))}
        </Panel>
      ) : null}

      {/* Handed back to the front desk: the roster still shows them as needing
          a plan, which is where a rebooking starts. */}
      {noShows.length > 0 ? (
        <Panel title="Didn't turn up" aside={<Count n={noShows.length} />}>
          {noShows.map((v) => (
            <Row key={v.id} visit={v} mode="noshow" href={`/followups/${v.patientId}`} />
          ))}
        </Panel>
      ) : null}

      {/* The week before today, after the fact. A seen visit opens its follow-up;
          one nobody came to opens the desk record, where a rebooking starts. */}
      {past.length > 0 ? (
        <Panel
          title="Last 7 days"
          aside={<Count n={past.length} />}
          style={{ marginTop: "calc(var(--cell) * 2)" }}
        >
          {past.map((v) => (
            <Row
              key={v.id}
              visit={v}
              mode="past"
              href={v.status === "seen" ? `/followups/${v.patientId}` : `/patients/${v.patientId}`}
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
