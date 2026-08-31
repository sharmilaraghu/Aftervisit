/**
 * Time, as a value that gets passed in.
 *
 * The rule engine must be pure, and a function that calls `Date.now()` is not:
 * it cannot be tested at a boundary, and "escalation is never model judgment"
 * stops being checkable if the answer depends on when you ask. So `now` is an
 * argument everywhere, and this file holds the only places that read a clock.
 */

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** A frozen clock, for tests and for a tick that must see one consistent instant. */
export function fixedClock(at: Date | string | number): Clock {
  const frozen = new Date(at);
  return () => frozen;
}

/** The calendar date in a given zone, as `YYYY-MM-DD`. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Whole calendar days between two instants, counted in one zone.
 *
 * Days, not elapsed hours. "Quiet for one day" has to mean "we did not hear
 * from them yesterday" — a date-boundary question. Measured as a duration, a
 * call at 23:50 last night reads as 0 days ago all through today.
 */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const a = Date.parse(`${localDate(from, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(to, timeZone)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * The UTC instant of a local wall-clock time on a given calendar day in a zone.
 *
 * This is the one piece of date arithmetic the scheduler cannot get wrong: it is
 * what makes "10:00 daily" mean 10:00 where the patient lives, across a
 * daylight-saving change, rather than a fixed offset from the server.
 *
 * Done by probing rather than by an offset table — guess the instant, ask what
 * local time that actually was, and correct by the difference. Two passes settle
 * it even on a day whose offset shifts.
 */
export function zonedTimeToUtc(
  isoDate: string,
  hhmm: string,
  timeZone: string,
): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  let guess = new Date(`${isoDate}T${pad(hours)}:${pad(minutes)}:00Z`);

  for (let pass = 0; pass < 2; pass++) {
    const actual = wallClockAt(guess, timeZone);
    const wanted = Date.parse(`${isoDate}T${pad(hours)}:${pad(minutes)}:00Z`);
    const drift = wanted - actual;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift);
  }
  return guess;
}

/** The local wall-clock reading at `instant` in `timeZone`, as a UTC-epoch number. */
function wallClockAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // `en-CA` renders midnight as 24 in some runtimes; normalise it to 00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}Z`,
  );
}

/** Add whole days to a `YYYY-MM-DD` date, staying in calendar days. */
export function addDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
