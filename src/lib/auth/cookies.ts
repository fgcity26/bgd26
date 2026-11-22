import { cookies } from "next/headers";

/**
 * The session cookie.
 *
 * `HttpOnly` keeps it away from JavaScript (XSS cannot read it),
 * `SameSite=Lax` blocks cross-site POSTs from carrying it, and `Secure` is on
 * outside development. There is deliberately no "remember me" option on shared
 * POS devices — the TTL is fixed by `SESSION_TTL_SECONDS`.
 */
export function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";
}

export function sessionTtlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS ?? 604_800);
  if (!Number.isFinite(raw)) return 604_800;
  // Clamp to 5 minutes … 30 days so a typo cannot create a year-long session.
  return Math.min(Math.max(Math.trunc(raw), 300), 60 * 60 * 24 * 30);
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

/** Only valid inside a Server Action or Route Handler. */
export async function writeSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionTtlSeconds(),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
