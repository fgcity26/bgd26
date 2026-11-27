import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time verification of Meta's `X-Hub-Signature-256` header.
 *
 * Meta sends `sha256=<hex>`. The comparison must not leak length or prefix
 * information, so both sides are hashed to a fixed-size buffer first.
 */
export function verifyHmacSha256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;

  const provided = signatureHeader.slice(prefix.length).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const actual = Buffer.from(provided, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
