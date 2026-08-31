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

/** `ESC-0031`. A clinician reads a number, not a uuid. */
export function escalationRef(ref: number): string {
  return `ESC-${String(ref).padStart(4, "0")}`;
}
