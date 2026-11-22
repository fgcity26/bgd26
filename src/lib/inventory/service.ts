import { Prisma, type AdjustmentType, type WarehouseType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { money, qty, unitCost, type Numeric } from "./decimal";
import { documentNumber, InventoryError, postStockMovement } from "./stock";

/**
 * Inventory document workflows.
 *
 * Server actions validate and authorise; this module owns the business steps so
 * the same logic can be exercised by tests and verification scripts without an
 * HTTP round trip. Every function that changes stock runs in one transaction:
 * the document status, the balance projection, the ledger row and the AVCO
 * history commit together or not at all.
 */

/**
 * Run inside the caller's transaction when one is supplied (tests, composite
 * workflows), otherwise open a new transaction. This keeps the public action
 * path simple while making every step testable without leaking rows.
 */
function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

export const ADJUSTMENT_TYPES = [
  "INCREASE",
  "DECREASE",
  "DAMAGE",
  "QUARANTINE",
  "WRITE_OFF",
] as const;

export type SupportedAdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

const ADJUSTMENT_MOVEMENT = {
  INCREASE: "ADJUSTMENT_IN",
  DECREASE: "ADJUSTMENT_OUT",
  DAMAGE: "DAMAGE",
  QUARANTINE: "QUARANTINE",
  WRITE_OFF: "WRITE_OFF",
} as const;

export function isSupportedAdjustmentType(value: string): value is SupportedAdjustmentType {
  return (ADJUSTMENT_TYPES as readonly string[]).includes(value);
}

function positiveQty(value: Numeric): ReturnType<typeof qty> {
  const parsed = qty(value);
  if (!parsed.greaterThan(0)) throw new InventoryError("Quantity must be greater than zero.");
  return parsed;
}

function nonNegativeCost(value: Numeric): ReturnType<typeof unitCost> {
  const parsed = unitCost(value);
  if (parsed.lessThan(0)) throw new InventoryError("Unit cost cannot be negative.");
  return parsed;
}

async function requireWarehouse(tx: Prisma.TransactionClient, id: string) {
  const warehouse = await tx.warehouse.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, isActive: true, isDefault: true },
  });
  if (!warehouse) throw new InventoryError("That warehouse no longer exists.");
  if (!warehouse.isActive) throw new InventoryError("That warehouse is inactive.");
  return warehouse;
}

async function requireStockedVariant(tx: Prisma.TransactionClient, id: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id },
    select: { id: true, sku: true, name: true, fulfillmentType: true, costPrice: true },
  });
  if (!variant) throw new InventoryError("That variant no longer exists.");
  if (variant.fulfillmentType !== "STOCKED") {
    throw new InventoryError("Only stocked variants use the stock ledger.");
  }
  return variant;
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export type WarehouseInput = {
  code: string;
  name: string;
  nameBn?: string | null;
  type: WarehouseType;
  division?: string | null;
  district?: string | null;
  address?: string | null;
  isDefault: boolean;
  isActive: boolean;
};

function warehouseData(input: WarehouseInput) {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    nameBn: input.nameBn?.trim() || null,
    type: input.type,
    division: input.division?.trim() || null,
    district: input.district?.trim() || null,
    address: input.address?.trim() || null,
    isDefault: input.isDefault,
    isActive: input.isActive,
  };
}

async function guardDeactivation(
  tx: Prisma.TransactionClient,
  id: string,
  warehouse: { isDefault: boolean },
) {
  if (warehouse.isDefault) {
    throw new InventoryError("Make another warehouse the default before deactivating this one.");
  }
  const stock = await tx.inventoryBalance.count({
    where: {
      warehouseId: id,
      OR: [{ physicalQty: { not: 0 } }, { reservedQty: { not: 0 } }],
    },
  });
  if (stock > 0) {
    throw new InventoryError("This warehouse still holds stock. Transfer it out before deactivating.");
  }
}

export async function createWarehouse(
  input: WarehouseInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    if (input.isDefault) {
      await tx.warehouse.updateMany({ data: { isDefault: false } });
    }
    return tx.warehouse.create({
      data: warehouseData(input),
      select: { id: true, code: true, name: true },
    });
  });
}

