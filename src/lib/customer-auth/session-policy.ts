/**
 * Customer session policy, kept free of Next.js imports so it can be unit
 * tested. A password change or reset ends every session issued before it.
 */
export function sessionPredatesPasswordUpdate(
  issuedAtSeconds: number,
  passwordUpdatedAt: Date | null,
): boolean {
  if (!passwordUpdatedAt) return false;
  // Two seconds of tolerance covers the second-level timestamp in the token
  // when a customer signs in immediately after setting a password.
  return passwordUpdatedAt.getTime() > issuedAtSeconds * 1000 + 2_000;
}
