import { randomBytes } from "node:crypto";
import {
  Prisma,
  type PaymentMethod,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ACCOUNTS, paymentAccountCode, postJournal } from "@/lib/accounting/journal";
import { money, qty, type Numeric } from "@/lib/inventory/decimal";
import { postStockMovement } from "@/lib/inventory/stock";
import { PurchasingError } from "./service";

/**
 * Supplier settlement: paying a supplier and sending goods back.
 *
 * The payables balance is not stored. It is the supplier's share of account
 * `1300 Accounts Payable`: posting a GRN credits it, a payment and a return debit
 * it, so the statement is a query over posted journal lines and can never drift
 * from the ledger. `supplier_ledgers` is deliberately left unused for the same
 * reason — one source of truth is enough.
 *
 * A return leaves stock at AVCO, and the journal credits inventory with exactly
 * the value the stock ledger removed, so the two always agree. The supplier's
 * credit note is therefore worth the book value of the goods, not a re-typed
 * price.
 */

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

function code(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function positiveMoney(value: Numeric, label = "Amount"): Prisma.Decimal {
  const parsed = money(value);
  if (!parsed.greaterThan(0)) throw new PurchasingError(`${label} must be greater than zero.`);
  return parsed;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Methods that can settle a supplier. COD is money coming in, never going out. */
export const SUPPLIER_PAYMENT_METHODS = [
  "CASH",
  "BKASH",
  "NAGAD",
  "BANK_TRANSFER",
  "CHEQUE",
  "CARD",
] as const satisfies readonly PaymentMethod[];

export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------

export type SupplierPayable = {
  supplierId: string;
  /** Value received on credit (GRN accruals). */
  invoiced: Prisma.Decimal;
  /** Payments and returns. */
  settled: Prisma.Decimal;
  /** Positive means we owe the supplier; negative is a credit with them. */
  outstanding: Prisma.Decimal;
};

type PayableRow = {
  supplierId: string;
  debit: string;
  credit: string;
};

async function payableRows(
  tx: Prisma.TransactionClient | typeof prisma,
  supplierId?: string,
): Promise<PayableRow[]> {
  return tx.$queryRaw<PayableRow[]>(Prisma.sql`
    SELECT
      l."supplierId" AS "supplierId",
      COALESCE(SUM(l."debit"), 0)::text AS "debit",
      COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "journal_entry_lines" l
    JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."status" = 'POSTED'
      AND a."code" = ${ACCOUNTS.payable}
      AND l."supplierId" IS NOT NULL
      ${supplierId ? Prisma.sql`AND l."supplierId" = ${supplierId}` : Prisma.empty}
    GROUP BY l."supplierId"
  `);
}

function payableFrom(row: PayableRow): SupplierPayable {
  const debit = money(row.debit);
  const credit = money(row.credit);
  return {
    supplierId: row.supplierId,
    invoiced: credit,
    settled: debit,
    outstanding: money(credit.sub(debit)),
  };
}

/** Outstanding payables, keyed by supplier id. Suppliers with no activity are absent. */
export async function supplierPayables(
  outer?: Prisma.TransactionClient,
): Promise<Map<string, SupplierPayable>> {
  const rows = await payableRows(outer ?? prisma);
  return new Map(rows.map((row) => [row.supplierId, payableFrom(row)]));
}

export async function supplierPayable(
  supplierId: string,
  outer?: Prisma.TransactionClient,
): Promise<SupplierPayable> {
  const rows = await payableRows(outer ?? prisma, supplierId);
  return rows[0]
    ? payableFrom(rows[0])
    : {
        supplierId,
        invoiced: money(0),
        settled: money(0),
        outstanding: money(0),
      };
}

export type SupplierStatementRow = {
  id: string;
  entryNumber: string;
  entryDate: Date;
  description: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  balance: Prisma.Decimal;
};

/** Every posted entry that touched this supplier's payable, oldest first. */
export async function supplierStatement(
  supplierId: string,
  outer?: Prisma.TransactionClient,
): Promise<SupplierStatementRow[]> {
  const client = outer ?? prisma;
  const rows = await client.$queryRaw<
    Array<{
      id: string;
      entryNumber: string;
      entryDate: Date;
      description: string;
      debit: string;
      credit: string;
    }>
  >(Prisma.sql`
    SELECT
      e."id",
      e."entryNumber",
      e."entryDate",
      e."description",
      COALESCE(SUM(l."debit"), 0)::text AS "debit",
      COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "journal_entries" e
    JOIN "journal_entry_lines" l ON l."journalEntryId" = e."id"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."status" = 'POSTED'
      AND a."code" = ${ACCOUNTS.payable}
      AND l."supplierId" = ${supplierId}
    GROUP BY e."id", e."entryNumber", e."entryDate", e."description"
    ORDER BY e."entryDate" ASC, e."entryNumber" ASC
  `);

  let balance = money(0);
  return rows.map((row) => {
    const debit = money(row.debit);
    const credit = money(row.credit);
    balance = money(balance.add(credit).sub(debit));
    return {
      id: row.id,
      entryNumber: row.entryNumber,
      entryDate: row.entryDate,
      description: row.description,
      debit,
      credit,
      balance,
    };
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type RecordPurchasePaymentInput = {
  supplierId: string;
  amount: Numeric;
  method: SupplierPaymentMethod;
  reference?: string | null;
  paidAt?: Date;
  purchaseOrderId?: string | null;
  note?: string | null;
  actorUserId: string;
};

export async function recordPurchasePayment(
  input: RecordPurchasePaymentInput,
  outer?: Prisma.TransactionClient,
) {
  const amount = positiveMoney(input.amount);
  if (!(SUPPLIER_PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    throw new PurchasingError("Choose how the supplier was paid.");
  }

  return run(outer, async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, name: true, status: true },
    });
    if (!supplier) throw new PurchasingError("That supplier no longer exists.");
    if (supplier.status === "BLACKLISTED") {
      throw new PurchasingError("A blacklisted supplier cannot be paid.");
    }

    if (input.purchaseOrderId) {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        select: { supplierId: true, status: true },
      });
      if (!order) throw new PurchasingError("That purchase order no longer exists.");
      if (order.supplierId !== supplier.id) {
        throw new PurchasingError("That purchase order belongs to another supplier.");
      }
      if (order.status === "CANCELLED") {
        throw new PurchasingError("A cancelled purchase order cannot be paid.");
      }
    }

    // Lock the supplier row so two simultaneous payments cannot both consume
    // the last taka of the same payable.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "suppliers" WHERE "id" = ${supplier.id} FOR UPDATE
    `;

    const payable = await supplierPayable(supplier.id, tx);
    if (payable.outstanding.lessThanOrEqualTo(0)) {
      throw new PurchasingError(
        `${supplier.name} has nothing outstanding to pay. Record the goods receipt first.`,
      );
    }
    if (amount.greaterThan(payable.outstanding)) {
      throw new PurchasingError(
        `Only ৳${payable.outstanding.toFixed(2)} is outstanding for ${supplier.name}.`,
      );
    }

    const paidAt = input.paidAt ?? new Date();
    const payment = await tx.purchasePayment.create({
      data: {
        paymentNumber: code("PAY"),
        supplierId: supplier.id,
        purchaseOrderId: input.purchaseOrderId ?? null,
        amount,
        method: input.method,
        reference: text(input.reference),
        paidAt,
        recordedByUserId: input.actorUserId,
        status: "SUCCESS",
      },
      select: { id: true, paymentNumber: true },
    });

    const journal = await postJournal(tx, {
      entryDate: paidAt,
      description: `${payment.paymentNumber} · ${supplier.name}${text(input.note) ? ` · ${text(input.note)}` : ""}`,
      source: "PURCHASE_PAYMENT",
      referenceType: "purchase_payment",
      referenceId: payment.id,
      actorUserId: input.actorUserId,
      lines: [
        { account: ACCOUNTS.payable, debit: amount, supplierId: supplier.id },
        { account: paymentAccountCode(input.method), credit: amount },
      ],
    });

    if (journal) {
      await tx.purchasePayment.update({
        where: { id: payment.id },
        data: { journalEntryId: journal.id },
      });
    }

    return {
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      journalEntryId: journal?.id ?? null,
      outstandingAfter: money(payable.outstanding.sub(amount)),
    };
  });
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export type PurchaseReturnLine = {
  goodsReceivedItemId: string;
  variantId: string;
  sku: string;
  description: string;
  quantity: string;
  unitCost: string;
};

export type CreatePurchaseReturnInput = {
  grnId: string;
  reason: string;
  refundMethod?: SupplierPaymentMethod | null;
  refundReference?: string | null;
  actorUserId: string;
  lines: Array<{ goodsReceivedItemId: string; quantity: Numeric }>;
};

export async function createPurchaseReturn(
  input: CreatePurchaseReturnInput,
  outer?: Prisma.TransactionClient,
) {
  const reason = text(input.reason);
  if (!reason) throw new PurchasingError("Say why the goods are going back.");
  if (input.lines.length === 0) throw new PurchasingError("Choose at least one line to return.");

  return run(outer, async (tx) => {
    const grn = await tx.goodsReceivedNote.findUnique({
      where: { id: input.grnId },
      select: {
        id: true,
        grnNumber: true,
        status: true,
        supplierId: true,
        warehouseId: true,
        purchaseOrderId: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantityReceived: true,
            returnedQty: true,
            unitCost: true,
            variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
          },
        },
      },
    });
    if (!grn) throw new PurchasingError("That goods receipt no longer exists.");
    if (grn.status !== "POSTED") {
      throw new PurchasingError("Only a posted goods receipt can be returned against.");
    }

    const byId = new Map(grn.items.map((item) => [item.id, item]));
    const lines: PurchaseReturnLine[] = [];
    let estimated = money(0);

    for (const line of input.lines) {
      const item = byId.get(line.goodsReceivedItemId);
      if (!item) throw new PurchasingError("A return line is not part of that goods receipt.");

      const quantity = qty(line.quantity);
      if (!quantity.greaterThan(0)) {
        throw new PurchasingError("Every return line needs a quantity greater than zero.");
      }
      const returnable = item.quantityReceived.sub(item.returnedQty);
      if (quantity.greaterThan(returnable)) {
        throw new PurchasingError(
          `Only ${returnable.toFixed(3)} unit(s) of ${item.variant.sku} can still be returned.`,
        );
      }

      estimated = estimated.add(money(quantity.mul(item.unitCost)));
      lines.push({
        goodsReceivedItemId: item.id,
        variantId: item.variantId,
        sku: item.variant.sku,
        description: `${item.variant.product.name} · ${item.variant.name}`,
        quantity: quantity.toString(),
        unitCost: item.unitCost.toFixed(4),
      });
    }

    const created = await tx.purchaseReturn.create({
      data: {
        returnNumber: code("PRET"),
        purchaseOrderId: grn.purchaseOrderId,
        grnId: grn.id,
        supplierId: grn.supplierId,
        warehouseId: grn.warehouseId,
        reason,
        status: "DRAFT",
        lines,
        totalValue: estimated,
        refundMethod: input.refundMethod ?? null,
        refundReference: text(input.refundReference),
        createdByUserId: input.actorUserId,
      },
      select: { id: true, returnNumber: true, totalValue: true },
    });

    return {
      id: created.id,
      returnNumber: created.returnNumber,
      estimatedValue: created.totalValue,
    };
  });
}

type StoredReturnLine = {
  goodsReceivedItemId: string;
  variantId: string;
  sku: string;
  description: string;
  quantity: string;
  unitCost: string;
};

function storedLines(value: Prisma.JsonValue | null): StoredReturnLine[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as StoredReturnLine[];
}

/**
 * Approve a return: stock leaves, inventory is credited and the supplier's
 * payable is debited, all in one transaction. The posted value comes from the
 * stock ledger, not from the draft's estimate.
 */
export async function approvePurchaseReturn(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.purchaseReturn.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "APPROVED" },
    });
    if (claimed.count === 0) {
      throw new PurchasingError("Only a draft return can be approved.");
    }

    const record = await tx.purchaseReturn.findUnique({
      where: { id },
      select: {
        id: true,
        returnNumber: true,
        supplierId: true,
        warehouseId: true,
        grnId: true,
        lines: true,
        supplier: { select: { name: true } },
      },
    });
    if (!record) throw new PurchasingError("That return no longer exists.");

    const lines = storedLines(record.lines);
    if (lines.length === 0) throw new PurchasingError("That return has no lines.");

    // Serialise against another return of the same receipt.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "goods_received_items"
      WHERE "grnId" = ${record.grnId}
      FOR UPDATE
    `;

    let totalValue = money(0);

    for (const line of lines) {
      const item = await tx.goodsReceivedItem.findUnique({
        where: { id: line.goodsReceivedItemId },
        select: { id: true, quantityReceived: true, returnedQty: true, grnId: true },
      });
      if (!item || item.grnId !== record.grnId) {
        throw new PurchasingError("A return line no longer matches its goods receipt.");
      }

      const quantity = qty(line.quantity);
      const returnable = item.quantityReceived.sub(item.returnedQty);
      if (quantity.greaterThan(returnable)) {
        throw new PurchasingError(
          `Only ${returnable.toFixed(3)} unit(s) of ${line.sku} can still be returned.`,
        );
      }

      const movement = await postStockMovement(tx, {
        variantId: line.variantId,
        warehouseId: record.warehouseId,
        movementType: "PURCHASE_RETURN",
        quantity,
        unitCost: line.unitCost,
        referenceType: "purchase_return",
        referenceId: record.id,
        note: `${record.returnNumber} to ${record.supplier.name}`,
        actorUserId,
      });

      totalValue = totalValue.add(movement.ledgerValue.neg());
      await tx.goodsReceivedItem.update({
        where: { id: item.id },
        data: { returnedQty: item.returnedQty.add(quantity) },
      });
    }

    totalValue = money(totalValue);
    if (!totalValue.greaterThan(0)) {
      throw new PurchasingError("That return is worth nothing; check the quantities.");
    }

    const journal = await postJournal(tx, {
      description: `${record.returnNumber} · ${record.supplier.name}`,
      source: "PURCHASE",
      referenceType: "purchase_return",
      referenceId: record.id,
      actorUserId,
      lines: [
        { account: ACCOUNTS.payable, debit: totalValue, supplierId: record.supplierId },
        { account: ACCOUNTS.inventory, credit: totalValue },
      ],
    });

    await tx.purchaseReturn.update({
      where: { id: record.id },
      data: {
        totalValue,
        journalEntryId: journal?.id ?? null,
      },
    });

    return {
      id: record.id,
      returnNumber: record.returnNumber,
      totalValue,
      journalEntryId: journal?.id ?? null,
    };
  });
}

