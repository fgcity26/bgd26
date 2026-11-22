/**
 * Password policy.
 *
 * Deliberately simple and explainable: at least 10 characters, a letter and a
 * digit. Length beats symbol soup, and staff type these on phones at a counter.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one number.";
  if (/^\s|\s$/.test(password)) return "Do not start or end with a space.";
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Manager PIN rules. Six digits with no obvious sequences: these PINs authorise
 * discounts above 5 %, walk-in cash sales and payment verification, so 123456
 * is not acceptable.
 */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "The PIN must be exactly six digits.";
  if (/^(\d)\1{5}$/.test(pin)) return "Do not repeat the same digit six times.";

  const digits = pin.split("").map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);
  if (ascending || descending) return "Do not use a sequence such as 123456 or 654321.";

  return null;
}
