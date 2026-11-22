import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * Validated lazily so a build without secrets still compiles; any route that
 * actually needs the value fails fast with a readable message instead of a
 * confusing runtime error deep inside a provider SDK.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(["bn", "en"]).default("bn"),
  TZ: z.string().default("Asia/Dhaka"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Authentication: local (own password hashes) or Supabase Auth.
  AUTH_PROVIDER: z.enum(["local", "supabase"]).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  MANAGER_PIN_PEPPER: z.string().min(16).optional(),
  SESSION_COOKIE_NAME: z.string().min(1).default("bgd26_session"),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),

  // Optional until the corresponding module is switched on.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${lines}`);
  }

  cached = parsed.data;
  return cached;
}