/**
 * Complete an approved return. If the supplier handed money back, that refund
 * posts now; otherwise the payable simply carries a debit until the next invoice.
 */
export async function completePurchaseReturn(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const record = await tx.purchaseReturn.findUnique({
      where: { id },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        supplierId: true,
        totalValue: true,
        refundMethod: true,
        refundReference: true,
        supplier: { select: { name: true } },
      },
    });
    if (!record) throw new PurchasingError("That return no longer exists.");
    if (record.status !== "APPROVED") {
      throw new PurchasingError("Only an approved return can be completed.");
    }

    const claimed = await tx.purchaseReturn.updateMany({
      where: { id, status: "APPROVED" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new PurchasingError("That return was completed by someone else.");
    }

    let refundEntryId: string | null = null;
    if (record.refundMethod) {
      const refund = await postJournal(tx, {
        description: `${record.returnNumber} refund · ${record.supplier.name}${
          record.refundReference ? ` · ${record.refundReference}` : ""
        }`,
        source: "PURCHASE_PAYMENT",
        referenceType: "purchase_return",
        referenceId: record.id,
        actorUserId,
        lines: [
          { account: paymentAccountCode(record.refundMethod), debit: record.totalValue },
          { account: ACCOUNTS.payable, credit: record.totalValue, supplierId: record.supplierId },
        ],
      });
      refundEntryId = refund?.id ?? null;
    }

    return {
      id: record.id,
      returnNumber: record.returnNumber,
      refundEntryId,
      totalValue: record.totalValue,
    };
  });
}

export async function cancelPurchaseReturn(
  id: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.purchaseReturn.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) {
      throw new PurchasingError(
        "Only a draft return can be cancelled. An approved return is corrected with a new purchase.",
      );
    }
    return { id };
  });
}

/** Posted receipts that still have at least one unit to give back. */
export async function returnableGrns(
  options?: { supplierId?: string },
  outer?: Prisma.TransactionClient,
) {
  const client = outer ?? prisma;
  const rows = await client.goodsReceivedNote.findMany({
    where: {
      status: "POSTED",
      ...(options?.supplierId ? { supplierId: options.supplierId } : {}),
    },
    orderBy: { postedAt: "desc" },
    take: 40,
    select: {
      id: true,
      grnNumber: true,
      postedAt: true,
      totalValue: true,
      supplier: { select: { id: true, name: true } },
      items: {
        select: { quantityReceived: true, returnedQty: true, unitCost: true },
      },
    },
  });

  return rows.filter((row) =>
    row.items.some((item) => item.quantityReceived.greaterThan(item.returnedQty)),
  );
}
