import { prisma } from "@/lib/db";
import { hashSecret, verifySecret } from "@/lib/password";
import { normalizeEmail, passwordProblem } from "@/lib/auth/policy";
import {
  assertAccountUsable,
  markLoginFailed,
  markLoginSucceeded,
} from "./shared";
import {
  AuthError,
  AUTH_USER_SELECT,
  type AuthAdapter,
  type AuthUser,
} from "./types";

/**
 * Local adapter: credentials are checked against `users.passwordHash`
 * (scrypt). Used in development, in tests, and anywhere the shop must keep
 * working without an external identity provider.
 */
const DUMMY_HASH_INPUT = "bgd26-timing-equalizer";

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret(DUMMY_HASH_INPUT);
  return dummyHash;
}

/**
 * The password hash is read here and stripped before the record leaves this
 * module — pages and guards never receive it.
 */
type AuthUserWithPassword = AuthUser & { passwordHash: string | null };

async function findUser(email: string): Promise<AuthUserWithPassword | null> {
  return prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { ...AUTH_USER_SELECT, passwordHash: true },
  });
}

export const localAuthAdapter: AuthAdapter = {
  provider: "local",

  async signInWithPassword({ email, password }) {
    const record = await findUser(normalizeEmail(email));

    if (!record || !record.passwordHash) {
      // Spend the same time as a real check so response time does not reveal
      // whether the email exists.
      await verifySecret(password, await getDummyHash());
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const { passwordHash, ...user } = record;
    assertAccountUsable(user);

    const ok = await verifySecret(password, passwordHash);
    if (!ok) {
      await markLoginFailed(user);
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    await markLoginSucceeded(user.id);
    return user;
  },

  async verifyPassword({ userId, password }) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!row?.passwordHash) {
      await verifySecret(password, await getDummyHash());
      return false;
    }
    return verifySecret(password, row.passwordHash);
  },

  async changePassword({ user, currentPassword, newPassword }) {
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (!current?.passwordHash) {
      throw new AuthError("NOT_CONFIGURED", "This account has no password set.");
    }

    if (!(await verifySecret(currentPassword, current.passwordHash))) {
      throw new AuthError("INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    if (await verifySecret(newPassword, current.passwordHash)) {
      throw new AuthError("VALIDATION", "Choose a password you have not used here before.");
    }

    const problem = passwordProblem(newPassword);
    if (problem) throw new AuthError("VALIDATION", problem);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashSecret(newPassword),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  },

  async createUser({ email, password, fullName, roleCodes }) {
    const problem = passwordProblem(password);
    if (problem) throw new AuthError("VALIDATION", problem);

    const normalized = normalizeEmail(email);
    const existing = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) {
      throw new AuthError("VALIDATION", "An account with this email already exists.");
    }

    const roles = await prisma.role.findMany({
      where: { code: { in: roleCodes } },
      select: { id: true, code: true },
    });
    if (roles.length !== roleCodes.length) {
      const known = new Set(roles.map((role) => role.code));
      const missing = roleCodes.filter((code) => !known.has(code));
      throw new AuthError("VALIDATION", `Unknown role: ${missing.join(", ")}`);
    }

    const created = await prisma.user.create({
      data: {
        email: normalized,
        fullName: fullName.trim(),
        passwordHash: await hashSecret(password),
        mustChangePassword: true,
        userRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      select: { id: true },
    });

    return { userId: created.id };
  },
};
