/**
 * The timezones a clinic can pick from.
 *
 * A short list rather than the full IANA database, because a doctor adding a
 * patient is choosing between a handful of places their practice actually
 * serves, not browsing 400 zone names. `isValidTimezone` still validates
 * anything that arrives, since a select is a convenience and not a guarantee —
 * the value reaches a NOT NULL column that the scheduler depends on.
 */

/**
 * The practice's zone, and every new patient's.
 *
 * Care Loop is deployed in India, so the form no longer offers a choice: a
 * zone picked wrong moves every call by hours, and the only right answer here
 * is always the same one. Existing records keep whatever zone they were saved
 * with until they are edited.
 */
export const PRACTICE_TIMEZONE = "Asia/Kolkata";

export const TIMEZONE_OPTIONS = [
  { value: "Europe/London", label: "Europe/London — UK" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata — India" },
  { value: "Europe/Dublin", label: "Europe/Dublin — Ireland" },
  { value: "America/New_York", label: "America/New_York — US Eastern" },
  { value: "America/Chicago", label: "America/Chicago — US Central" },
  { value: "America/Denver", label: "America/Denver — US Mountain" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles — US Pacific" },
  { value: "Australia/Sydney", label: "Australia/Sydney — Australia East" },
  { value: "Asia/Singapore", label: "Asia/Singapore — Singapore" },
  { value: "Asia/Dubai", label: "Asia/Dubai — UAE" },
];

export function isValidTimezone(value: string): boolean {
  if (!value) return false;
  try {
    // Throws RangeError on an unknown zone. Cheaper and more current than
    // shipping our own copy of the zone list.
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone a number's country code implies.
 *
 * The form used to ship `Europe/London` pre-selected, so a doctor could enrol a
 * patient without ever choosing — and a wrong zone is not cosmetic: it is every
 * call landing at the wrong hour, silently, for the life of the plan. A `+91`
 * number was getting London.
 *
 * This is a suggestion, not a guess made behind anyone's back. It only ever
 * fills a field the doctor has not touched, it is visibly labelled as coming
 * from the number, and it is one click to change. Countries with several zones
 * resolve to nothing rather than to a coin-flip — `+1` spans four US zones and
 * picking one would be exactly the sort of confident wrong answer this product
 * refuses everywhere else.
 */
const DIAL_CODE_ZONES: { code: string; zone: string }[] = [
  { code: "+91", zone: "Asia/Kolkata" },
  { code: "+44", zone: "Europe/London" },
  { code: "+353", zone: "Europe/Dublin" },
  { code: "+65", zone: "Asia/Singapore" },
  { code: "+971", zone: "Asia/Dubai" },
  { code: "+61", zone: "Australia/Sydney" },
];

export function zoneForNumber(phone: string): string | null {
  const trimmed = phone.replace(/[^\d+]/g, "");
  if (!trimmed.startsWith("+")) return null;
  /* Longest code first, so +353 is not read as +35 or +3. */
  const match = [...DIAL_CODE_ZONES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((d) => trimmed.startsWith(d.code));
  return match?.zone ?? null;
}
