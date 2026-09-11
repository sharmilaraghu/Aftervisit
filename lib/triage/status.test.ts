import { describe, expect, it } from "vitest";

import { clinicalStatus, statusReason, type StatusInput } from "@/lib/triage/status";
import type { TodayRow } from "@/lib/db/dashboard";

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    planStatus: "active",
    health: "on_track",
    escalationOpen: false,
    escalationLabel: null,
    latestVerdict: null,
    latestReached: false,
    finishedUnclosed: false,
    quietFor: null,
    ...overrides,
  };
}

describe("clinicalStatus — what the doctor sees, derived", () => {
  it("an open escalation is needs attention, and says what raised it", () => {
    const i = input({ escalationOpen: true, escalationLabel: "Patient asked for a clinician" });
    expect(clinicalStatus(i)).toBe("needs_attention");
    expect(statusReason(i, "needs_attention")).toBe("Patient asked for a clinician");
  });

  /* A triage outage fails closed into an escalation, so the patient lands here
     — never under "no concerns". */
  it("a fail-closed reading, escalated, is needs attention", () => {
    const i = input({ escalationOpen: true, escalationLabel: "Could not be read", latestVerdict: "escalate" });
    expect(clinicalStatus(i)).toBe("needs_attention");
  });

  it("an open escalation outranks a later low reading", () => {
    expect(
      clinicalStatus(input({ escalationOpen: true, latestVerdict: "low", latestReached: true })),
    ).toBe("needs_attention");
  });

  it("keeps a silence as a clinical fact, not a schedule line", () => {
    const i = input({ health: "drifting", quietFor: 4 });
    expect(clinicalStatus(i)).toBe("needs_attention");
    expect(statusReason(i, "needs_attention")).toBe("Not heard from in 4 days");
  });

  it("a follow-up that ended with nobody reached needs attention, not closing", () => {
    const i = input({ planStatus: "completed", health: "never_reached", finishedUnclosed: true });
    expect(clinicalStatus(i)).toBe("needs_attention");
    expect(statusReason(i, "needs_attention")).toBe("Never reached during the follow-up");
  });

  it("a window that ran out unclosed is finished", () => {
    expect(clinicalStatus(input({ planStatus: "completed", health: "completed", finishedUnclosed: true }))).toBe(
      "finished",
    );
  });

  it("a low reading of a call that reached her is no concerns raised — never 'fine'", () => {
    expect(clinicalStatus(input({ latestVerdict: "low", latestReached: true }))).toBe("no_concerns");
  });

  /* Held in code, not left to the triage prompt: silence is never no concerns. */
  it("a low reading of a call nobody answered is no word yet", () => {
    const i = input({ latestVerdict: "low", latestReached: false });
    expect(clinicalStatus(i)).toBe("no_word_yet");
    expect(statusReason(i, "no_word_yet")).toBe("No call has got through yet");
  });

  it("nothing read yet is no word yet, with the reason", () => {
    expect(statusReason(input(), "no_word_yet")).toBe("No call has got through yet");
    expect(statusReason(input({ planStatus: "awaiting_approval" }), "no_word_yet")).toBe(
      "Plan waiting for your approval",
    );
  });

  it("a handled concern waits for the next call rather than claiming all is well", () => {
    const i = input({ latestVerdict: "escalate" });
    expect(clinicalStatus(i)).toBe("no_word_yet");
    expect(statusReason(i, "no_word_yet")).toBe("Handled — waiting for the next call");
  });
});

describe("the doctor's row", () => {
  /* Compile-time: removing the field from the query, not hiding it in CSS. */
  it("carries no phone number field", () => {
    type HasPhone = "phoneE164" extends keyof TodayRow ? true : false;
    const hasPhone: HasPhone = false;
    expect(hasPhone).toBe(false);
  });
});
