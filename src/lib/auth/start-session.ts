import type { AuthProvider } from "./token";
import { SESSION_VERSION, signSessionToken, type SessionPayload } from "./token";
import { sessionTtlSeconds, writeSessionCookie } from "./cookies";

/**
 * Issue a session after the adapter has verified the credentials.
 *
 * The token is bound to our own `users.id`, not the provider's id, so deleting
 * a Supabase user or changing their email cannot silently transfer a session.
 */
export async function startSession(
  user: { id: string; email: string },
  provider: AuthProvider,
): Promise<SessionPayload> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider,
    issuedAt,
    expiresAt: issuedAt + sessionTtlSeconds(),
  };

  await writeSessionCookie(signSessionToken(payload));
  return payload;
}
