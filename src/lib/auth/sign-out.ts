/**
 * Where a sign-out form sends the visitor.
 *
 * The rule came from a real complaint: signing out used to drop the owner on
 * the storefront home page with no sign that anything happened, so it looked
 * like the sign-out had failed. Both audiences now land on their sign-in screen
 * with `signedOut=1`, which renders a short confirmation.
 *
 * The query flag also keeps the sign-in pages honest: when it is present they
 * show the form even if an old session cookie is still around. Otherwise a
 * stale cookie would bounce the visitor straight back to `/dashboard`, which
 * looks exactly like "sign out did nothing".
 */
export const STAFF_SIGNED_OUT_PATH = "/login?signedOut=1";

export const CUSTOMER_SIGNED_OUT_PATH = "/account/login?signedOut=1";

/** True only for the exact flag value the sign-out actions write. */
export function isSignedOutNotice(value: string | null | undefined): boolean {
  return value === "1";
}
