/**
 * The practice's last fourteen days, as stacked columns.
 *
 * The one graph in this product, and it earns its place by answering a question
 * no table on the console answers: *did something break, and when?* A run of
 * green that turns amber on Tuesday is a systemic fact — a line went down, a
 * clinic closed, the scheduler stopped — and it is invisible in fourteen rows of
 * counts, which a doctor would have to difference in their head.
 *
 * **It is drawn from the stock, not plotted by a library.** There is no chart
 * package here and no `public/` directory, and this needs neither: it is the
 * week band's own grammar — fixed cells on a shared axis, colour arriving as a
 * printed block — extended from seven columns to fourteen and given height.
 * Same tones, same rules, same 8px cell.
 *
 * **No line chart, and that is deliberate.** A line implies a continuous
 * quantity sampled over time. This is a count of discrete events per day, and
 * some days are zero because nothing was scheduled rather than because nothing
 * was reached. A column that is simply absent says that honestly; a line would
 * interpolate straight through it and draw a trend that never happened.
 *
 * Every column carries its numbers in a `title` and the whole figure carries a
 * table-shaped description, because a chart nobody can read is a chart that
 * excludes people — and colour alone is never the information in this product.
 */

import type { DayColumn } from "@/lib/db/dashboard";

/** Tallest column in the window, floored so a quiet fortnight is not all-max. */
function ceiling(days: DayColumn[]): number {
  const tallest = Math.max(...days.map((d) => d.answered + d.flagged + d.missed), 0);
  return Math.max(tallest, 4);
}

const BAND = 96;

export function Fortnight({ days }: { days: DayColumn[] }) {
  const total = days.reduce((n, d) => n + d.answered + d.flagged + d.missed, 0);

  if (total === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 3)",
          color: "var(--print-2)",
          fontSize: 14,
        }}
      >
        No calls have finished in the last fourteen days. This fills in as the
        scheduler works through the plans you have approved.
      </p>
    );
  }

  const max = ceiling(days);

  return (
    <div style={{ padding: "calc(var(--cell) * 3)" }}>
      <div
        role="img"
        aria-label={
          `Calls finished on each of the last fourteen days. ` +
          days
            .map((d) => {
              const n = d.answered + d.flagged + d.missed;
              return n === 0
                ? `${label(d.day)}: none`
                : `${label(d.day)}: ${d.answered} answered, ${d.flagged} flagged, ${d.missed} not reached`;
            })
            .join(". ")
        }
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "calc(var(--cell) * 0.75)",
          height: BAND,
          /* The baseline the columns stand on. Without it a fortnight of small
             counts floats in the middle of the sheet with nothing to sit on. */
          borderBottom: "1px solid var(--rule-ink)",
        }}
      >
        {days.map((d) => {
          const n = d.answered + d.flagged + d.missed;
          return (
            <div
              key={d.day}
              /* Numbers, not just colour — and on the column itself, because a
                 legend at the foot is a second thing to look at. */
              title={
                n === 0
                  ? `${label(d.day)} — no calls finished`
                  : `${label(d.day)} — ${d.answered} answered · ${d.flagged} flagged · ${d.missed} not reached`
              }
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                height: "100%",
                minWidth: 8,
              }}
            >
              {/* Stacked worst-on-top, so the eye reads down to the flags. */}
              <Segment n={d.flagged} max={max} fill="var(--danger)" />
              <Segment n={d.missed} max={max} fill="var(--amber)" />
              <Segment n={d.answered} max={max} fill="var(--clear)" />
              {n === 0 ? (
                /* A day with nothing is drawn as a hairline on the baseline
                   rather than left blank: "no calls" and "off the end of the
                   window" must not look the same. */
                <span style={{ height: 1, background: "var(--rule)" }} />
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "calc(var(--cell) * 1)",
        }}
      >
        {/* Two dates, not fourteen. Fourteen labels at this width overlap into a
            smear, and the axis only has to say what window you are looking at. */}
        <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
          {label(days[0].day)}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--print-3)" }}>
          {label(days[days.length - 1].day)}
        </span>
      </div>
    </div>
  );
}

function Segment({ n, max, fill }: { n: number; max: number; fill: string }) {
  if (n === 0) return null;
  return (
    <span
      style={{
        display: "block",
        /* One call must still be a visible block, so every segment clears 3px
           however tall the window's busiest day is. */
        height: Math.max(3, Math.round((n / max) * BAND)),
        background: fill,
      }}
    />
  );
}

/** "3 Sep". The columns are days of the practice's own week, not timestamps. */
function label(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(y, m - 1, d),
  );
}
