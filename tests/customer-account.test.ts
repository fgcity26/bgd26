import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { hashSecret } from "../src/lib/password";
import {
  signCustomerSessionToken,
  signSessionToken,
  verifyCustomerSessionToken,
  verifySessionToken,
} from "../src/lib/auth/token";
import { postStockMovement } from "../src/lib/inventory/stock";
import { createSale } from "../src/lib/orders/service";
import { checkoutMobile } from "../src/lib/storefront/checkout";
import {
  AccountError,
  CUSTOMER_LOCKOUT,
  changeCustomerPassword,
  registerCustomer,
  signInCustomer,
  updateCustomerProfile,
} from "../src/lib/customer-auth/service";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  listCustomerAddresses,
  setDefaultCustomerAddress,
  updateCustomerAddress,
} from "../src/lib/customer-auth/addresses";
import { customerOrderDetail, listCustomerOrders } from "../src/lib/customer-auth/orders";

/**
 * Storefront account tests.
 *
 * Every database scenario runs inside one interactive transaction that is
 * rolled back, so the real constraints and indexes are exercised while the
 * development database keeps only committed history. The account services take
 * an optional transaction for exactly this reason.
 */

class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("test rollback");
  }
}

async function rolledBack<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const value = await work(tx);
        throw new Rollback(value);
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
}

function suffix(): string {
  return randomBytes(5).toString("hex");
}

/** A valid +8801XXXXXXXXX number derived from the run id. */
function testMobile(run: string): string {
  const raw = (BigInt(`0x${run}`) % 1_000_000_000n).toString().padStart(9, "0");
  const digits = String(3 + (Number(raw[0]) % 7)) + raw.slice(1);
  return `+8801${digits}`;
}

const PASSWORD = "account-test-pass1";

async function actorId(tx: Prisma.TransactionClient, run: string): Promise<string> {
  const role = await tx.role.findFirstOrThrow({
    where: { code: "OWNER" },
    select: { id: true },
  });
  const actor = await tx.user.create({
    data: {
      email: `account-${run}@bgd26.test`,
      fullName: "Account test actor",
      passwordHash: await hashSecret(`Account-${run}-password`),
      status: "ACTIVE",
      userRoles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });
  return actor.id;
}

/** Stocked product and a till, so a real online sale can run. */
async function saleFixture(tx: Prisma.TransactionClient, run: string) {
  const warehouse = await tx.warehouse.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  const store = await tx.store.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  const actor = await actorId(tx, run);

  const category = await tx.category.create({
    data: {
      name: `Account test ${run}`,
      nameBn: "অ্যাকাউন্ট পরীক্ষা",
      slug: `account-test-${run}`,
      vatPercentage: "15.00",
    },
    select: { id: true },
  });
  const product = await tx.product.create({
    data: {
      categoryId: category.id,
      name: `Account product ${run}`,
      slug: `account-product-${run}`,
      basePrice: "115.00",
      status: "ACTIVE",
      isPublished: true,
    },
    select: { id: true },
  });
  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: `ACC-${run.toUpperCase()}`,
      name: "Default",
      price: "115.00",
      costPrice: "80.0000",
      fulfillmentType: "STOCKED",
    },
    select: { id: true },
  });

  const device = await tx.posDevice.create({
    data: {
      code: `A${run}`.toUpperCase(),
      name: `Account till ${run}`,
      storeId: store.id,
      warehouseId: warehouse.id,
      deviceFingerprint: `account-fp-${run}`,
      registeredByUserId: actor,
    },
    select: { id: true },
  });

  await postStockMovement(tx, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    storeId: store.id,
    movementType: "OPENING_BALANCE",
    quantity: "50",
    unitCost: "80",
    referenceType: "test",
    referenceId: run,
    actorUserId: actor,
  });

  return { warehouse, store, actorId: actor, variant, device };
}

