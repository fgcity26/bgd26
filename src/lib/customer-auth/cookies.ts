import { cookies } from "next/headers";
import { CUSTOMER_SESSION_TTL_SECONDS } from "@/lib/auth/token";

/**
 * The storefront session cookie.
 *
 * Same protections as the staff cookie: HttpOnly, SameSite=Lax and Secure
 * outside development. It has its own name, so signing in as a customer never
 * touches the counter session.
 */
export function customerCookieName(): string {
  return process.env.CUSTOMER_SESSION_COOKIE_NAME?.trim() || "bgd26_customer";
}

export async function readCustomerCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(customerCookieName())?.value ?? null;
}

/** Only valid inside a Server Action or Route Handler. */
export async function writeCustomerCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: customerCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

export async function clearCustomerCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: customerCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
