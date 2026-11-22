/**
 * End-to-end auth verification against a running server.
 *
 *   npm run build
 *   npm start                    # in another terminal
 *   npm run verify:auth
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100 npm run verify:auth
 *
 * Proves, over real HTTP: unauthenticated redirects, signed-cookie access,
 * tamper rejection, forced password change, disabled-account rejection and the
 * login page's signed-in redirect. Creates and deletes one temporary cashier.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.SESSION_COOKIE_NAME?.trim() || "bgd26_session";

let failures = 0;
let checks = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  checks += 1;
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${(error as Error).message}`);
  }
}

function sessionCookie(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken({
    v: SESSION_VERSION,
    userId: user.id,
    email: user.email,
    provider: "local",
    issuedAt: now,
    expiresAt: now + 3600,
  });
  return `${COOKIE}=${token}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const body = await response.text();
  return { status: response.status, location: response.headers.get("location") ?? "", body };
}

const seededOwner = await prisma.user.findUnique({
  where: { email: process.env.SEED_OWNER_EMAIL?.trim() || "owner@bgd26.com" },
  select: { id: true, mustChangePassword: true },
});

if (!seededOwner) {
  console.error("Owner account not found. Run: npm run db:seed");
  process.exit(1);
}

if (seededOwner.mustChangePassword) {
  console.warn(
    "note The seeded owner must still change the temporary password (by design).\n" +
      "     This script uses a temporary verification account instead.\n",
  );
}

const ownerRole = await prisma.role.findUnique({
  where: { code: "OWNER" },
  select: { id: true },
});
assert.ok(ownerRole, "OWNER role missing; run npm run db:seed");

// A throwaway account with full permissions, so the real owner row is untouched.
const staff = await prisma.user.create({
  data: {
    email: `verify-owner-${randomBytes(4).toString("hex")}@example.test`,
    fullName: "Verify Owner",
    userRoles: { create: [{ roleId: ownerRole.id }] },
  },
  select: { id: true, email: true },
});

const ownerCookie = sessionCookie(staff);

await check("login page renders for anonymous visitors", async () => {
  const response = await get("/login");
  assert.equal(response.status, 200);
  assert.match(response.body, /Staff sign in/);
});

await check("dashboard without a cookie redirects to /login", async () => {
  const response = await get("/dashboard");
  assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
  assert.match(response.location, /\/login/);
});

await check("a tampered cookie is rejected", async () => {
  const [name, token] = ownerCookie.split("=");
  const broken = `${token.slice(0, -3)}xyz`;
  const response = await get("/dashboard", `${name}=${broken}`);
  assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
  assert.match(response.location, /\/login/);
});

await check("a signed cookie reaches the dashboard", async () => {
  const response = await get("/dashboard", ownerCookie);
  assert.equal(response.status, 200);
  assert.match(response.body, /Welcome,/);
});

await check("profile page renders with the account facts", async () => {
  const response = await get("/profile", ownerCookie);
  assert.equal(response.status, 200);
  assert.match(response.body, /Manager PIN/);
});

await check("signed-in visitors skip the login page", async () => {
  const response = await get("/login", ownerCookie);
  assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
  assert.match(response.location, /\/(dashboard|account\/password)/);
});

// --- a cashier who must change the temporary password ---------------------
const cashierRole = await prisma.role.findUnique({
  where: { code: "CASHIER" },
  select: { id: true },
});
assert.ok(cashierRole, "CASHIER role missing; run npm run db:seed");

const cashier = await prisma.user.create({
  data: {
    email: `verify-${randomBytes(4).toString("hex")}@example.test`,
    fullName: "Verify Cashier",
    mustChangePassword: true,
    userRoles: { create: [{ roleId: cashierRole.id }] },
  },
  select: { id: true, email: true },
});

try {
  const cashierCookie = sessionCookie(cashier);

  await check("forced password change redirects every console page", async () => {
    for (const path of ["/dashboard", "/profile"]) {
      const response = await get(path, cashierCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path}: ${response.status}`);
      assert.match(response.location, /\/account\/password/);
    }
  });

  await check("the password page is reachable while the change is pending", async () => {
    const response = await get("/account/password", cashierCookie);
    assert.equal(response.status, 200);
    assert.match(response.body, /Set your own password/);
  });

  await check("a disabled account loses access immediately", async () => {
    await prisma.user.update({ where: { id: cashier.id }, data: { status: "SUSPENDED" } });
    const response = await get("/dashboard", cashierCookie);
    assert.ok([302, 303, 307, 308].includes(response.status), `status ${response.status}`);
    assert.match(response.location, /\/login/);
  });
} finally {
  await prisma.user.delete({ where: { id: cashier.id } });
  await prisma.user.delete({ where: { id: staff.id } });
  await prisma.$disconnect();
}

console.log(`\n${checks - failures}/${checks} checks behaved as expected.`);
if (failures > 0) process.exit(1);
