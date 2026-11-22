import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { normalizeEmail, passwordProblem } from "@/lib/auth/policy";
import {
  assertAccountUsable,
  markLoginSucceeded,
} from "./shared";
import {
  AuthError,
  AUTH_USER_SELECT,
  type AuthAdapter,
  type AuthUser,
} from "./types";

/**
 * Supabase adapter.
 *
 * Supabase Auth owns the password; this application still owns roles, status
 * and lockout in the `users` table. The Supabase user id is linked through
 * `users.supabaseUserId`, so a staff member can be disabled here without
 * touching the identity provider.
 */
function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new AuthError(
      "NOT_CONFIGURED",
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or set AUTH_PROVIDER=local.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new AuthError(
      "NOT_CONFIGURED",
      "SUPABASE_SERVICE_ROLE_KEY is required to change passwords through Supabase Auth.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function findLocalUser(supabaseUserId: string, email: string): Promise<AuthUser> {
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ supabaseUserId }, { email: normalizeEmail(email) }],
    },
    select: AUTH_USER_SELECT,
  });

  if (!user) {
    throw new AuthError(
      "NOT_CONFIGURED",
      "Signed in to Supabase, but no staff account is linked to this email. Ask the owner to invite you.",
    );
  }

  return user;
}

async function linkSupabaseUser(userId: string, supabaseUserId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { supabaseUserId },
  });
}

export const supabaseAuthAdapter: AuthAdapter = {
  provider: "supabase",

  async signInWithPassword({ email, password }) {
    let result;
    try {
      result = await anonClient().auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        "PROVIDER_ERROR",
        "Could not reach the authentication service. Try again in a moment.",
      );
    }

    const { data, error } = result;
    if (error || !data.user?.email) {
      if (error?.code === "email_not_confirmed") {
        throw new AuthError(
          "DISABLED",
          "Confirm your email address before signing in.",
        );
      }
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const user = await findLocalUser(data.user.id, data.user.email);

    assertAccountUsable(user);

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supabaseUserId: true },
    });
    if (!account?.supabaseUserId) {
      await linkSupabaseUser(user.id, data.user.id);
    }

    await markLoginSucceeded(user.id);
    return user;
  },

  async verifyPassword({ email, password }) {
    try {
      const { error } = await anonClient().auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      return !error;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      return false;
    }
  },

  async changePassword({ user, currentPassword, newPassword }) {
    const problem = passwordProblem(newPassword);
    if (problem) throw new AuthError("VALIDATION", problem);

    const linked = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supabaseUserId: true, email: true },
    });

    if (!linked?.supabaseUserId) {
      throw new AuthError("NOT_CONFIGURED", "This account is not linked to Supabase Auth.");
    }

    // Re-authenticate before changing the password.
    const { error: verifyError } = await anonClient().auth.signInWithPassword({
      email: linked.email,
      password: currentPassword,
    });
    if (verifyError) {
      throw new AuthError("INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    const { error } = await adminClient().auth.admin.updateUserById(linked.supabaseUserId, {
      password: newPassword,
    });
    if (error) {
      throw new AuthError("PROVIDER_ERROR", "Supabase rejected the new password.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
  },

  async createUser({ email, password, fullName, roleCodes }) {
    const problem = passwordProblem(password);
    if (problem) throw new AuthError("VALIDATION", problem);

    const normalized = normalizeEmail(email);

    const roles = await prisma.role.findMany({
      where: { code: { in: roleCodes } },
      select: { id: true, code: true },
    });
    if (roles.length !== roleCodes.length) {
      const known = new Set(roles.map((role) => role.code));
      const missing = roleCodes.filter((code) => !known.has(code));
      throw new AuthError("VALIDATION", `Unknown role: ${missing.join(", ")}`);
    }

    const { data, error } = await adminClient().auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new AuthError(
        "PROVIDER_ERROR",
        error?.message ?? "Supabase could not create the user.",
      );
    }

    const created = await prisma.user.create({
      data: {
        email: normalized,
        fullName: fullName.trim(),
        supabaseUserId: data.user.id,
        mustChangePassword: true,
        userRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      select: { id: true },
    });

    return { userId: created.id };
  },
};