export async function updateWarehouse(
  id: string,
  input: WarehouseInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.warehouse.findUnique({
      where: { id },
      select: { id: true, isDefault: true },
    });
    if (!current) throw new InventoryError("That warehouse no longer exists.");

    if (current.isDefault && !input.isDefault) {
      throw new InventoryError("Make another warehouse the default before unsetting this one.");
    }
    if (!input.isActive) await guardDeactivation(tx, id, current);
    if (input.isDefault) {
      await tx.warehouse.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.warehouse.update({
      where: { id },
      data: warehouseData(input),
      select: { id: true, code: true, name: true },
    });
  });
}

export async function setWarehouseActive(
  id: string,
  isActive: boolean,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const current = await tx.warehouse.findUnique({
      where: { id },
      select: { id: true, isDefault: true, isActive: true },
    });
    if (!current) throw new InventoryError("That warehouse no longer exists.");
    if (!isActive) await guardDeactivation(tx, id, current);

    return tx.warehouse.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Opening stock
// ---------------------------------------------------------------------------

export type OpeningStockInput = {
  warehouseId: string;
  variantId: string;
  quantity: Numeric;
  unitCost: Numeric;
  note?: string | null;
  actorUserId: string;
};

/**
 * Opening stock is the first movement a variant/warehouse pair may have. It is
 * posted immediately (there is no earlier balance to review) and sets the AVCO.
 * A second opening entry would double-count history, so it is refused; later
 * corrections are ordinary adjustments.
 */
export async function postOpeningStock(
  input: OpeningStockInput,
  outer?: Prisma.TransactionClient,
) {
  const quantity = positiveQty(input.quantity);
  const cost = nonNegativeCost(input.unitCost);

  return run(outer, async (tx) => {
    const warehouse = await requireWarehouse(tx, input.warehouseId);
    await requireStockedVariant(tx, input.variantId);

    const prior = await tx.stockLedger.count({
      where: { variantId: input.variantId, warehouseId: input.warehouseId },
    });
    if (prior > 0) {
      throw new InventoryError(
        "This variant already has stock history in that warehouse. Use an adjustment instead.",
      );
    }

    const adjustment = await tx.stockAdjustment.create({
      data: {
        adjustmentNumber: documentNumber("OPEN"),
        warehouseId: input.warehouseId,
        variantId: input.variantId,
        adjustmentType: "INCREASE",
        quantity,
        unitCost: cost,
        reason: input.note?.trim() || `Opening stock at ${warehouse.name}`,
        status: "POSTED",
        approvedByUserId: input.actorUserId,
        createdByUserId: input.actorUserId,
        postedAt: new Date(),
      },
      select: { id: true, adjustmentNumber: true },
    });

    await postStockMovement(tx, {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      movementType: "OPENING_BALANCE",
      quantity,
      unitCost: cost,
      referenceType: "stock_adjustment",
      referenceId: adjustment.id,
      note: input.note,
      actorUserId: input.actorUserId,
    });

    // Opening stock is a balance-sheet event: inventory arrives against the
    // owner's equity, never against profit.
    const journal = await postJournal(tx, {
      description: `Opening stock · ${warehouse.name}`,
      source: "OPENING_BALANCE",
      referenceType: "stock_adjustment",
      referenceId: adjustment.id,
      actorUserId: input.actorUserId,
      lines: [
        { account: ACCOUNTS.inventory, debit: money(quantity.mul(cost)) },
        { account: ACCOUNTS.equity, credit: money(quantity.mul(cost)) },
      ],
    });
    if (journal) {
      await tx.stockAdjustment.update({
        where: { id: adjustment.id },
        data: { journalEntryId: journal.id },
      });
    }

    return adjustment;
  });
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export type CreateAdjustmentInput = {
  warehouseId: string;
  variantId: string;
  adjustmentType: SupportedAdjustmentType;
  quantity: Numeric;
  unitCost?: Numeric | null;
  reason: string;
  actorUserId: string;
};

export async function createAdjustment(
  input: CreateAdjustmentInput,
  outer?: Prisma.TransactionClient,
) {
  const quantity = positiveQty(input.quantity);
  if (!isSupportedAdjustmentType(input.adjustmentType)) {
    throw new InventoryError("That adjustment type is not supported yet.");
  }
  const cost =
    input.adjustmentType === "INCREASE" ? nonNegativeCost(input.unitCost ?? 0) : null;
  const reason = input.reason.trim();
  if (reason.length < 3) throw new InventoryError("Give a reason for the adjustment.");
  if (reason.length > 500) throw new InventoryError("Keep the reason under 500 characters.");

  return run(outer, async (tx) => {
    await requireWarehouse(tx, input.warehouseId);
    await requireStockedVariant(tx, input.variantId);

    return tx.stockAdjustment.create({
      data: {
        adjustmentNumber: documentNumber("ADJ"),
        warehouseId: input.warehouseId,
        variantId: input.variantId,
        adjustmentType: input.adjustmentType as AdjustmentType,
        quantity,
        unitCost: cost,
        reason,
        status: "DRAFT",
        createdByUserId: input.actorUserId,
      },
      select: { id: true, adjustmentNumber: true },
    });
  });
}

export async function postAdjustment(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.stockAdjustment.updateMany({
      where: { id, status: "DRAFT" },
      data: {
        status: "POSTED",
        approvedByUserId: actorUserId,
        postedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new InventoryError("Only a draft adjustment can be posted.");
    }

    const adjustment = await tx.stockAdjustment.findUnique({ where: { id } });
    if (!adjustment) throw new InventoryError("That adjustment no longer exists.");
    if (!isSupportedAdjustmentType(adjustment.adjustmentType)) {
      throw new InventoryError("That adjustment type is not supported yet.");
    }

    const movement = await postStockMovement(tx, {
      variantId: adjustment.variantId,
      warehouseId: adjustment.warehouseId,
      movementType: ADJUSTMENT_MOVEMENT[adjustment.adjustmentType],
      quantity: adjustment.quantity,
      unitCost: adjustment.unitCost ?? undefined,
      referenceType: "stock_adjustment",
      referenceId: adjustment.id,
      note: adjustment.reason,
      actorUserId,
    });

    // An increase brings value in; every other adjustment writes value down to
    // inventory shrinkage. Transfers between warehouses stay inside inventory
    // and post no journal at all.
    const value = movement.ledgerValue.abs();
    const increase = adjustment.adjustmentType === "INCREASE";
    const journal = await postJournal(tx, {
      description: `${adjustment.adjustmentNumber} · ${adjustment.reason}`,
      source: "STOCK_ADJUSTMENT",
      referenceType: "stock_adjustment",
      referenceId: adjustment.id,
      actorUserId,
      lines: increase
        ? [
            { account: ACCOUNTS.inventory, debit: value },
            { account: ACCOUNTS.shrinkage, credit: value },
          ]
        : [
            { account: ACCOUNTS.shrinkage, debit: value },
            { account: ACCOUNTS.inventory, credit: value },
          ],
    });
    if (journal) {
      await tx.stockAdjustment.update({
        where: { id: adjustment.id },
        data: { journalEntryId: journal.id },
      });
    }

    return adjustment;
  });
}

export async function voidAdjustment(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.stockAdjustment.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "VOID", approvedByUserId: actorUserId },
    });
    if (claimed.count === 0) {
      throw new InventoryError(
        "Only a draft adjustment can be voided. A posted movement is corrected with a new adjustment.",
      );
    }
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export type TransferLineInput = {
  variantId: string;
  quantity: Numeric;
};

