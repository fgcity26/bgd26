import { cookies } from "next/headers";

/**
 * The guest cart cookie.
 *
 * The value is an unguessable random token, not a cart id. It is HttpOnly so
 * JavaScript cannot read or overwrite it, Lax so a cross-site POST cannot carry
 * it, and Secure outside development. A cart is anonymous until checkout
 * attaches a customer.
 */
export function cartCookieName(): string {
  return "bgd26_cart";
}

export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function readCartToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(cartCookieName())?.value ?? null;
}

/** Only valid inside a Server Action or Route Handler. */
export async function writeCartToken(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: cartCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });
}

export async function clearCartToken(): Promise<void> {
  const store = await cookies();
  store.set({
    name: cartCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
