/**
 * Environment completeness check.
 *
 * Reads .env.local (and .env as fallback) and reports whether the values the
 * app needs are present and well-formed. It NEVER prints a secret — only a
 * masked fingerprint, so the output is safe to paste in a chat or CI log.
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const isPlaceholder = (value) =>
  value.length === 0 ||
  value.startsWith("REPLACE_") ||
  value.startsWith("REPLACE-") ||
  /^<.*>$/.test(value);

const rows = [];
let failures = 0;

function mask(value) {
  if (!value) return "(empty)";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)`;
}

function check(name, { required = true, validate } = {}) {
  const value = process.env[name] ?? "";
  let ok = !isPlaceholder(value);

  if (ok && validate) {
    const problem = validate(value);
    if (problem) {
      ok = false;
      rows.push(["FAIL", name, problem]);
      failures += 1;
      return;
    }
  }

  rows.push([ok ? "ok" : required ? "FAIL" : "warn", name, mask(value)]);
  if (!ok && required) failures += 1;
}

const isPostgresUrl = (value) => {
  if (!/^postgres(ql)?:\/\//.test(value)) return "must start with postgresql://";
  if (value.includes("REPLACE_")) return "still contains REPLACE_ placeholder";
  if (!/@[^/]+\//.test(value)) return "missing host/password section";
  return null;
};

// Supabase now issues either a legacy JWT or a new sb_publishable_/sb_secret_ key.
const isSupabaseKey = (value) =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
  /^sb_(publishable|secret)_[A-Za-z0-9_-]+$/.test(value)
    ? null
    : "expected a JWT or an sb_publishable_/sb_secret_ key";

// --- required for module 1 ---
check("DATABASE_URL", { validate: isPostgresUrl });
check("DIRECT_URL", { validate: isPostgresUrl });
check("NEXT_PUBLIC_SUPABASE_URL", {
  validate: (v) => (/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) ? null : "expected https://<ref>.supabase.co"),
});
check("NEXT_PUBLIC_SUPABASE_ANON_KEY", { validate: isSupabaseKey });
check("SUPABASE_SERVICE_ROLE_KEY", { validate: isSupabaseKey });
check("SUPABASE_JWT_SECRET", { required: false });

// --- module 2: authentication ---
check("AUTH_PROVIDER", {
  required: false,
  validate: (v) => (v === "local" || v === "supabase" ? null : "expected local or supabase"),
});
check("AUTH_SECRET", {
  required: false,
  validate: (v) => (v.length >= 32 ? null : "must be at least 32 characters"),
});
check("MANAGER_PIN_PEPPER", {
  required: false,
  validate: (v) => (v.length >= 16 ? null : "must be at least 16 characters"),
});

const provider =
  process.env.AUTH_PROVIDER?.trim() ||
  (process.env.NODE_ENV === "production" ? "supabase" : "local");
rows.push(["info", "auth provider", provider]);

// --- module 3: object storage ---
check("STORAGE_PROVIDER", {
  required: false,
  validate: (v) => (v === "local" || v === "supabase" ? null : "expected local or supabase"),
});
check("SUPABASE_STORAGE_BUCKET", { required: false });
check("STORAGE_LOCAL_DIR", { required: false });
check("MEDIA_MAX_UPLOAD_BYTES", {
  required: false,
  validate: (v) => (/^\d+$/.test(v) && Number(v) > 0 ? null : "must be a positive byte count"),
});

const storage =
  process.env.STORAGE_PROVIDER?.trim() ||
  (process.env.NODE_ENV === "production" ? "supabase" : "local");
rows.push(["info", "storage provider", storage]);

// --- sanity ---
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!isPlaceholder(anon) && !isPlaceholder(service) && anon === service) {
  rows.push(["FAIL", "key separation", "anon and service-role keys are identical"]);
  failures += 1;
}

const servicePublic = Object.keys(process.env).find(
  (key) => key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE/i.test(key),
);
if (servicePublic) {
  rows.push(["FAIL", "service key exposure", `${servicePublic} is client-visible`]);
  failures += 1;
}

// --- git protection ---
const ignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
const blocksEnv = /^\.env$/m.test(ignore) && /^\.env\.\*$/m.test(ignore);
rows.push([
  blocksEnv ? "ok" : "FAIL",
  ".gitignore blocks .env*",
  blocksEnv ? "yes" : "missing rules",
]);
if (!blocksEnv) failures += 1;

rows.push(["info", "env file in use", existsSync(".env.local") ? ".env.local" : ".env"]);

const width = Math.max(...rows.map(([state, name]) => `${state} ${name}`.length));
console.log("\nEnvironment check");
console.log("=================");
for (const [state, name, detail] of rows) {
  console.log(`${`${state} ${name}`.padEnd(width)}  ${detail}`);
}

console.log(
  `\n${failures === 0 ? "PASS — ready to migrate and run." : `${failures} value(s) still need attention.`}`,
);
console.log("Secrets are masked; this output is safe to share.\n");

process.exitCode = failures === 0 ? 0 : 1;
