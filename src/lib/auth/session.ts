import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSessionCookie } from "./cookies";
import {
  ForbiddenError,
  hasPermission,
  loadAccess,
  type Access,
} from "./permissions";
import { verifySessionToken, type SessionPayload } from "./token";

export type StaffUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  locale: string;
  status: string;
  mustChangePassword: boolean;
  managerPinHash: string | null;
  managerPinUpdatedAt: Date | null;
  lastLoginAt: Date | null;
};

export type StaffSession = Access & {
  token: SessionPayload;
  user: StaffUser;
};

/**
 * Resolve the current session once per request.
 *
 * `cache()` deduplicates the cookie read, the signature check and the two
 * database queries across layouts, pages and actions in the same render.
 */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findFirst({
    where: { id: payload.userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      locale: true,
      status: true,
      mustChangePassword: true,
      managerPinHash: true,
      managerPinUpdatedAt: true,
      lastLoginAt: true,
    },
  });

  // A deleted, suspended or disabled account loses access immediately, even if
  // its cookie is still valid.
  if (!user || user.status !== "ACTIVE") return null;

  const access = await loadAccess(user.id);
  return { token: payload, user, ...access };
});

/**
 * Every protected page and action starts here.
 *
 * - no session            → /login
 * - must change password  → /account/password (unless explicitly allowed)
 *
 * Note: hiding a link is never security. Pages call this, and every server
 * action calls `requirePermission()` again on the server.
 */
export async function requireStaff(options?: {
  allowPendingPasswordChange?: boolean;
}): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  if (session.user.mustChangePassword && !options?.allowPendingPasswordChange) {
    redirect("/account/password");
  }

  return session;
}

export async function requirePermission(permission: string): Promise<StaffSession> {
  const session = await requireStaff();
  if (!hasPermission(session, permission)) throw new ForbiddenError(permission);
  return session;
}

/**
 * Page-level guard.
 *
 * Pages redirect to a readable 403 screen instead of throwing: in production
 * Next redacts server error messages, so an error boundary could not tell a
 * permission failure from a crash. Server actions keep using
 * `requirePermission()` and its typed `ForbiddenError`.
 */
export async function requirePagePermission(permission: string): Promise<StaffSession> {
  const session = await requireStaff();
  if (!hasPermission(session, permission)) redirect("/forbidden");
  return session;
}


