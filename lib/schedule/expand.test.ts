import { describe, expect, it } from "vitest";

import { expandPlan, type ExpandInput } from "@/lib/schedule/expand";
import { calendarDaysBetween, zonedTimeToUtc } from "@/lib/time/clock";

function input(overrides: Partial<ExpandInput> = {}): ExpandInput {
  return {
    planId: "pln_1",
    patientId: "pat_1",
    timezone: "Europe/London",
    localTime: "10:00",
    durationDays: 7,
    cadence: "daily",
    timeScale: 1,
    now: new Date("2026-08-30T08:00:00Z"),
    ...overrides,
  };
}

/** What time-of-day did this instant land on, where the patient lives? */
function localHHMM(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

describe("expandPlan — starting tomorrow", () => {
  /* 12:00 UTC is 13:00 in London: today's 10:00 call has already gone. */
  const late = input({ durationDays: 1, now: new Date("2026-08-30T12:00:00Z") });

  it("gives a one-day plan saved after its call time nothing today", () => {
    expect(expandPlan(late).occurrences).toHaveLength(0);
  });

  it("puts that call tomorrow at the same local time when asked to", () => {
    const { occurrences, startsAt } = expandPlan({ ...late, startOffsetDays: 1 });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].scheduledFor.toISOString()).toBe("2026-08-31T09:00:00.000Z");
    expect(startsAt).toEqual(occurrences[0].scheduledFor);
  });
});

describe("expandPlan — waiting before the first call", () => {
  /* 08:00 UTC is 09:00 in London, before the 10:00 call. */
  const early = new Date("2026-08-30T08:00:00Z");

  it("puts a one-day plan three days out as a single call on day three", () => {
    const { occurrences, startsAt, endsAt } = expandPlan(
      input({ durationDays: 1, startOffsetDays: 3, now: early }),
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].scheduledFor.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(startsAt).toEqual(occurrences[0].scheduledFor);
    expect(endsAt).toEqual(occurrences[0].scheduledFor);
  });

  it("opens a longer window on the later day, keeping its length", () => {
    const { occurrences } = expandPlan(input({ durationDays: 3, startOffsetDays: 2, now: early }));
    expect(occurrences.map((o) => o.scheduledFor.toISOString())).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-02T09:00:00.000Z",
      "2026-09-03T09:00:00.000Z",
    ]);
  });
});

