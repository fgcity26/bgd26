/**
 * Bangladesh mobile numbers.
 *
 * Customers type numbers in many ways: `01712-345678`, `+880 1712 345678`,
 * `8801712345678`. Every customer row stores one canonical form so duplicate
 * detection and order lookup work, plus the original string for display.
 */
const BD_MOBILE = /^01[3-9]\d{8}$/;

export class PhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneError";
  }
}

/**
 * Normalise to `+8801XXXXXXXXX` (E.164 for Bangladesh).
 * Throws a readable error for anything that is not a BD mobile number.
 */
export function normalizeBdMobile(input: string): string {
  const digits = input.replace(/\D/g, "");

  let local: string | null = null;
  if (digits.length === 13 && digits.startsWith("880")) {
    local = `0${digits.slice(3)}`;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits;
  } else if (digits.length === 10 && digits.startsWith("1")) {
    local = `0${digits}`;
  }

  if (!local || !BD_MOBILE.test(local)) {
    throw new PhoneError("Enter a Bangladeshi mobile number, for example 01712-345678.");
  }

  return `+880${local.slice(1)}`;
}

/** Canonical → readable local form, e.g. `+8801712345678` → `01712-345678`. */
export function formatBdMobile(normalized: string): string {
  const match = /^\+880(1[3-9]\d{8})$/.exec(normalized);
  if (!match) return normalized;
  const local = `0${match[1]}`;
  return `${local.slice(0, 5)}-${local.slice(5)}`;
}

/** Best-effort normalisation for filtering; returns null instead of throwing. */
export function tryNormalizeBdMobile(input: string): string | null {
  try {
    return normalizeBdMobile(input);
  } catch {
    return null;
  }
}