export type CreateTransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: TransferLineInput[];
  notes?: string | null;
  actorUserId: string;
};

export async function createTransfer(
  input: CreateTransferInput,
  outer?: Prisma.TransactionClient,
) {
  const lines = input.lines.filter((line) => line.variantId.trim());
  if (lines.length === 0) throw new InventoryError("Add at least one transfer line.");

  const seen = new Set<string>();
  const normalized = lines.map((line) => {
    if (seen.has(line.variantId)) {
      throw new InventoryError("Each variant may appear only once in a transfer.");
    }
    seen.add(line.variantId);
    return { variantId: line.variantId, quantity: positiveQty(line.quantity) };
  });

  return run(outer, async (tx) => {
    const from = await requireWarehouse(tx, input.fromWarehouseId);
    const to = await requireWarehouse(tx, input.toWarehouseId);
    if (from.id === to.id) {
      throw new InventoryError("Choose two different warehouses.");
    }

    const items: Array<{
      variantId: string;
      quantity: ReturnType<typeof qty>;
      sourceUnitCost: ReturnType<typeof unitCost>;
      totalCost: ReturnType<typeof money>;
    }> = [];

    for (const line of normalized) {
      const variant = await requireStockedVariant(tx, line.variantId);
      const balance = await tx.inventoryBalance.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: line.variantId,
            warehouseId: from.id,
          },
        },
        select: { avcoUnitCost: true },
      });
      const cost = unitCost(balance?.avcoUnitCost ?? variant.costPrice);
      items.push({
        variantId: line.variantId,
        quantity: line.quantity,
        sourceUnitCost: cost,
        totalCost: money(line.quantity.mul(cost)),
      });
    }

    return tx.stockTransfer.create({
      data: {
        transferNumber: documentNumber("TRF"),
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        status: "DRAFT",
        notes: input.notes?.trim() || null,
        requestedByUserId: input.actorUserId,
        items: { create: items },
      },
      select: { id: true, transferNumber: true },
    });
  });
}

