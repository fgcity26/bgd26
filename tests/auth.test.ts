import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { localAuthAdapter } from "../src/lib/adapters/auth/local";
import { AuthError } from "../src/lib/adapters/auth/types";
import { loadAccess } from "../src/lib/auth/permissions";
import { passwordProblem, pinProblem } from "../src/lib/auth/policy";
import {
  SESSION_VERSION,
  signSessionToken,
  verifySessionToken,
} from "../src/lib/auth/token";
import { hashPin, hashSecret, verifyPin, verifySecret } from "../src/lib/password";
import { prisma } from "../src/lib/db";

const run = randomBytes(4).toString("hex");
const emailFor = (label: string) => `test-${label}-${run}@example.test`;

const payload = {
  v: SESSION_VERSION as typeof SESSION_VERSION,
  userId: "user_123",
  email: "cashier@example.test",
  provider: "local" as const,
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_000 + 3600,
};

test("session token round-trips and rejects tampering", () => {
  const token = signSessionToken(payload);
  const decoded = verifySessionToken(token, 1_700_000_100);
  assert.ok(decoded);
  assert.equal(decoded.userId, payload.userId);
  assert.equal(decoded.provider, "local");

  // Flip one character of the payload.
  const [body, signature] = token.split(".");
  const tamperedBody = `${body.slice(0, -2)}${body.endsWith("A") ? "B" : "A"}${body.slice(-1)}`;
  assert.equal(verifySessionToken(`${tamperedBody}.${signature}`, 1_700_000_100), null);

  // Flip one character of the signature.
  const tamperedSignature = `${signature.slice(0, -2)}${signature.endsWith("A") ? "B" : "A"}${signature.slice(-1)}`;
  assert.equal(verifySessionToken(`${body}.${tamperedSignature}`, 1_700_000_100), null);

  // Garbage and truncated tokens.
  assert.equal(verifySessionToken("", 1_700_000_100), null);
  assert.equal(verifySessionToken("only-one-part", 1_700_000_100), null);
});

test("session token expires and rejects future timestamps", () => {
  const token = signSessionToken(payload);
  assert.equal(verifySessionToken(token, payload.expiresAt + 1), null);
  assert.ok(verifySessionToken(token, payload.expiresAt - 1));

  const future = signSessionToken({
    ...payload,
    issuedAt: 1_700_001_000,
    expiresAt: 1_700_002_000,
  });
  assert.equal(verifySessionToken(future, 1_700_000_000), null);
});

test("password policy is explained, not guessed", () => {
  assert.match(passwordProblem("short1") ?? "", /at least 10/);
  assert.match(passwordProblem("nodigitshere") ?? "", /number/);
  assert.match(passwordProblem("1234567890") ?? "", /letter/);
  assert.equal(passwordProblem("DhakaShop2026"), null);
});

test("manager PIN policy blocks trivial PINs", () => {
  assert.match(pinProblem("12345") ?? "", /six digits/);
  assert.match(pinProblem("111111") ?? "", /same digit/);
  assert.match(pinProblem("123456") ?? "", /sequence/);
  assert.match(pinProblem("654321") ?? "", /sequence/);
  assert.equal(pinProblem("482913"), null);
});

test("PIN hashing uses the pepper and rejects the wrong PIN", async () => {
  const encoded = await hashPin("482913");
  assert.equal(await verifyPin("482913", encoded), true);
  assert.equal(await verifyPin("482914", encoded), false);
  assert.equal(await verifyPin("12345", encoded), false);
  assert.notEqual(encoded, await hashPin("482913")); // unique salt each time
});

test("passwords are salted scrypt hashes", async () => {
  const encoded = await hashSecret("DhakaShop2026");
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifySecret("DhakaShop2026", encoded), true);
  assert.equal(await verifySecret("dhakashop2026", encoded), false);
});

test("role permissions are resolved from the database", async () => {
  const role = await prisma.role.findUnique({
    where: { code: "CASHIER" },
    select: { id: true },
  });
  assert.ok(role, "CASHIER role must be seeded");

  const user = await prisma.user.create({
    data: {
      email: emailFor("rbac"),
      fullName: "RBAC Test",
      userRoles: { create: [{ roleId: role.id }] },
    },
    select: { id: true },
  });

  try {
    const access = await loadAccess(user.id);
    assert.deepEqual(access.roles, ["CASHIER"]);
    assert.equal(access.permissions.has("pos.write"), true);
    assert.equal(access.permissions.has("customer.read"), true);
    assert.equal(access.permissions.has("role.write"), false);
    assert.equal(access.permissions.has("account.read"), false);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("local adapter signs in, counts failures and locks after five", async () => {
  const email = emailFor("login");
  const password = "CounterPass2026";

  const user = await prisma.user.create({
    data: {
      email,
      fullName: "Login Test",
      passwordHash: await hashSecret(password),
      mustChangePassword: true,
    },
    select: { id: true },
  });

  try {
    // Wrong password → invalid credentials, one recorded failure.
    await assert.rejects(
      localAuthAdapter.signInWithPassword({ email, password: "WrongPass2026" }),
      (error: unknown) =>
        error instanceof AuthError && error.code === "INVALID_CREDENTIALS",
    );
    let row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true },
    });
    assert.equal(row?.failedLoginCount, 1);
    assert.equal(row?.lockedUntil, null);

    // Four more failures → 15-minute lock.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(
        localAuthAdapter.signInWithPassword({ email, password: "WrongPass2026" }),
        (error: unknown) => error instanceof AuthError,
      );
    }

    row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true },
    });
    assert.equal(row?.failedLoginCount, 0);
    assert.ok(row?.lockedUntil && row.lockedUntil.getTime() > Date.now());

    // Even the correct password is refused while locked.
    await assert.rejects(
      localAuthAdapter.signInWithPassword({ email, password }),
      (error: unknown) => error instanceof AuthError && error.code === "LOCKED",
    );

    // Clear the lock as an owner override would, then sign in successfully.
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: null, failedLoginCount: 0 },
    });

    const signedIn = await localAuthAdapter.signInWithPassword({ email, password });
    assert.equal(signedIn.id, user.id);
    assert.equal(signedIn.mustChangePassword, true);

    row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true },
    });
    assert.equal(row?.failedLoginCount, 0);
    assert.ok(row?.lastLoginAt instanceof Date);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("local adapter never reveals whether an email exists", async () => {
  await assert.rejects(
    localAuthAdapter.signInWithPassword({
      email: emailFor("missing"),
      password: "AnyPassword2026",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "INVALID_CREDENTIALS");
      assert.equal(error.message, "Email or password is incorrect.");
      return true;
    },
  );
});
