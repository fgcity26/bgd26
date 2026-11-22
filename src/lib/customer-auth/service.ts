import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hashSecret, verifySecret } from "@/lib/password";
import { normalizeEmail, passwordProblem } from "@/lib/auth/policy";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";

/**
 * Storefront customer accounts.
 *
 * The mobile number is the identity. A guest customer already exists after a
 * first order, so registration either creates the row or claims the existing
 * one. Claiming a number that already has orders needs one order number from
 * that record: without an SMS gateway, that is the only ownership proof the
 * shop can ask for. The sign-in lockout mirrors the staff rule (five failures,
 * fifteen minutes).
 */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export const CUSTOMER_LOCKOUT = { maxFailedAttempts: 5, lockMinutes: 15 } as const;

const WALK_IN_MOBILE = "+8800000000000";

/**
 * Run inside a caller's transaction when one is supplied. That lets the tests
 * exercise the real SQL and roll back afterwards, exactly like the other
 * services.
 */
function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (outer) return work(outer);
  return prisma.$transaction(work);
}

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function emailProblem(value: string): string | null {
  if (!value) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "Enter a valid email address.";
  if (value.length > 200) return "That email address is too long.";
  return null;
}

function mobileOrThrow(value: string): string {
  const normalized = tryNormalizeBdMobile(value);
  if (!normalized) throw new AccountError("Enter a valid Bangladeshi mobile number.");
  if (normalized === WALK_IN_MOBILE) throw new AccountError("That mobile number cannot be used.");
  return normalized;
}

export type RegisterCustomerInput = {
  fullName: string;
  mobile: string;
  password: string;
  confirmPassword?: string;
  email?: string;
  /** Needed only when the mobile already has orders from guest checkout. */
  orderNumber?: string;
};

export type CustomerAccount = {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
};

/** Create an account, or claim the guest record left by an earlier order. */
export async function registerCustomer(
  input: RegisterCustomerInput,
  outer?: Prisma.TransactionClient,
): Promise<CustomerAccount> {
  const mobile = mobileOrThrow(input.mobile);
  const fullName = clean(input.fullName, 120);
  if (fullName.length < 2) throw new AccountError("Enter your full name.");

  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    throw new AccountError("The two passwords do not match.");
  }
  const problem = passwordProblem(input.password);
  if (problem) throw new AccountError(problem);

  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const emailIssue = emailProblem(email ?? "");
  if (emailIssue) throw new AccountError(emailIssue);

  const passwordHash = await hashSecret(input.password);
  const orderNumber = clean(input.orderNumber, 60);

  const customer = await run(outer, async (tx) => {
    const existing = await tx.customer.findUnique({
      where: { mobileNormalized: mobile },
      select: {
        id: true,
        fullName: true,
        email: true,
        passwordHash: true,
        status: true,
        deletedAt: true,
      },
    });

    if (existing) {
      if (existing.deletedAt || existing.status === "BLOCKED") {
        throw new AccountError("This account cannot be used. Please contact the shop.");
      }
      if (existing.passwordHash) {
        throw new AccountError(
          "This mobile number already has an account. Sign in instead.",
        );
      }

      const orderCount = await tx.order.count({ where: { customerId: existing.id } });
      if (orderCount > 0) {
        if (!orderNumber) {
          throw new AccountError(
            "This mobile number already has orders. Enter one order number from that number to prove it is yours.",
          );
        }
        const proof = await tx.order.findFirst({
          where: { customerId: existing.id, orderNumber },
          select: { id: true },
        });
        if (!proof) {
          throw new AccountError(
            "That order number does not belong to this mobile number.",
          );
        }
      }

      return tx.customer.update({
        where: { id: existing.id },
        data: {
          fullName,
          email: email ?? existing.email,
          passwordHash,
          passwordUpdatedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          accountClaimedAt: new Date(),
        },
        select: { id: true, fullName: true, mobileNormalized: true, email: true },
      });
    }

    return tx.customer.create({
      data: {
        mobileNormalized: mobile,
        mobileRaw: input.mobile.trim(),
        fullName,
        email,
        customerType: "RETAIL",
        passwordHash,
        passwordUpdatedAt: new Date(),
        lastLoginAt: new Date(),
        accountClaimedAt: new Date(),
      },
      select: { id: true, fullName: true, mobileNormalized: true, email: true },
    });
  });

  return {
    id: customer.id,
    fullName: customer.fullName,
    mobile: customer.mobileNormalized,
    email: customer.email,
  };
}

