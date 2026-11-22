import type { Prisma } from "@/generated/prisma/client";
import type { AuthProvider } from "@/lib/auth/token";

/**
 * The auth port.
 *
 * Business code depends on this interface only. Today two adapters implement
 * it: `local` (email + password checked against `users.passwordHash`, used for
 * development and for offline-capable deployments) and `supabase` (Supabase
 * Auth is the credential store; the local `users` row is still the source of
 * roles, status and lockout).
 *
 * Swapping providers never touches pages, guards or business logic.
 */
export type AuthFailureCode =
  | "INVALID_CREDENTIALS"
  | "LOCKED"
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "VALIDATION";

export class AuthError extends Error {
  constructor(
    readonly code: AuthFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  mustChangePassword: true,
  managerPinHash: true,
  managerPinUpdatedAt: true,
  lastLoginAt: true,
  failedLoginCount: true,
  lockedUntil: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{ select: typeof AUTH_USER_SELECT }>;

export interface AuthAdapter {
  readonly provider: AuthProvider;

  /**
   * Verify a password and return the staff account.
   * Throws `AuthError` for wrong credentials, lockout or a disabled account.
   */
  signInWithPassword(input: { email: string; password: string }): Promise<AuthUser>;

  /** Checks a password without creating a session (used to authorise a PIN change). */
  verifyPassword(input: { userId: string; email: string; password: string }): Promise<boolean>;

  /** Re-authenticates with the current password before saving a new one. */
  changePassword(input: {
    user: { id: string; email: string };
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;

  /** Creates a staff login. Role assignment is the caller's responsibility. */
  createUser(input: {
    email: string;
    password: string;
    fullName: string;
    roleCodes: string[];
  }): Promise<{ userId: string }>;
}