function saleInput(
  setup: Awaited<ReturnType<typeof saleFixture>>,
  run: string,
  overrides: Partial<Parameters<typeof createSale>[0]> = {},
): Parameters<typeof createSale>[0] {
  return {
    source: "POS_ONLINE",
    deviceId: setup.device.id,
    customerMobile: testMobile(run),
    lines: [{ variantId: setup.variant.id, quantity: "10" }],
    payments: [{ method: "CASH", amount: "1150.00" }],
    clientTransactionUuid: `account-sale-${run}`,
    actorUserId: setup.actorId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tokens, checkout identity and redirect safety
// ---------------------------------------------------------------------------

test("customer tokens are signed for customers only", () => {
  const run = suffix();
  const token = signCustomerSessionToken({ customerId: `cust-${run}`, mobile: testMobile(run) });
  const payload = verifyCustomerSessionToken(token);
  assert.equal(payload?.customerId, `cust-${run}`);
  assert.equal(payload?.scope, "customer");

  // A staff token must never verify as a customer token, even with the same key.
  const staff = signSessionToken({
    v: 1,
    userId: "staff-1",
    email: "staff@bgd26.test",
    provider: "local",
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  assert.equal(verifyCustomerSessionToken(staff), null);
  assert.equal(verifySessionToken(token), null);

  const expired = signCustomerSessionToken({
    customerId: "c1",
    mobile: "+8801711111111",
    nowSeconds: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60,
    ttlSeconds: 30 * 24 * 60 * 60,
  });
  assert.equal(verifyCustomerSessionToken(expired), null);
});

test("checkout uses the account mobile and never the posted one", () => {
  assert.equal(checkoutMobile("+8801711111111", "01899999999"), "+8801711111111");
  assert.equal(checkoutMobile(null, "01711111111"), "+8801711111111");
  assert.equal(checkoutMobile(null, "12345"), null);
});

// ---------------------------------------------------------------------------
// Registration and claim
// ---------------------------------------------------------------------------

test("registering a new mobile creates an account that can sign in", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);

    const created = await registerCustomer(
      {
        fullName: "New Shopper",
        mobile,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        email: "Shopper@Example.COM",
      },
      tx,
    );

    assert.equal(created.mobile, mobile);
    assert.equal(created.email, "shopper@example.com");

    const row = await tx.customer.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        passwordHash: true,
        passwordUpdatedAt: true,
        accountClaimedAt: true,
        lastLoginAt: true,
      },
    });
    assert.match(row.passwordHash ?? "", /^scrypt\$/);
    assert.ok(row.passwordUpdatedAt);
    assert.ok(row.accountClaimedAt);
    assert.ok(row.lastLoginAt);

    const signedIn = await signInCustomer({ mobile, password: PASSWORD }, tx);
    assert.equal(signedIn.id, created.id);

    await assert.rejects(
      signInCustomer({ mobile, password: "wrong-password-1" }, tx),
      (error: unknown) =>
        error instanceof AccountError && /incorrect/.test(error.message),
    );
  });
});

test("a guest record with orders is claimed only with a matching order number", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    const guest = await tx.customer.create({
      data: {
        mobileNormalized: mobile,
        fullName: "Guest Shopper",
      },
      select: { id: true },
    });
    const order = await tx.order.create({
      data: {
        orderNumber: `ORD-CLAIM-${run.toUpperCase()}`,
        channel: "ONLINE",
        customerId: guest.id,
        recipientName: "Guest Shopper",
        recipientMobile: mobile,
      },
      select: { id: true },
    });

    await assert.rejects(
      registerCustomer({ fullName: "Guest Shopper", mobile, password: PASSWORD }, tx),
      (error: unknown) =>
        error instanceof AccountError && /Enter one order number/.test(error.message),
    );

    await assert.rejects(
      registerCustomer(
        {
          fullName: "Guest Shopper",
          mobile,
          password: PASSWORD,
          orderNumber: "ORD-NOT-MINE-1",
        },
        tx,
      ),
      (error: unknown) =>
        error instanceof AccountError && /does not belong/.test(error.message),
    );

    const claimed = await registerCustomer(
      {
        fullName: "Guest Shopper",
        mobile,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        orderNumber: `ORD-CLAIM-${run.toUpperCase()}`,
      },
      tx,
    );

    assert.equal(claimed.id, guest.id, "claiming reuses the existing customer row");
    const row = await tx.customer.findUniqueOrThrow({
      where: { id: guest.id },
      select: { passwordHash: true, accountClaimedAt: true },
    });
    assert.ok(row.passwordHash);
    assert.ok(row.accountClaimedAt);

    // The order stays attached to the claimed account.
    const still = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { customerId: true },
    });
    assert.equal(still.customerId, guest.id);
  });
});

test("a mobile number cannot be registered twice", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    await registerCustomer(
      { fullName: "First Owner", mobile, password: PASSWORD, confirmPassword: PASSWORD },
      tx,
    );

    await assert.rejects(
      registerCustomer(
        { fullName: "Second Owner", mobile, password: PASSWORD, confirmPassword: PASSWORD },
        tx,
      ),
      (error: unknown) =>
        error instanceof AccountError && /already has an account/.test(error.message),
    );
  });
});

