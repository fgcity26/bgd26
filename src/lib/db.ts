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

export function getPrisma(): PrismaClient {
  if (globalForPrisma.bgd26Prisma) return globalForPrisma.bgd26Prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    // The pooler already multiplexes connections; keep the app pool small.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
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
