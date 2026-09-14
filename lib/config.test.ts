import { describe, expect, it } from "vitest";

import { readConfig as readConfigFrom } from "@/lib/config";

/* A partial environment: Next's ProcessEnv type insists on NODE_ENV. */
const readConfig = (env: Record<string, string>) =>
  readConfigFrom(env as unknown as NodeJS.ProcessEnv);

/*
 * The deployment lock is closed by default. A fresh clone or a fresh deploy —
 * public, with no login — must not be able to ring a number a stranger typed
 * in. Only an explicit list or an explicit `*` lets anything through.
 */
describe("readConfig — the dial allowlist", () => {
  it("is locked when unset", () => {
    const config = readConfig({});
    expect(config.allowlistOpen).toBe(false);
    expect(config.callAllowlist).toEqual([]);
  });

  it("is locked when empty or blank", () => {
    expect(readConfig({ AFTER_VISIT_CALL_ALLOWLIST: "" }).allowlistOpen).toBe(false);
    expect(readConfig({ AFTER_VISIT_CALL_ALLOWLIST: " , " }).allowlistOpen).toBe(false);
  });

  it("allows only the listed numbers", () => {
    const config = readConfig({ AFTER_VISIT_CALL_ALLOWLIST: "+14155550100, +14155550117" });
    expect(config.allowlistOpen).toBe(false);
    expect(config.callAllowlist).toEqual(["+14155550100", "+14155550117"]);
  });

  it("opens only on an explicit *", () => {
    expect(readConfig({ AFTER_VISIT_CALL_ALLOWLIST: "*" }).allowlistOpen).toBe(true);
    expect(readConfig({ AFTER_VISIT_CALL_ALLOWLIST: "*" }).callAllowlist).toEqual([]);
  });

  it("does not arm calls without a CALL-E key, whatever the list says", () => {
    expect(readConfig({ AFTER_VISIT_CALL_ALLOWLIST: "*" }).liveCallsEnabled).toBe(false);
  });
});
