/**
 * Display formatting.
 *
 * Timestamps are always rendered in the *patient's* timezone, never the
 * server's. A clinician reading "17:31" needs it to be the time the patient
 * experienced, or the whole daily-cadence story stops making sense.
 */

/** "19 Aug · 17:31", in the given IANA zone. */
export function formatStamp(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} · ${time}`;
}

/**
 * "19 Aug 2026", in the given zone.
 *
 * For things that happened weeks ago, where the hour is noise and the year is
 * the fact you actually need.
 */
export function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** `ESC-0031`. A clinician reads a number, not a uuid. */
/**
 * A calendar day (`YYYY-MM-DD`) in the console's one display format.
 *
 * A visit date is a day, not an instant, so it is read at noon UTC and printed
 * in UTC — no zone can move it across midnight. It used to print raw ISO next
 * to "11 Sept" elsewhere on the same screen.
 */
export function formatCalendarDay(isoDate: string): string {
  return formatDay(new Date(`${isoDate}T12:00:00Z`), "UTC");
}

export function escalationRef(ref: number): string {
  return `ESC-${String(ref).padStart(4, "0")}`;
}
