/**
 * Turn an approved plan into dated rows.
 *
 * Occurrences are materialised eagerly, all of them, the moment the doctor
 * approves. That is a product decision as much as a technical one: seven dated
 * rows appearing at once is the argument this product is making — the agent
 * owns the calendar, and you can look at it.
 *
 * Retries are *not* materialised here. An attempt beyond the first only exists
 * because an attempt actually failed, so creating them up front would put rows
 * on the screen for calls that will probably never happen.
 *
 * **`timeScale` is applied exactly once, here.** Everything downstream — the
 * claim query, the reconciler, the retry ladder, the KPIs — sees ordinary UTC
 * instants and has no idea a demo clock exists. That is what makes the
 * mechanism under a sped-up demo byte-identical to the one in production.
 *
 * Pure. `now` is injected; nothing in this file reads a clock or a database.
 */

import { addDays, localDate, zonedTimeToUtc } from "@/lib/time/clock";
import type { Cadence } from "@/lib/db/enums";

export interface ExpandInput {
  planId: string;
  patientId: string;
  /** IANA zone. The whole reason a daily plan stays daily across a DST change. */
  timezone: string;
  /** `HH:MM`, meant in the patient's zone. */
  localTime: string;
  durationDays: number;
  cadence: Cadence;
  /** 1 = real time. 1440 = one clinical day per minute. */
  timeScale: number;
  /** Injected. Approval time — the anchor the whole window hangs from. */
  now: Date;
  /**
   * Days after today the window opens. The doctor's "check in after 3 days" is
   * 3; one more than that is how a start after today's call time avoids
   * spending a day nobody is called on.
   */
  startOffsetDays?: number;
}

export interface Occurrence {
  occurrence: number;
  scheduledFor: Date;
}

export interface Expansion {
  startsAt: Date;
  /** Calendar-anchored from approval. New occurrences may not pass it; retries may. */
  endsAt: Date;
  occurrences: Occurrence[];
}

const CADENCE_STEP: Record<Cadence, number> = {
  daily: 1,
  every_other_day: 2,
  weekly: 7,
};

/**
 * Compress a real instant toward `now` by the time scale.
 *
 * At `timeScale = 1` this returns the instant unchanged, so production never
 * touches the arithmetic at all. At 1440 a day becomes a minute — but the row
 * still holds a real timestamp, which is why nothing downstream needs to know.
 */
function scaled(now: Date, real: Date, timeScale: number): Date {
  if (timeScale === 1) return real;
  const offset = real.getTime() - now.getTime();
  return new Date(now.getTime() + offset / timeScale);
}

export function expandPlan(input: ExpandInput): Expansion {
  const step = CADENCE_STEP[input.cadence];
  const today = localDate(input.now, input.timezone);
  const startDate = addDays(today, input.startOffsetDays ?? 0);

  /*
   * "7 days" is a clinical interval measured on a calendar, not a quota of
   * seven completed contacts. So the window's end is a date, computed from
   * approval, and a day the patient never answered still consumed one.
   */
  const endReal = zonedTimeToUtc(
    addDays(startDate, input.durationDays - 1),
    input.localTime,
    input.timezone,
  );

  const occurrences: Occurrence[] = [];
  let index = 0;

  for (let dayOffset = 0; dayOffset < input.durationDays; dayOffset += step) {
    const real = zonedTimeToUtc(
      addDays(startDate, dayOffset),
      input.localTime,
      input.timezone,
    );

    /*
     * A plan approved at 14:00 for a 10:00 daily call must not immediately fire
     * a call for a 10:00 that has already passed. Day one starts tomorrow in
     * that case — the window still runs the full duration from today's date.
     */
    if (real.getTime() <= input.now.getTime()) continue;

    index += 1;
    occurrences.push({
      occurrence: index,
      scheduledFor: scaled(input.now, real, input.timeScale),
    });
  }

  return {
    startsAt: occurrences[0]?.scheduledFor ?? scaled(input.now, endReal, input.timeScale),
    endsAt: scaled(input.now, endReal, input.timeScale),
    occurrences,
  };
}
