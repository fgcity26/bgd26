import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * One Prisma client per process.
 *
 * The client is created lazily so that importing a module during `next build`
 * never requires a live database. The runtime connection uses the pooled
 * `DATABASE_URL` (Supabase transaction pooler, port 6543) through the
 * node-postgres driver adapter. Migrations use `DIRECT_URL` from
 * `prisma.config.ts` instead.
 */
const globalForPrisma = globalThis as unknown as {
  bgd26Prisma?: PrismaClient;
};

/**
 * Supabase's pooler presents a certificate chain signed by its own CA, which is
 * not in the public trust store. Without this, every TLS connection fails with
 * `SELF_SIGNED_CERT_IN_CHAIN` (including Vercel builds that prerender data).
 *
 * Set `DATABASE_SSL_CA` to the PEM from Supabase → Database → SSL
 * configuration (or `prisma/certs/supabase-prod-ca-2021.crt`) to get full
 * `verify-full` semantics: chain and hostname are both checked.
 */
export function databaseSsl(): { ca: string; rejectUnauthorized: true } | undefined {
  const raw = process.env.DATABASE_SSL_CA?.trim();
  if (!raw) return undefined;
  return { ca: raw.replace(/\\n/g, "\n"), rejectUnauthorized: true };
}

const SSL_PARAMS = ["sslmode", "uselibpqcompat", "sslrootcert", "sslcert", "sslkey"];

/**
 * Drop SSL query parameters when an explicit `ssl` object is supplied:
 * node-postgres treats `sslmode=require` as `verify-full`, and mixing the two
 * would let the URL override the CA we just configured.
 */
export function withoutSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  for (const key of SSL_PARAMS) url.searchParams.delete(key);
  return url.toString();
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.bgd26Prisma) return globalForPrisma.bgd26Prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const ssl = databaseSsl();
  const adapter = new PrismaPg({
    connectionString: ssl ? withoutSslParams(connectionString) : connectionString,
    // The pooler already multiplexes connections; keep the app pool small.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ...(ssl ? { ssl } : {}),
  });

  const client = new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

  // Always cache on the global object. Caching only in development (a common
  // pattern for hot reload) would create a new pool on every property access in
  // production, which exhausts database connections within seconds.
  globalForPrisma.bgd26Prisma = client;

  return client;
}

/**
 * Ergonomic proxy: `prisma.order.findMany()` works while still creating the
 * client lazily on first property access.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrisma() as object, property, receiver);
  },
});
