import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/**
 * Audit trail.
 *
 * Every authentication event is recorded: sign-in success and failure, lockout,
 * password change and PIN change. A failure to write the log must never break
 * the user's request, so errors are reported and swallowed — but the caller is
 * still told nothing about internals.
 */
export type AuditEntry = {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        reason: entry.reason ?? null,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write", entry.action, error);
  }
}
