import type { AuthProvider } from "@/lib/auth/token";
import { localAuthAdapter } from "./local";
import { supabaseAuthAdapter } from "./supabase";
import type { AuthAdapter } from "./types";

/**
 * Which credential store to use.
 *
 * Explicit `AUTH_PROVIDER=local|supabase` always wins. Otherwise production
 * defaults to Supabase (the deployed identity store) and every other
 * environment defaults to local, so a developer never needs a Supabase project
 * to sign in.
 */
export function authProvider(): AuthProvider {
  const explicit = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return process.env.NODE_ENV === "production" ? "supabase" : "local";
}

export function getAuthAdapter(): AuthAdapter {
  return authProvider() === "supabase" ? supabaseAuthAdapter : localAuthAdapter;
}

export { AuthError, type AuthAdapter, type AuthUser } from "./types";
export { LOCKOUT_POLICY } from "./shared";
