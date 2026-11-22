import { prisma } from "@/lib/db";

/**
 * RBAC lookups.
 *
 * Permissions are stored as `resource.action` codes and granted through roles.
 * The catalogue is seeded (126 codes); nothing here invents permissions, so a
 * typo in a guard fails closed instead of silently allowing access.
 */
export type Access = {
  roles: string[];
  permissions: Set<string>;
};

export async function loadAccess(userId: string): Promise<Access> {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          code: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
  });

  const roles = rows.map((row) => row.role.code).sort();
  const permissions = new Set<string>();
  for (const row of rows) {
    for (const grant of row.role.permissions) permissions.add(grant.permission.code);
  }

  return { roles, permissions };
}

export function hasPermission(
  session: { permissions: ReadonlySet<string> },
  code: string,
): boolean {
  return session.permissions.has(code);
}

export function hasAnyPermission(
  session: { permissions: ReadonlySet<string> },
  codes: readonly string[],
): boolean {
  return codes.some((code) => session.permissions.has(code));
}

/**
 * Thrown when a signed-in user calls an action they are not allowed to use.
 * The admin error boundary renders a 403 screen for this class only; anything
 * else is treated as an unexpected failure.
 */
export class ForbiddenError extends Error {
  constructor(readonly permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}