/** Sign in with mobile and password. */
export async function signInCustomer(
  input: {
    mobile: string;
    password: string;
  },
  outer?: Prisma.TransactionClient,
): Promise<CustomerAccount> {
  const mobile = mobileOrThrow(input.mobile);

  const client = outer ?? prisma;

  const customer = await client.customer.findUnique({
    where: { mobileNormalized: mobile },
    select: {
      id: true,
      fullName: true,
      mobileNormalized: true,
      email: true,
      passwordHash: true,
      status: true,
      deletedAt: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!customer || customer.deletedAt) {
    throw new AccountError("Mobile number or password is incorrect.");
  }
  if (customer.status === "BLOCKED") {
    throw new AccountError("This account is blocked. Please contact the shop.");
  }
  if (customer.lockedUntil && customer.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(
      1,
      Math.ceil((customer.lockedUntil.getTime() - Date.now()) / 60_000),
    );
    throw new AccountError(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
  if (!customer.passwordHash) {
    throw new AccountError(
      "This mobile number has not set up an online account yet. Create one first.",
    );
  }

  const valid = await verifySecret(input.password, customer.passwordHash);
  if (!valid) {
    const next = customer.failedLoginCount + 1;
    if (next >= CUSTOMER_LOCKOUT.maxFailedAttempts) {
      await client.customer.update({
        where: { id: customer.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + CUSTOMER_LOCKOUT.lockMinutes * 60_000),
        },
      });
      throw new AccountError(
        `Too many failed attempts. Try again in ${CUSTOMER_LOCKOUT.lockMinutes} minutes.`,
      );
    }
    await client.customer.update({
      where: { id: customer.id },
      data: { failedLoginCount: next },
    });
    throw new AccountError("Mobile number or password is incorrect.");
  }

  const updated = await client.customer.update({
    where: { id: customer.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    select: { id: true, fullName: true, mobileNormalized: true, email: true },
  });

  return {
    id: updated.id,
    fullName: updated.fullName,
    mobile: updated.mobileNormalized,
    email: updated.email,
  };
}

/** Change the password after checking the current one. */
export async function changeCustomerPassword(
  customerId: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  if (newPassword !== confirmPassword) {
    throw new AccountError("The two new passwords do not match.");
  }
  const problem = passwordProblem(newPassword);
  if (problem) throw new AccountError(problem);

  const client = outer ?? prisma;
  const customer = await client.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { passwordHash: true },
  });
  if (!customer?.passwordHash) {
    throw new AccountError("This account has no password set.");
  }
  if (!(await verifySecret(currentPassword, customer.passwordHash))) {
    throw new AccountError("Current password is incorrect.");
  }
  if (await verifySecret(newPassword, customer.passwordHash)) {
    throw new AccountError("Choose a password you have not used here before.");
  }

  await client.customer.update({
    where: { id: customerId },
    data: {
      passwordHash: await hashSecret(newPassword),
      passwordUpdatedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
}

/** Update the name and optional email. The mobile number is changed by staff. */
export async function updateCustomerProfile(
  customerId: string,
  input: { fullName: string; email?: string },
  outer?: Prisma.TransactionClient,
): Promise<void> {
  const fullName = clean(input.fullName, 120);
  if (fullName.length < 2) throw new AccountError("Enter your full name.");

  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const emailIssue = emailProblem(email ?? "");
  if (emailIssue) throw new AccountError(emailIssue);

  const client = outer ?? prisma;
  const changed = await client.customer.updateMany({
    where: { id: customerId, deletedAt: null },
    data: { fullName, email },
  });
  if (changed.count === 0) throw new AccountError("That account no longer exists.");
}
