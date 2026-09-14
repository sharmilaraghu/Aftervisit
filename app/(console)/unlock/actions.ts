"use server";

/**
 * Hand the console to whoever knows the passcode, and take it back.
 *
 * The cookie holds the passcode itself and is httpOnly: proxy.ts compares it on
 * every console request, nothing in the browser can read it, and it never sits in
 * a URL. The username is asked for because a login box with only a password reads
 * as broken, but it is not checked — there are no accounts in this build.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { passcodeMatches } from "@/lib/try/instant";

const CONSOLE_COOKIE = "aftervisit.console";

export async function consoleUnlocked(): Promise<boolean> {
  const passcode = process.env.AFTER_VISIT_CONSOLE_PASSCODE;
  if (!passcode) return true;
  const held = (await cookies()).get(CONSOLE_COOKIE)?.value ?? "";
  return passcodeMatches(held, passcode);
}

/*
 * Parsed, not pattern-matched: a browser drops tabs and newlines and reads a
 * backslash as a slash, so "/\t/evil.com" is another origin. Only a path that
 * resolves to this origin comes back out.
 */
function safeNext(requested: string): string {
  if (!requested.startsWith("/")) return "/consult";
  try {
    const url = new URL(requested, "http://aftervisit.local");
    return url.origin === "http://aftervisit.local" ? url.pathname + url.search : "/consult";
  } catch {
    return "/consult";
  }
}

export async function unlockConsole(formData: FormData) {
  const typed = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!passcodeMatches(typed, process.env.AFTER_VISIT_CONSOLE_PASSCODE)) {
    redirect(`/unlock?wrong=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(CONSOLE_COOKIE, typed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next);
}

export async function lockConsole() {
  (await cookies()).delete(CONSOLE_COOKIE);
  redirect("/unlock");
}
