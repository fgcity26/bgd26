"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthAdapter, AuthError } from "@/lib/adapters/auth";
import { audit } from "@/lib/auth/audit";
import { normalizeEmail } from "@/lib/auth/policy";
import { requestMeta } from "@/lib/auth/request-meta";
import { startSession } from "@/lib/auth/start-session";

export type LoginState = {
  error?: string;
  email?: string;
};

const schema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

/** Only same-site absolute paths are allowed as a redirect target. */
function safeNext(value: string | undefined): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Enter your email and password." };
  }

  const email = normalizeEmail(parsed.data.email);
  const meta = await requestMeta();
  const adapter = getAuthAdapter();

  let user;
  try {
    user = await adapter.signInWithPassword({
      email,
      password: parsed.data.password,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      await audit({
        action: "auth.login.failed",
        entityType: "user",
        metadata: { email, code: error.code, provider: adapter.provider },
        ...meta,
      });
      return { error: error.message, email };
    }

    console.error("[auth] unexpected sign-in failure", error);
    return {
      error: "Could not sign in right now. Please try again.",
      email,
    };
  }

  await audit({
    actorUserId: user.id,
    action: "auth.login.succeeded",
    entityType: "user",
    entityId: user.id,
    metadata: { provider: adapter.provider },
    ...meta,
  });

  await startSession(user, adapter.provider);

  redirect(user.mustChangePassword ? "/account/password" : safeNext(parsed.data.next));
}
