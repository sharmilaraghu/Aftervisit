/**
 * The languages a call can be conducted in.
 *
 * A short curated list, like `timezones.ts`, because a doctor is choosing the
 * language their patient actually speaks, not browsing the BCP 47 registry.
 * `isValidLanguage` still validates anything that arrives — a select is a
 * convenience and not a guarantee, and the value reaches both a NOT NULL
 * column and CALL-E's per-recipient `locale` hint.
 *
 * Two jobs per entry: the tag goes to CALL-E as the voice/conversation locale;
 * `spoken` (when set) goes into the task text as "conduct the whole call in
 * {spoken}". English variants have no `spoken` — the script is already English
 * and an instruction to speak English would only add words to the call.
 */

export interface LanguageOption {
  value: string;
  label: string;
  /** Human name used in the script instruction. Absent for English variants. */
  spoken?: string;
}

/*
 * English and a few Indian languages — the practice is in India, and a short
 * list is one the front desk can read at a glance. Labels are the language's
 * name alone; the BCP 47 tag is the machine's word for it and still travels
 * as the value.
 */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi", spoken: "Hindi" },
  { value: "ta-IN", label: "Tamil", spoken: "Tamil" },
  { value: "te-IN", label: "Telugu", spoken: "Telugu" },
  { value: "kn-IN", label: "Kannada", spoken: "Kannada" },
  { value: "ml-IN", label: "Malayalam", spoken: "Malayalam" },
];

/** The language's name for display, or the tag itself for one not offered. */
export function languageLabel(tag: string): string {
  return LANGUAGE_OPTIONS.find((o) => o.value === tag)?.label ?? tag;
}

export function isValidLanguage(value: string): boolean {
  if (!value) return false;
  try {
    // Throws on a malformed tag; `language` is undefined for e.g. a bare region.
    return Boolean(new Intl.Locale(value).language);
  } catch {
    return false;
  }
}

/**
 * The name the script should tell the agent to speak, or undefined when the
 * call runs in English (any variant) or the tag is not one we curate — an
 * unknown tag still reaches CALL-E as a locale hint, but the script will not
 * instruct a language it cannot name.
 */
export function spokenLanguageName(tag: string): string | undefined {
  return LANGUAGE_OPTIONS.find((o) => o.value === tag)?.spoken;
}
