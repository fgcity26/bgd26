/**
 * One-command local database for development.
 *
 *   npm run db:local:setup
 *
 * Starts Prisma's local PostgreSQL server (background), creates the `bgd26`
 * database if it is missing, and writes DATABASE_URL / DIRECT_URL into
 * .env.local. Your previous .env.local is backed up first, so Supabase values
 * are never lost.
 *
 * Then run:
 *   npm run db:deploy && npm run db:seed && npm run dev
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const NAME = process.env.PRISMA_DEV_NAME ?? "bgd26dev";
const DB_NAME = "bgd26";
const ENV_FILE = ".env.local";

function stateFile() {
  const candidates = [];
  if (platform() === "win32") {
    candidates.push(join(process.env.LOCALAPPDATA ?? "", "prisma-dev-nodejs", NAME, "server.json"));
  } else if (platform() === "darwin") {
    candidates.push(
      join(homedir(), "Library", "Application Support", "prisma-dev-nodejs", NAME, "server.json"),
    );
  }
  candidates.push(
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "prisma-dev-nodejs", NAME, "server.json"),
  );
  return candidates.find((p) => existsSync(p));
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!existsSync("package.json")) {
  fail(
    "Run this from the project folder:\n" +
      '  cd "/home/mr/Documents/Default Project" && npm run db:local:setup',
  );
}

console.log("Starting the local PostgreSQL server (Prisma dev)…");
const started = spawnSync("npx", ["prisma", "dev", "--detach", "--name", NAME], {
  stdio: "inherit",
  shell: platform() === "win32",
});

const file = stateFile();
if (!file) {
  fail(
    "Could not find the Prisma dev state file.\n" +
      "Try running it once in the foreground to see the error:\n" +
      "  npx prisma dev --name " +
      NAME,
  );
}

const state = JSON.parse(readFileSync(file, "utf8"));
const base = state?.exports?.database?.connectionString;
if (!base) {
  fail(
    "Prisma dev did not report a connection string." +
      (started.status !== 0 ? "\nCheck the output above for the reason." : ""),
  );
}

const url = new URL(base);
url.pathname = `/${DB_NAME}`;

const admin = new URL(base);
admin.pathname = "/postgres";
admin.searchParams.delete("connection_limit");

const client = new Client({ connectionString: admin.toString() });
try {
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [DB_NAME]);
  if (exists.rowCount === 0) {
    await client.query(`create database "${DB_NAME}"`);
    console.log(`Created database ${DB_NAME}.`);
  } else {
    console.log(`Database ${DB_NAME} already exists.`);
  }
} catch (error) {
  fail(`Could not reach the local database: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}

const connection = url.toString();

// Back up the current file once per day, so Supabase values survive the switch.
let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (text) {
  const stamp = new Date().toISOString().slice(0, 10);
  const backup = `${ENV_FILE}.bak-${stamp}`;
  if (!existsSync(backup)) {
    copyFileSync(ENV_FILE, backup);
    chmodSync(backup, 0o600);
    console.log(`Backed up ${ENV_FILE} → ${backup}`);
  }
}

if (!text) {
  text = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
}

for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const line = `${key}="${connection}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

const tmp = `${ENV_FILE}.tmp`;
writeFileSync(tmp, text, { mode: 0o600 });
chmodSync(tmp, 0o600);
renameSync(tmp, ENV_FILE);

console.log(`\nLocal database ready
====================
  DATABASE_URL  ${connection}
  written to    ${ENV_FILE} (chmod 600)

Next:
  npm run db:deploy
  npm run db:seed
  npm run dev
`);
