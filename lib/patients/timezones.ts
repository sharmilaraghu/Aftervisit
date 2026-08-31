/**
 * The timezones a clinic can pick from.
 *
 * A short list rather than the full IANA database, because a doctor adding a
 * patient is choosing between a handful of places their practice actually
 * serves, not browsing 400 zone names. `isValidTimezone` still validates
 * anything that arrives, since a select is a convenience and not a guarantee —
 * the value reaches a NOT NULL column that the scheduler depends on.
 */

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