test("a weak password or mismatched confirmation is refused", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    await assert.rejects(
      registerCustomer(
        { fullName: "Weak", mobile: testMobile(run), password: "short1" },
        tx,
      ),
      (error: unknown) => error instanceof AccountError && /at least 10/.test(error.message),
    );
    await assert.rejects(
      registerCustomer(
        {
          fullName: "Mismatch",
          mobile: testMobile(`${run}aa`),
          password: PASSWORD,
          confirmPassword: "different-pass1",
        },
        tx,
      ),
      (error: unknown) => error instanceof AccountError && /do not match/.test(error.message),
    );
  });
});

// ---------------------------------------------------------------------------
// Lockout and password
// ---------------------------------------------------------------------------

test("five wrong passwords lock sign-in for fifteen minutes", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    const account = await registerCustomer(
      { fullName: "Locked Shopper", mobile, password: PASSWORD, confirmPassword: PASSWORD },
      tx,
    );

    for (let attempt = 1; attempt < CUSTOMER_LOCKOUT.maxFailedAttempts; attempt += 1) {
      await assert.rejects(
        signInCustomer({ mobile, password: `wrong-pass-${attempt}` }, tx),
        (error: unknown) => error instanceof AccountError && /incorrect/.test(error.message),
      );
    }

    await assert.rejects(
      signInCustomer({ mobile, password: "wrong-pass-final" }, tx),
      (error: unknown) =>
        error instanceof AccountError && /Try again in 15 minutes/.test(error.message),
    );

    const row = await tx.customer.findUniqueOrThrow({
      where: { id: account.id },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    assert.equal(row.failedLoginCount, 0);
    assert.ok(row.lockedUntil);
    const minutes = Math.round((row.lockedUntil.getTime() - Date.now()) / 60_000);
    assert.ok(minutes >= 14 && minutes <= 15, `lock should be about 15 minutes, got ${minutes}`);

    // Even the right password is refused while the lock is live.
    await assert.rejects(
      signInCustomer({ mobile, password: PASSWORD }, tx),
      (error: unknown) => error instanceof AccountError && /Too many failed attempts/.test(error.message),
    );
  });
});

test("changing the password checks the old one and clears the lock", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    const account = await registerCustomer(
      { fullName: "Password Shopper", mobile, password: PASSWORD, confirmPassword: PASSWORD },
      tx,
    );

    await assert.rejects(
      changeCustomerPassword(account.id, "not-the-password1", "new-password-1", "new-password-1", tx),
      (error: unknown) => error instanceof AccountError && /Current password/.test(error.message),
    );

    await changeCustomerPassword(account.id, PASSWORD, "new-password-1", "new-password-1", tx);
    await assert.rejects(
      signInCustomer({ mobile, password: PASSWORD }, tx),
      (error: unknown) => error instanceof AccountError && /incorrect/.test(error.message),
    );
    const signedIn = await signInCustomer({ mobile, password: "new-password-1" }, tx);
    assert.equal(signedIn.id, account.id);

    await updateCustomerProfile(account.id, { fullName: "Renamed Shopper" }, tx);
    const row = await tx.customer.findUniqueOrThrow({
      where: { id: account.id },
      select: { fullName: true },
    });
    assert.equal(row.fullName, "Renamed Shopper");
  });
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

function addressInput(mobile: string, label: string) {
  return {
    label,
    recipientName: "Address Owner",
    mobile,
    division: "Dhaka",
    district: "Dhaka",
    upazila: "Mirpur",
    area: "Block C",
    addressLine: "House 12, Road 5, Mirpur",
    postcode: "1216",
  };
}

test("the first address is default and deletion promotes another", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const mobile = testMobile(run);
    const otherMobile = testMobile(`${run}aa`);
    const customer = await registerCustomer(
      { fullName: "Address Shopper", mobile, password: PASSWORD, confirmPassword: PASSWORD },
      tx,
    );
    const stranger = await registerCustomer(
      {
        fullName: "Stranger Shopper",
        mobile: otherMobile,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      },
      tx,
    );

    const firstId = await createCustomerAddress(customer.id, addressInput(mobile, "Home"), tx);
    const secondId = await createCustomerAddress(
      customer.id,
      addressInput(mobile, "Office"),
      tx,
    );

    let list = await listCustomerAddresses(customer.id, tx);
    assert.equal(list.length, 2);
    assert.equal(list[0]?.id, firstId);
    assert.equal(list[0]?.isDefault, true);
    assert.equal(list[1]?.isDefault, false);

    await setDefaultCustomerAddress(customer.id, secondId, tx);
    list = await listCustomerAddresses(customer.id, tx);
    assert.equal(list.filter((entry) => entry.isDefault).length, 1);
    assert.equal(list.find((entry) => entry.isDefault)?.id, secondId);

    // Another customer cannot edit or delete it.
    await assert.rejects(
      updateCustomerAddress(stranger.id, secondId, addressInput(otherMobile, "Hijack"), tx),
      (error: unknown) => error instanceof AccountError && /no longer exists/.test(error.message),
    );
    await assert.rejects(
      deleteCustomerAddress(stranger.id, secondId, tx),
      (error: unknown) => error instanceof AccountError && /no longer exists/.test(error.message),
    );

    await deleteCustomerAddress(customer.id, secondId, tx);
    list = await listCustomerAddresses(customer.id, tx);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, firstId);
    assert.equal(list[0]?.isDefault, true, "the surviving address becomes the default");
  });
});

