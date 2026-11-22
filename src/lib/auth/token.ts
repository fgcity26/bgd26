import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Session tokens.
 *
 * A session is a signed, self-contained value: base64url(JSON) + "." +
 * base64url(HMAC-SHA256). No session table is needed, and any tampering with
 * the payload invalidates the signature. The signing key never leaves the
 * server (`AUTH_SECRET`, min 32 chars).
 *
 * The cookie itself is set in `cookies.ts`; this file is pure crypto so it can
 * be unit-tested without a request context.
 */
export const SESSION_VERSION = 1;

export type AuthProvider = "local" | "supabase";

export type SessionPayload = {
  v: typeof SESSION_VERSION;
  userId: string;
  email: string;
  provider: AuthProvider;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
};

const DEV_FALLBACK_SECRET = "bgd26-development-auth-secret-not-for-production-use";

function signingSecret(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret && secret.length >= 32) return Buffer.from(secret, "utf8");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must be set to at least 32 characters in production. " +
        "Generate one with: openssl rand -base64 48",
    );
  }

  // Development and tests only. Production throws above.
  return Buffer.from(DEV_FALLBACK_SECRET, "utf8");
}

function sign(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function signSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const received = Buffer.from(signature, "base64url");
  const expected = Buffer.from(sign(body), "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as SessionPayload;

  if (payload.v !== SESSION_VERSION) return null;
  if (typeof payload.userId !== "string" || payload.userId.length === 0) return null;
  if (typeof payload.email !== "string" || payload.email.length === 0) return null;
  if (payload.provider !== "local" && payload.provider !== "supabase") return null;
  if (typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number") {
    return null;
  }
  // Reject tokens from the future (clock skew allowance: 60 s) and expired ones.
  if (payload.issuedAt > nowSeconds + 60) return null;
  if (payload.expiresAt <= nowSeconds) return null;

  return payload;
}

/* -------------------------------------------------------------------------- */
/* Guest order access                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A guest order link.
 *
 * There is no customer login yet, so the confirmation page is protected by a
 * signed token in the URL. The token names one order and the mobile that placed
 * it, expires after seven days, and cannot be forged or reused for another
 * order. `/track` issues a fresh token after the customer proves the order
 * number and mobile.
 */
export const ORDER_ACCESS_VERSION = 1;
export const ORDER_ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

export type OrderAccessPayload = {
  v: typeof ORDER_ACCESS_VERSION;
  scope: "order";
  orderId: string;
  orderNumber: string;
  mobile: string;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
};

export function signOrderAccessToken(
  input: {
    orderId: string;
    orderNumber: string;
    mobile: string;
    nowSeconds?: number;
    ttlSeconds?: number;
  },
): string {
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: OrderAccessPayload = {
    v: ORDER_ACCESS_VERSION,
    scope: "order",
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    mobile: input.mobile,
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? ORDER_ACCESS_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyOrderAccessToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): OrderAccessPayload | null {
  if (!token || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const received = Buffer.from(signature, "base64url");
  const expected = Buffer.from(sign(body), "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const payload = parsed as OrderAccessPayload;
  if (payload.v !== ORDER_ACCESS_VERSION || payload.scope !== "order") return null;
  if (typeof payload.orderId !== "string" || payload.orderId.length === 0) return null;
  if (typeof payload.orderNumber !== "string" || payload.orderNumber.length === 0) return null;
  if (typeof payload.mobile !== "string" || payload.mobile.length === 0) return null;
  if (typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number") {
    return null;
  }
  if (payload.issuedAt > nowSeconds + 60) return null;
  if (payload.expiresAt <= nowSeconds) return null;

  return payload;
}

/* -------------------------------------------------------------------------- */
/* Storefront customer session                                                */
/* -------------------------------------------------------------------------- */

/**
 * A signed storefront session.
 *
 * Customer identity is separate from staff identity on purpose: a customer
 * cookie must never be accepted by a staff page, and vice versa. The payload
 * carries `scope: "customer"` and the signature covers a `customer.` prefix, so
 * neither token type can be swapped for the other even though both use
 * `AUTH_SECRET`.
 */
export const CUSTOMER_SESSION_VERSION = 1;
export const CUSTOMER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type CustomerSessionPayload = {
  v: typeof CUSTOMER_SESSION_VERSION;
  scope: "customer";
  customerId: string;
  mobile: string;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
};

function signCustomer(body: string): string {
  return createHmac("sha256", signingSecret()).update(`customer.${body}`).digest("base64url");
}

export function signCustomerSessionToken(input: {
  customerId: string;
  mobile: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: CustomerSessionPayload = {
    v: CUSTOMER_SESSION_VERSION,
    scope: "customer",
    customerId: input.customerId,
    mobile: input.mobile,
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? CUSTOMER_SESSION_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signCustomer(body)}`;
}

export function verifyCustomerSessionToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CustomerSessionPayload | null {
  if (!token || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const received = Buffer.from(signature, "base64url");
  const expected = Buffer.from(signCustomer(body), "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const payload = parsed as CustomerSessionPayload;
  if (payload.v !== CUSTOMER_SESSION_VERSION || payload.scope !== "customer") return null;
  if (typeof payload.customerId !== "string" || payload.customerId.length === 0) return null;
  if (typeof payload.mobile !== "string" || payload.mobile.length === 0) return null;
  if (typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number") {
    return null;
  }
  if (payload.issuedAt > nowSeconds + 60) return null;
  if (payload.expiresAt <= nowSeconds) return null;

  return payload;
}
