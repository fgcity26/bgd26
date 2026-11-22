/**
 * Interactive .env.local setup.
 *
 * Asks for the four values the app needs, validates them, and rewrites only
 * those lines in .env.local. No editor required, and no secret is ever echoed
 * back in full.
 *
 *   npm run env:setup
 *
 * Non-interactive (values may land in shell history — prefer the prompts):
 *   npm run env:setup -- --database-url='postgresql://...' --direct-url='postgresql://...' \
 *                        --anon='eyJ...' --service='eyJ...'
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const FILE = ".env.local";

function mask(value) {
  if (!value) return "(empty)";
  if (value.length <= 10) return "*".repeat(value.length);
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function validateUrl(value) {
  if (/^[A-Z_]+=/.test(value)) {
    return "paste only the value, without DATABASE_URL= or DIRECT_URL=";
  }
  if (!/^postgres(ql)?:\/\//.test(value)) return "must start with postgresql://";
  if (value.includes("REPLACE_")) return "still contains a REPLACE_ placeholder";
  if (!value.includes("@")) return "missing the user:password@host part";
  if (value.indexOf("@") !== value.lastIndexOf("@")) {
    return "the password contains '@' — write it as %40 (e.g. Abc%40123)";
  }
  if (value.includes(" ") || value.includes('"')) return "remove spaces and quotes";
  if (!value.includes(":5432") && !value.includes(":6543")) {
    return "missing the port (:6543 for pooled, :5432 for direct)";
  }
  return null;
}

function validateKey(value, label) {
  const legacyJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
  const newKey = /^sb_(publishable|secret)_[A-Za-z0-9_-]+$/.test(value);
  if (!legacyJwt && !newKey) {
    return `${label} does not look like a Supabase key (JWT or sb_publishable_/sb_secret_)`;
  }
  return null;
}

async function ask(rl, question, existing, validator, label) {
  while (true) {
    const answer = (await rl.question(`${question}\n> `)).trim();
    if (!answer) {
      if (existing && !existing.startsWith("REPLACE_")) return existing;
      console.log("  A value is required. Try again, or press Ctrl+C to quit.\n");
      continue;
    }
    const problem = validator(answer, label);
    if (problem) {
      console.log(`  ${problem}. Try again.\n`);
      continue;
    }
    return answer;
  }
}

const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const currentValue = (key) =>
  current.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.replace(/^"|"$/g, "") ?? "";

let values = {
  DATABASE_URL: arg("database-url"),
  DIRECT_URL: arg("direct-url"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: arg("anon"),
  SUPABASE_SERVICE_ROLE_KEY: arg("service"),
};

const missing = Object.entries(values).filter(([, v]) => !v);
if (missing.length > 0) {
  const rl = createInterface({ input, output });
  console.log(`
bgd26 — environment setup
=========================
Paste each value, then press Enter. Nothing is sent anywhere.
Get both URLs from Supabase Dashboard -> Connect.
`);

  if (!values.DATABASE_URL) {
    values.DATABASE_URL = await ask(
      rl,
      "1/4  DATABASE_URL  (Transaction pooler, port 6543)",
      currentValue("DATABASE_URL"),
      validateUrl,
      "DATABASE_URL",
    );
  }
  if (!values.DIRECT_URL) {
    values.DIRECT_URL = await ask(
      rl,
      "2/4  DIRECT_URL  (Direct connection, port 5432)",
      currentValue("DIRECT_URL"),
      validateUrl,
      "DIRECT_URL",
    );
  }
  if (!values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    values.NEXT_PUBLIC_SUPABASE_ANON_KEY = await ask(
      rl,
      "3/4  NEXT_PUBLIC_SUPABASE_ANON_KEY  (public, safe in the browser)",
      currentValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      validateKey,
      "anon key",
    );
  }
  if (!values.SUPABASE_SERVICE_ROLE_KEY) {
    values.SUPABASE_SERVICE_ROLE_KEY = await ask(
      rl,
      "4/4  SUPABASE_SERVICE_ROLE_KEY  (secret, server only)",
      currentValue("SUPABASE_SERVICE_ROLE_KEY"),
      validateKey,
      "service-role key",
    );
  }
  rl.close();
}

if (
  values.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  values.NEXT_PUBLIC_SUPABASE_ANON_KEY === values.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error("\nThe anon key and service-role key are identical. They must differ.");
  process.exit(1);
}

// Start from the existing file, or the template if this is a fresh checkout.
let text = current;
if (!text) {
  text = existsSync(".env.example")
    ? readFileSync(".env.example", "utf8")
    : "NODE_ENV=development\n";
}

for (const [key, value] of Object.entries(values)) {
  if (!value) continue;
  const line = `${key}="${value.replace(/"/g, '\\"')}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

const tmp = `${FILE}.tmp`;
writeFileSync(tmp, text, { mode: 0o600 });
chmodSync(tmp, 0o600);
renameSync(tmp, FILE);

console.log(`
.env.local updated
==================`);
for (const [key, value] of Object.entries(values)) {
  console.log(`  ${key.padEnd(34)} ${mask(value)}`);
}
console.log(`
Next:
  npm run env:check
  npm run db:deploy
  npm run db:seed
  npm run dev
`);