export async function sendTransfer(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id, status: "DRAFT" },
      data: {
        status: "IN_TRANSIT",
        approvedByUserId: actorUserId,
        shippedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new InventoryError("Only a draft transfer can be sent.");
    }

    const transfer = await tx.stockTransfer.findUnique({
      where: { id },
      include: {
        items: true,
        toWarehouse: { select: { name: true } },
      },
    });
    if (!transfer) throw new InventoryError("That transfer no longer exists.");

    for (const item of transfer.items) {
      const result = await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId: transfer.fromWarehouseId,
        movementType: "TRANSFER_OUT",
        quantity: item.quantity,
        referenceType: "stock_transfer",
        referenceId: transfer.id,
        note: `Transfer to ${transfer.toWarehouse.name}`,
        actorUserId,
      });
      // The ledger used the live AVCO. Record it on the document so receiving
      // values the stock in at exactly the cost it left at.
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: {
          sourceUnitCost: result.avcoUnitCost,
          totalCost: money(item.quantity.mul(result.avcoUnitCost)),
        },
      });
    }

    return transfer;
  });
}

export async function receiveTransfer(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id, status: "IN_TRANSIT" },
      data: {
        status: "RECEIVED",
        approvedByUserId: actorUserId,
        receivedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new InventoryError("Only an in-transit transfer can be received.");
    }

    const transfer = await tx.stockTransfer.findUnique({
      where: { id },
      include: {
        items: true,
        fromWarehouse: { select: { name: true } },
      },
    });
    if (!transfer) throw new InventoryError("That transfer no longer exists.");

    for (const item of transfer.items) {
      await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId: transfer.toWarehouseId,
        movementType: "TRANSFER_IN",
        quantity: item.quantity,
        unitCost: item.sourceUnitCost,
        referenceType: "stock_transfer",
        referenceId: transfer.id,
        note: `Transfer from ${transfer.fromWarehouse.name}`,
        actorUserId,
      });
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { receivedQty: item.quantity },
      });
    }

    return transfer;
  });
}

export async function cancelTransfer(
  id: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const draft = await tx.stockTransfer.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "CANCELLED", approvedByUserId: actorUserId },
    });
    if (draft.count > 0) return { id, returned: false };

    const transit = await tx.stockTransfer.updateMany({
      where: { id, status: "IN_TRANSIT" },
      data: { status: "CANCELLED", approvedByUserId: actorUserId },
    });
    if (transit.count === 0) {
      throw new InventoryError("Only a draft or in-transit transfer can be cancelled.");
    }

    // In-transit stock has already left the source. Cancelling returns it so a
    // lost truck never silently destroys inventory.
    const transfer = await tx.stockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!transfer) throw new InventoryError("That transfer no longer exists.");

    for (const item of transfer.items) {
      await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId: transfer.fromWarehouseId,
        movementType: "TRANSFER_IN",
        quantity: item.quantity,
        unitCost: item.sourceUnitCost,
        referenceType: "stock_transfer",
        referenceId: transfer.id,
        note: "Transfer cancelled while in transit; stock returned to source",
        actorUserId,
      });
    }

    return { id, returned: true };
  });
}