// ---------------------------------------------------------------------------
// Loyalty redemption through the real sale engine
// ---------------------------------------------------------------------------

test("an account can spend its points on an online sale, within the cap", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await saleFixture(tx, run);
    const mobile = testMobile(run);
    const account = await tx.customer.create({
      data: {
        mobileNormalized: mobile,
        fullName: "Points Shopper",
        loyaltyPointsBalance: 500,
      },
      select: { id: true },
    });

    const sale = await createSale(
      saleInput(setup, run, {
        customerMobile: mobile,
        loyaltyRedeemPoints: 100,
        payments: [{ method: "CASH", amount: "1050.00" }],
      }),
      tx,
    );

    const order = await tx.order.findUniqueOrThrow({
      where: { id: sale.orderId },
      select: {
        customerId: true,
        loyaltyRedeemedPoints: true,
        loyaltyDiscount: true,
        loyaltyEarnedPoints: true,
        grandTotal: true,
        paymentStatus: true,
      },
    });
    assert.equal(order.customerId, account.id, "the points belong to the account");
    assert.equal(order.loyaltyRedeemedPoints, 100);
    assert.equal(order.loyaltyDiscount.toFixed(2), "100.00");
    assert.equal(order.grandTotal.toFixed(2), "1050.00");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.loyaltyEarnedPoints, 10);

    const after = await tx.customer.findUniqueOrThrow({
      where: { id: account.id },
      select: { loyaltyPointsBalance: true },
    });
    assert.equal(after.loyaltyPointsBalance, 410, "500 spent 100 and earned 10");

    // Spending above the 20 % cap is refused.
    await assert.rejects(
      createSale(
        saleInput(setup, run, {
          customerMobile: mobile,
          loyaltyRedeemPoints: 201,
          clientTransactionUuid: `account-cap-${run}`,
        }),
        tx,
      ),
      /at most 200 points/,
    );

    // Spending above the live balance is refused too.
    const poorMobile = testMobile(`${run}bb`);
    await tx.customer.create({
      data: {
        mobileNormalized: poorMobile,
        fullName: "Few Points Shopper",
        loyaltyPointsBalance: 50,
      },
    });
    await assert.rejects(
      createSale(
        saleInput(setup, run, {
          customerMobile: poorMobile,
          loyaltyRedeemPoints: 60,
          clientTransactionUuid: `account-balance-${run}`,
        }),
        tx,
      ),
      /at most 50 points/,
    );
  });
});

// ---------------------------------------------------------------------------
// Order ownership
// ---------------------------------------------------------------------------

test("one account cannot read another account's orders", async () => {
  const run = suffix();
  await rolledBack(async (tx) => {
    const setup = await saleFixture(tx, run);
    const ownerMobile = testMobile(run);
    const otherMobile = testMobile(`${run}cc`);

    const owner = await tx.customer.create({
      data: { mobileNormalized: ownerMobile, fullName: "Order Owner" },
      select: { id: true },
    });
    const other = await tx.customer.create({
      data: { mobileNormalized: otherMobile, fullName: "Other Shopper" },
      select: { id: true },
    });

    const sale = await createSale(
      saleInput(setup, run, { customerMobile: ownerMobile }),
      tx,
    );

    const ownerOrders = await listCustomerOrders(owner.id, 50, tx);
    assert.equal(ownerOrders.length, 1);
    assert.equal(ownerOrders[0]?.id, sale.orderId);

    const otherOrders = await listCustomerOrders(other.id, 50, tx);
    assert.equal(otherOrders.length, 0);

    const ownDetail = await customerOrderDetail(owner.id, sale.orderId, tx);
    assert.ok(ownDetail);
    assert.equal(ownDetail.orderNumber, sale.orderNumber);

    assert.equal(
      await customerOrderDetail(other.id, sale.orderId, tx),
      null,
      "the other account gets no detail at all",
    );
  });
});
