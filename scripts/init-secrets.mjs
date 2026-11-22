/**
 * Generate the application secrets that `.env.local` needs.
 *
 *   npm run secrets:init
 *
 * Idempotent: existing values are never replaced, so running it again after
 * adding a new key only fills the gap. Values are printed masked.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const FILE = ".env.local";

const SECRETS = [
  { key: "AUTH_SECRET", bytes: 48, note: "session cookie signing" },
  { key: "MANAGER_PIN_PEPPER", bytes: 32, note: "manager PIN pepper" },
  { key: "FIELD_ENCRYPTION_KEY", bytes: 32, note: "encrypted fields" },
  { key: "CRON_SECRET", bytes: 32, note: "scheduled jobs" },
  { key: "RATE_LIMIT_SALT", bytes: 16, note: "rate-limit keys" },
];

function mask(value) {
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

let text = existsSync(FILE)
  ? readFileSync(FILE, "utf8")
  : existsSync(".env.example")
    ? readFileSync(".env.example", "utf8")
    : "";

const added = [];
const kept = [];

for (const secret of SECRETS) {
  const match = text.match(new RegExp(`^${secret.key}=(.*)$`, "m"));
  const current = match?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  const usable =
    current.length >= 16 &&
    !current.startsWith("REPLACE_") &&
    !/^<.*>$/.test(current);

  if (usable) {
    kept.push(secret.key);
    continue;
  }

  const value = randomBytes(secret.bytes).toString("base64");
  const line = `${secret.key}="${value}"`;
  text = match
    ? text.replace(match[0], line)
    : `${text.trimEnd()}\n${line}\n`;
  added.push([secret.key, value, secret.note]);
}

if (added.length > 0) {
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, FILE);
}

console.log("\nApplication secrets");
console.log("===================");
for (const [key, value, note] of added) {
  console.log(`  generated  ${key.padEnd(24)} ${mask(value)}  (${note})`);
}
for (const key of kept) {
  console.log(`  present    ${key}`);
}
if (added.length === 0) console.log("  nothing to do — all secrets are already set.");
console.log("");
