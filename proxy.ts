/**
 * The console's lock.
 *
 * With the allowlist at `*`, the console is a way to reach any phone: register a
 * patient with a typed number, record consent, start a follow-up, and the scheduler
 * dials it with nobody pressing a button. On a public URL that has to sit behind a
 * password, so when `AFTER_VISIT_CONSOLE_PASSCODE` is set every console page — and
 * every server action, which posts to the page it came from — needs the cookie the
 * unlock page sets, or is sent to /unlock.
 *
 * A page, not the browser's Basic-auth dialog: that dialog is unstyled, cannot say
 * why the console is locked, and a judge told which password to type had nowhere to
 * read it. The cookie is httpOnly, so nothing in the browser reads it back.
 *
 * Unset, the console stays open, which is the local no-call setup: a fresh clone has
 * no key and a locked allowlist, so there is nothing to protect. The hosted demo sets it.
 *
 * Deliberately outside the lock: the landing page; `/unlock` itself; `/try`, which has
 * its own passcode and saves nothing; and `/api/*`, where the cron and CALL-E's webhook
 * arrive with their own tokens.
 */

import { NextResponse, type NextRequest } from "next/server";

export const CONSOLE_COOKIE = "aftervisit.console";

export function proxy(request: NextRequest) {
  const passcode = process.env.AFTER_VISIT_CONSOLE_PASSCODE;
  if (!passcode) return NextResponse.next();

  const held = request.cookies.get(CONSOLE_COOKIE)?.value ?? "";
  if (same(held, passcode)) return NextResponse.next();

  const unlock = new URL("/unlock", request.url);
  unlock.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(unlock);
}

/* Compared in full, so a wrong guess takes as long however much of it was right. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const config = {
  matcher: [
    "/patients/:path*",
    "/register/:path*",
    "/consult/:path*",
    "/dashboard/:path*",
    "/followups/:path*",
    "/plans/:path*",
    "/calls/:path*",
  ],
};
