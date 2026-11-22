import { prisma } from "@/lib/db";
import { AuthError, type AuthUser } from "./types";

/**
 * Rules shared by every auth adapter: lockout, account state and success
 * bookkeeping. Keeping them here means a new provider cannot accidentally skip
 * the five-attempt lock.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function assertAccountUsable(user: AuthUser, now = new Date()): void {
  if (user.status !== "ACTIVE") {
    throw new AuthError(
      "DISABLED",
      "This account is not active. Ask the owner to enable it.",
    );
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    const minutes = Math.max(
      1,
      Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000),
    );
    throw new AuthError(
      "LOCKED",
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
}

export async function markLoginSucceeded(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export async function markLoginFailed(user: AuthUser): Promise<void> {
  const nextCount = user.failedLoginCount + 1;

  if (nextCount >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
      },
    });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: nextCount },
  });
}

export const LOCKOUT_POLICY = { MAX_FAILED_ATTEMPTS, LOCK_MINUTES } as const;