describe("expandPlan — the shape of a window", () => {
  it("produces one dated row per day of the window", () => {
    const { occurrences } = expandPlan(input());
    expect(occurrences).toHaveLength(7);
    expect(occurrences.map((o) => o.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("spaces every_other_day and weekly correctly", () => {
    expect(expandPlan(input({ cadence: "every_other_day" })).occurrences).toHaveLength(4);
    expect(expandPlan(input({ cadence: "weekly", durationDays: 28 })).occurrences).toHaveLength(4);
  });

  it("keeps occurrences strictly in the future", () => {
    const now = new Date("2026-08-30T08:00:00Z");
    for (const o of expandPlan(input({ now })).occurrences) {
      expect(o.scheduledFor.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  /*
   * Approving at 14:00 for a 10:00 daily call must not fire a call for a 10:00
   * that has already gone. The window still runs its full duration; it just
   * starts tomorrow.
   */
  it("skips today when today's slot has already passed", () => {
    const late = expandPlan(input({ now: new Date("2026-08-30T14:00:00Z") }));
    expect(late.occurrences).toHaveLength(6);
    expect(localHHMM(late.occurrences[0].scheduledFor, "Europe/London")).toBe("10:00");
  });

  it("is deterministic", () => {
    expect(expandPlan(input())).toEqual(expandPlan(input()));
  });
});

describe("expandPlan — the patient's timezone is the one that counts", () => {
  it("places every call at the local wall-clock time, not the server's", () => {
    const kolkata = expandPlan(input({ timezone: "Asia/Kolkata", localTime: "17:30" }));
    for (const o of kolkata.occurrences) {
      expect(localHHMM(o.scheduledFor, "Asia/Kolkata")).toBe("17:30");
    }
  });

  /*
   * The bug the NOT NULL timezone column exists to prevent. British Summer Time
   * ends on 25 October 2026; a plan spanning it must still call at 10:00 local
   * on both sides, which means the UTC instants are *not* evenly spaced.
   */
  it("holds the local time across a daylight-saving change", () => {
    const { occurrences } = expandPlan(
      input({ now: new Date("2026-10-22T06:00:00Z"), durationDays: 7 }),
    );

    for (const o of occurrences) {
      expect(localHHMM(o.scheduledFor, "Europe/London")).toBe("10:00");
    }

    const gaps = occurrences
      .slice(1)
      .map((o, i) => o.scheduledFor.getTime() - occurrences[i].scheduledFor.getTime());
    // Exactly one gap is 25 hours: the day the clocks went back.
    expect(gaps.filter((g) => g === 25 * 3600_000)).toHaveLength(1);
  });

  it("puts the same wall-clock time in a southern-hemisphere zone too", () => {
    const sydney = expandPlan(input({ timezone: "Australia/Sydney", localTime: "09:15" }));
    for (const o of sydney.occurrences) {
      expect(localHHMM(o.scheduledFor, "Australia/Sydney")).toBe("09:15");
    }
  });
});

describe("expandPlan — the window is calendar-anchored", () => {
  it("ends a duration's worth of calendar days from approval", () => {
    const now = new Date("2026-08-30T08:00:00Z");
    const { endsAt } = expandPlan(input({ now, durationDays: 7 }));
    expect(calendarDaysBetween(now, endsAt, "Europe/London")).toBe(6);
  });

  it("does not extend the window when a day's slot is missed", () => {
    const early = expandPlan(input({ now: new Date("2026-08-30T08:00:00Z") }));
    const late = expandPlan(input({ now: new Date("2026-08-30T14:00:00Z") }));

    // One fewer call, but the window still closes on the same calendar day:
    // seven days is a clinical interval, not seven completed contacts.
    expect(late.occurrences.length).toBeLessThan(early.occurrences.length);
    expect(localHHMM(late.endsAt, "Europe/London")).toBe("10:00");
    expect(late.endsAt.toISOString().slice(0, 10)).toBe(
      early.endsAt.toISOString().slice(0, 10),
    );
  });

  it("keeps every occurrence inside the window", () => {
    const { occurrences, endsAt } = expandPlan(input());
    for (const o of occurrences) {
      expect(o.scheduledFor.getTime()).toBeLessThanOrEqual(endsAt.getTime());
    }
  });
});

describe("expandPlan — the demo clock", () => {
  it("changes nothing at all at timeScale 1", () => {
    const real = expandPlan(input({ timeScale: 1 }));
    const day2 = zonedTimeToUtc("2026-08-31", "10:00", "Europe/London");
    expect(real.occurrences[1].scheduledFor.toISOString()).toBe(day2.toISOString());
  });

  /*
   * A clinical day becomes a minute. The rows still hold real timestamps, which
   * is the point: nothing downstream is aware the demo clock exists, so the
   * mechanism being demonstrated is the mechanism that ships.
   */
  it("puts one clinical day into one minute at timeScale 1440", () => {
    const now = new Date("2026-08-30T08:00:00Z");
    const fast = expandPlan(input({ now, timeScale: 1440 }));

    // The spacing is what "one day per minute" means. The offset of the *first*
    // occurrence is not a whole minute and should not be: approval at 08:00 UTC
    // for a 10:00 London call in August is one real hour away (BST), which
    // compresses to two and a half seconds. Worth knowing before a demo — at
    // this scale the first call lands almost immediately after approval.
    const gapsInSeconds = fast.occurrences
      .slice(1)
      .map((o, i) => (o.scheduledFor.getTime() - fast.occurrences[i].scheduledFor.getTime()) / 1000);

    expect(gapsInSeconds).toEqual([60, 60, 60, 60, 60, 60]);
    expect((fast.occurrences[0].scheduledFor.getTime() - now.getTime()) / 1000).toBe(2.5);
  });

  it("compresses the window's end by the same factor", () => {
    const now = new Date("2026-08-30T08:00:00Z");
    const real = expandPlan(input({ now, timeScale: 1 }));
    const fast = expandPlan(input({ now, timeScale: 1440 }));

    const realSpan = real.endsAt.getTime() - now.getTime();
    const fastSpan = fast.endsAt.getTime() - now.getTime();
    expect(Math.round(realSpan / fastSpan)).toBe(1440);
  });

  it("keeps the occurrences in order and still in the future", () => {
    const now = new Date("2026-08-30T08:00:00Z");
    const fast = expandPlan(input({ now, timeScale: 1440 }));
    for (let i = 1; i < fast.occurrences.length; i++) {
      expect(fast.occurrences[i].scheduledFor.getTime()).toBeGreaterThan(
        fast.occurrences[i - 1].scheduledFor.getTime(),
      );
    }
    expect(fast.occurrences[0].scheduledFor.getTime()).toBeGreaterThan(now.getTime());
  });
});
