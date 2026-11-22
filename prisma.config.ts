import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI never loads .env files by itself in v7. Load .env.local first
// (Next.js convention) and fall back to .env. Later files do not override.
loadEnv({ path: [".env.local", ".env"], quiet: true });
const migrationUrl =
  process.env.DIRECT_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl,
  },
});
