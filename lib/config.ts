/**
 * Environment, parsed once and in one place.
 *
 * The allowlist is the important thing here. OpenLine — the sibling project —
 * gates every call behind a human pressing a button per candidate. Care Loop
 * cannot: the whole product is that nobody has to press anything. So the gate
 * that stops this process phoning a stranger has to live in code, and this is
 * where it is read. `lib/calle/port.ts` enforces it.
 *
 * It exists because there is no auth. With a login, "a clinician approved this
 * plan" would itself be the authorisation to dial; on a public URL with no
 * login, approval proves an action happened but nothing about who did it. The
 * allowlist is what stands in for that missing identity.
 *
 * `CARELOOP_CALL_ALLOWLIST=*` opts out, for when the friction outweighs the
 * risk — a trusted machine, a demo, a test run. Empty is still empty.
 */

export interface CareLoopConfig {
  /** Calls are live whenever CALL-E has a key. There is no separate switch. */
  liveCallsEnabled: boolean;
  /** The only numbers the scheduler may dial. Empty means: dial nobody. */
  callAllowlist: string[];
  /**
   * The gate is deliberately open: any number on an approved plan may be dialled.
   *
   * Set with `CARELOOP_CALL_ALLOWLIST=*`. This is the opt-out, not the default —
   * an empty allowlist still means dial nobody, so forgetting to configure
   * anything can never open the gate. Opening it is an explicit act, and the
   * console says so on every page.
   */
  allowlistOpen: boolean;
  /** How the agent sounds. The only voice control the API exposes. */
  callLocale: string;
  /** Shared secret guarding POST /api/tick. */
  tickToken: string | null;
}

/** The one value that opens the gate. Anything else is a list of numbers. */
const OPEN = "*";

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): CareLoopConfig {
  return {
    liveCallsEnabled: Boolean(env.CALLE_API_KEY),
    callAllowlist: parseAllowlist(env.CARELOOP_CALL_ALLOWLIST).filter((n) => n !== OPEN),
    allowlistOpen: parseAllowlist(env.CARELOOP_CALL_ALLOWLIST).includes(OPEN),
    callLocale: env.CARELOOP_CALL_LOCALE || "en-US",
    tickToken: env.CARELOOP_TICK_TOKEN || null,
  };
}
