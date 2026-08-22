/**
 * Environment, parsed once and in one place.
 *
 * The allowlist is the important thing here. OpenLine — the sibling project —
 * gates every call behind a human pressing a button per candidate. Care Loop
 * cannot: the whole product is that nobody has to press anything. So the gate
 * that stops this process phoning a stranger has to live in code, and this is
 * where it is read. `lib/calle/port.ts` enforces it.
 */

export interface CareLoopConfig {
  /** Calls are live whenever CALL-E has a key. There is no separate switch. */
  liveCallsEnabled: boolean;
  /** The only numbers the scheduler may dial. Empty means: dial nobody. */
  callAllowlist: string[];
  /** How the agent sounds. The only voice control the API exposes. */
  callLocale: string;
  /** Shared secret guarding POST /api/tick. */
  tickToken: string | null;
}

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): CareLoopConfig {
  return {
    liveCallsEnabled: Boolean(env.CALLE_API_KEY),
    callAllowlist: parseAllowlist(env.CARELOOP_CALL_ALLOWLIST),
    callLocale: env.CARELOOP_CALL_LOCALE || "en-US",
    tickToken: env.CARELOOP_TICK_TOKEN || null,
  };
}
