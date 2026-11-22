/**
 * End-to-end supplier settlement verification.
 *
 *   npm run build
 *   STORAGE_PROVIDER=local npm start     # in another terminal
 *   npm run verify:purchasing-settlement
 *
 * Point it elsewhere with BASE_URL=http://localhost:3100.
 *
 * Proves over real HTTP: the payables figure, recording a payment against it,
 * the overpayment and blacklist guards, a purchase return that leaves stock at
 * average cost and debits the payable, a cash refund on completion, and the
 * supplier statement with its running balance. Permissions are checked for an
 * accountant and a cashier too.
 *
 * Each run uses a fresh supplier, so the payable arithmetic is isolated. The
 * stock ledger and journals are append-only, so the variant is archived and the
 * supplier deactivated at the end; their history stays in the books.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { SESSION_VERSION, signSessionToken } from "../src/lib/auth/token";
import {
  createGrn,
  createPurchaseOrder,
  postGrn,
  sendPurchaseOrder,
} from "../src/lib/purchasing/service";
import {
  approvePurchaseReturn,
  completePurchaseReturn,
  createPurchaseReturn,
  recordPurchasePayment,
  supplierPayable,
} from "../src/lib/purchasing/settlement";

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
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    text: bytes.toString("utf8"),
  };
}

function visible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const run = randomBytes(4).toString("hex");
const digits = String(Date.now()).slice(-8);

const [ownerRole, accountantRole, cashierRole, category] = await Promise.all([
  prisma.role.findUniqueOrThrow({ where: { code: "OWNER" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, select: { id: true } }),
  prisma.role.findUniqueOrThrow({ where: { code: "CASHIER" }, select: { id: true } }),
  prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
]);

const [owner, accountant, cashier] = await Promise.all([
  prisma.user.create({
    data: {
      email: `verify-settlement-owner-${run}@example.test`,
      fullName: "Verify settlement owner",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: ownerRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-settlement-accountant-${run}@example.test`,
      fullName: "Verify settlement accountant",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: accountantRole.id }] },
    },
    select: { id: true, email: true },
  }),
  prisma.user.create({
    data: {
      email: `verify-settlement-cashier-${run}@example.test`,
      fullName: "Verify settlement cashier",
      status: "ACTIVE",
      mustChangePassword: false,
      userRoles: { create: [{ roleId: cashierRole.id }] },
    },
    select: { id: true, email: true },
  }),
]);

const supplier = await prisma.supplier.create({
  data: {
    code: `VSET-${run.toUpperCase()}`,
    name: `Verify settlement supplier ${digits}`,
    mobileNormalized: `+8801${digits.slice(0, 9)}`,
    paymentTermsDays: 15,
    leadTimeDays: 3,
    status: "ACTIVE",
  },
  select: { id: true, code: true, name: true },
});

const product = await prisma.product.upsert({
  where: { slug: "verify-settlement" },
  update: { status: "ACTIVE", isPublished: false },
  create: {
    categoryId: category.id,
    sku: "VERIFY-SET",
    name: "Verify settlement product",
    slug: "verify-settlement",
    status: "ACTIVE",
    isPublished: false,
    basePrice: "100.00",
  },
  select: { id: true },
});

const variant = await prisma.productVariant.create({
  data: {
    productId: product.id,
    sku: `VSET-${run.toUpperCase()}`,
    name: `Settlement run ${run}`,
    price: "100.00",
    costPrice: "0.0000",
    fulfillmentType: "STOCKED",
    isDefault: false,
    status: "ACTIVE",
  },
  select: { id: true, sku: true },
});

const warehouse = await prisma.warehouse.create({
  data: {
    code: `VSET-${run.toUpperCase()}`,
    name: `Verify settlement warehouse ${run}`,
    type: "SECONDARY",
    isActive: true,
  },
  select: { id: true },
});

const order = await createPurchaseOrder({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  notes: "Verification settlement purchase order",
  lines: [{ variantId: variant.id, quantity: "10", unitCost: "100" }],
});
await sendPurchaseOrder(order.id, owner.id);

const purchaseItem = await prisma.purchaseItem.findFirstOrThrow({
  where: { purchaseOrderId: order.id },
  select: { id: true },
});

const grn = await createGrn({
  purchaseOrderId: order.id,
  notes: "Verification settlement receipt: ten units",
  lines: [{ purchaseItemId: purchaseItem.id, quantity: "10", unitCost: "100", condition: "GOOD" }],
});
await postGrn(grn.id, owner.id);

const goodsReceivedItem = await prisma.goodsReceivedItem.findFirstOrThrow({
  where: { grnId: grn.id },
  select: { id: true },
});

const ownerCookie = sessionCookie(owner);
const accountantCookie = sessionCookie(accountant);
const cashierCookie = sessionCookie(cashier);

try {
  await check("the receipt created a payable of ৳1,000.00", async () => {
    const payable = await supplierPayable(supplier.id);
    assert.equal(payable.invoiced.toString(), "1000");
    assert.equal(payable.settled.toString(), "0");
    assert.equal(payable.outstanding.toString(), "1000");
  });

  await check("anonymous visitors are sent to login from settlement pages", async () => {
    for (const path of [
      "/purchases/payments",
      "/purchases/payments/new",
      "/purchases/returns",
      `/suppliers/${supplier.id}/statement`,
    ]) {
      const response = await get(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/login/);
    }
  });

  await check("the owner sees the payments, returns and statement screens", async () => {
    for (const path of [
      "/purchases/payments",
      "/purchases/payments/new",
      "/purchases/returns",
      `/purchases/returns/new?grnId=${grn.id}`,
      `/suppliers/${supplier.id}`,
      `/suppliers/${supplier.id}/statement`,
    ]) {
      const response = await get(path, ownerCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }

    const supplierPage = visible((await get(`/suppliers/${supplier.id}`, ownerCookie)).text);
    assert.match(supplierPage, /Accounts payable/);
    assert.match(supplierPage, /1,000\.00/);
    assert.match(supplierPage, /Statement/);

    const newPayment = visible((await get("/purchases/payments/new", ownerCookie)).text);
    assert.match(newPayment, new RegExp(supplier.name));
    assert.match(newPayment, /1,000\.00/);
  });

  const payment = await recordPurchasePayment({
    supplierId: supplier.id,
    amount: "400",
    method: "CASH",
    reference: `CASH-${run}`,
    actorUserId: owner.id,
  });

  await check("recording a payment reduces the payable and shows on the list", async () => {
    assert.equal(payment.outstandingAfter.toString(), "600");

    const payable = await supplierPayable(supplier.id);
    assert.equal(payable.outstanding.toString(), "600");

    const list = visible((await get("/purchases/payments", ownerCookie)).text);
    assert.match(list, new RegExp(payment.paymentNumber));
    assert.match(list, new RegExp(supplier.name));
    assert.match(list, /400\.00/);
    assert.match(list, /CASH-/);
  });

  await check("an overpayment and a blacklisted supplier are both refused", async () => {
    await assert.rejects(
      () =>
        recordPurchasePayment({
          supplierId: supplier.id,
          amount: "601",
          method: "CASH",
          actorUserId: owner.id,
        }),
      /only ৳600\.00 is outstanding/i,
    );

    await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "BLACKLISTED" } });
    try {
      await assert.rejects(
        () =>
          recordPurchasePayment({
            supplierId: supplier.id,
            amount: "10",
            method: "CASH",
            actorUserId: owner.id,
          }),
        /blacklisted/i,
      );
    } finally {
      await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "ACTIVE" } });
    }

    assert.equal((await supplierPayable(supplier.id)).outstanding.toString(), "600");
  });

  const firstReturn = await createPurchaseReturn({
    grnId: grn.id,
    reason: "Verification return: wrong colour",
    actorUserId: owner.id,
    lines: [{ goodsReceivedItemId: goodsReceivedItem.id, quantity: "4" }],
  });

  await check("a draft return is listed but moves no stock or money", async () => {
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    });
    assert.equal(balance.physicalQty.toString(), "10");
    assert.equal((await supplierPayable(supplier.id)).outstanding.toString(), "600");

    const list = visible((await get("/purchases/returns", ownerCookie)).text);
    assert.match(list, new RegExp(firstReturn.returnNumber));
    assert.match(list, /Draft/);

    const detail = visible(
      (await get(`/purchases/returns/${firstReturn.id}`, ownerCookie)).text,
    );
    assert.match(detail, new RegExp(firstReturn.returnNumber));
    assert.match(detail, /Estimated credit/);
    assert.match(detail, /400\.00/);
    assert.match(detail, /Approve/);
  });

  const approved = await approvePurchaseReturn(firstReturn.id, owner.id);

  await check("approving a return removes stock at average cost and debits the payable", async () => {
    assert.equal(approved.totalValue.toString(), "400");

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    });
    assert.equal(balance.physicalQty.toString(), "6");
    assert.equal(balance.avcoUnitCost.toString(), "100");

    const movement = await prisma.stockLedger.findFirstOrThrow({
      where: { referenceType: "purchase_return", referenceId: firstReturn.id },
      select: { movementType: true, quantity: true, totalValue: true },
    });
    assert.equal(movement.movementType, "PURCHASE_RETURN");
    assert.equal(movement.quantity.toString(), "-4");
    assert.equal(movement.totalValue.toString(), "-400");

    assert.equal((await supplierPayable(supplier.id)).outstanding.toString(), "200");

    const detail = visible((await get(`/purchases/returns/${firstReturn.id}`, ownerCookie)).text);
    assert.match(detail, /Approved/);
    assert.match(detail, /DR payable \/ CR inventory/);
    assert.match(detail, /400\.00/);
  });

  const secondPayment = await recordPurchasePayment({
    supplierId: supplier.id,
    amount: "200",
    method: "BKASH",
    reference: `BKASH-${run}`,
    actorUserId: owner.id,
  });
  assert.equal(secondPayment.outstandingAfter.toString(), "0");

  const secondReturn = await createPurchaseReturn({
    grnId: grn.id,
    reason: "Verification return: damaged",
    refundMethod: "CASH",
    refundReference: `REF-${run}`,
    actorUserId: owner.id,
    lines: [{ goodsReceivedItemId: goodsReceivedItem.id, quantity: "2" }],
  });
  await approvePurchaseReturn(secondReturn.id, owner.id);
  const completed = await completePurchaseReturn(secondReturn.id, owner.id);

  await check("completing a return with a cash refund clears the supplier credit", async () => {
    assert.ok(completed.refundEntryId);
    assert.equal((await supplierPayable(supplier.id)).outstanding.toString(), "0");

    const refund = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: completed.refundEntryId! },
      select: { lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    });
    const cash = refund.lines.find((line) => line.account.code === "1000");
    const payable = refund.lines.find((line) => line.account.code === "1300");
    assert.equal(cash?.debit.toString(), "200");
    assert.equal(payable?.credit.toString(), "200");

    const detail = visible((await get(`/purchases/returns/${secondReturn.id}`, ownerCookie)).text);
    assert.match(detail, /Completed/);
    assert.match(detail, /200\.00/);
  });

  await check("the statement shows every movement and closes at zero", async () => {
    const page = await get(`/suppliers/${supplier.id}/statement`, ownerCookie);
    assert.equal(page.status, 200);
    const text = visible(page.text);

    for (const document of [payment.paymentNumber, secondPayment.paymentNumber]) {
      assert.match(text, new RegExp(document));
    }
    for (const document of [firstReturn.returnNumber, secondReturn.returnNumber]) {
      assert.match(text, new RegExp(document));
    }

    assert.match(text, /Closing balance/);
    assert.match(text, /Received on credit/);
    assert.match(text, /Paid or returned/);
    // 1,000 received, 600 paid and 400 returned in total.
    assert.match(text, /1,000\.00/);
    assert.match(text, /600\.00/);
    assert.match(text, /400\.00/);

    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT e."id") AS count
      FROM "journal_entries" e
      JOIN "journal_entry_lines" l ON l."journalEntryId" = e."id"
      JOIN "accounts" a ON a."id" = l."accountId"
      WHERE e."status" = 'POSTED' AND a."code" = '1300' AND l."supplierId" = ${supplier.id}
    `;
    assert.equal(Number(rows[0]?.count ?? 0), 6);
  });

  await check("an accountant reads settlement pages but cannot open the forms", async () => {
    for (const path of [
      "/purchases/payments",
      "/purchases/returns",
      `/purchases/returns/${firstReturn.id}`,
      `/suppliers/${supplier.id}/statement`,
    ]) {
      const response = await get(path, accountantCookie);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }

    for (const path of ["/purchases/payments/new", `/purchases/returns/new?grnId=${grn.id}`]) {
      const response = await get(path, accountantCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }

    assert.doesNotMatch(
      (await get("/purchases/payments", accountantCookie)).text,
      /Record payment/,
    );
  });

  await check("a cashier is redirected from every settlement page", async () => {
    for (const path of [
      "/purchases/payments",
      "/purchases/returns",
      `/suppliers/${supplier.id}/statement`,
    ]) {
      const response = await get(path, cashierCookie);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} ${response.status}`);
      assert.match(response.location, /\/forbidden/, `${path} did not redirect to /forbidden`);
    }
  });
} finally {
  await prisma.productVariant
    .update({ where: { id: variant.id }, data: { status: "ARCHIVED" } })
    .catch(() => undefined);
  await prisma.product
    .update({ where: { id: product.id }, data: { isPublished: false } })
    .catch(() => undefined);
  await prisma.warehouse
    .update({ where: { id: warehouse.id }, data: { isActive: false } })
    .catch(() => undefined);
  await prisma.supplier
    .update({ where: { id: supplier.id }, data: { status: "INACTIVE" } })
    .catch(() => undefined);
  await prisma.user
    .updateMany({
      where: { id: { in: [owner.id, accountant.id, cashier.id] } },
      data: { status: "SUSPENDED", deletedAt: new Date() },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(
  "\nThe stock ledger and journals are append-only, so this run's variant was " +
    "archived and its supplier deactivated; the settlement history is retained.",
);
console.log(`\n${checks - failures}/${checks} settlement checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
