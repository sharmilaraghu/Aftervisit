import { describe, expect, it } from "vitest";

import { deriveHealth } from "@/lib/db/queries";

const base = { planStatus: "active", urgentOpen: 0, quietFor: 0, contacted: 3 };

describe("deriveHealth", () => {
  it("puts an urgent escalation above everything", () => {
    expect(deriveHealth({ ...base, urgentOpen: 1, quietFor: 9 })).toBe("escalated");
  });

  /*
   * The failure this product exists to catch. A window that closed without ever
   * reaching the patient used to render as "Completed" — a quiet grey badge,
   * indistinguishable from a week that went well.
   */
  it("calls a finished plan that reached nobody never_reached, not completed", () => {
    expect(deriveHealth({ ...base, planStatus: "completed", contacted: 0 })).toBe("never_reached");
    expect(deriveHealth({ ...base, planStatus: "cancelled", contacted: 0 })).toBe("never_reached");
  });

  it("still calls a finished plan that did reach them completed", () => {
    expect(deriveHealth({ ...base, planStatus: "completed", contacted: 1 })).toBe("completed");
  });

  it("does not call a running plan never_reached just because it is early", () => {
    expect(deriveHealth({ ...base, planStatus: "active", contacted: 0 })).toBe("on_track");
  });

  it("treats no plan at all as its own state", () => {
    expect(deriveHealth({ ...base, planStatus: null, contacted: 0 })).toBe("needs_plan");
  });

  it("reports drift only while someone is still meant to be answering", () => {
    expect(deriveHealth({ ...base, quietFor: 3 })).toBe("drifting");
    expect(deriveHealth({ ...base, quietFor: 2 })).toBe("on_track");
    expect(deriveHealth({ ...base, quietFor: null })).toBe("on_track");
  });

  it("is deterministic", () => {
    expect(deriveHealth(base)).toEqual(deriveHealth(base));
  });
});
