import { headers } from "next/headers";

/**
 * Request metadata for the audit trail. Never used for authorisation.
 */
export async function requestMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() || store.get("x-real-ip") || null;
  const userAgent = store.get("user-agent");

  return {
    ipAddress: ipAddress ? ipAddress.slice(0, 64) : null,
    userAgent: userAgent ? userAgent.slice(0, 400) : null,
  };
}
