import { randomBytes } from "node:crypto";
import { Prisma, type StockMovementType } from "@/generated/prisma/client";
import { dec, D, money, qty, unitCost, type Numeric } from "./decimal";

/**
 * Inventory engine.
 *
 * One balance row per variant/warehouse holds the projection
 * `available = physical - reserved - damaged - quarantined - inProduction`.
 * Every mutation locks that row `FOR UPDATE`, writes the balance, appends a
 * `stock_ledger` row and (for inbound movements) records the AVCO change.
 *
 * The ledger is append-only at the database level. A correction is a new
 * movement, never an edit or a delete.
 */
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

const INBOUND = new Set<StockMovementType>([
  "OPENING_BALANCE",
  "PURCHASE_RECEIPT",
  "SALE_RETURN",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "PRODUCTION_RETURN",
]);

const OUTBOUND = new Set<StockMovementType>([
  "SALE",
  "PURCHASE_RETURN",
  "TRANSFER_OUT",
  "ADJUSTMENT_OUT",
  "PRODUCTION_ISSUE",
]);

type RawBalance = {
  id: string;
  physicalQty: string;
  reservedQty: string;
  availableQty: string;
  damagedQty: string;
  quarantinedQty: string;
  inProductionQty: string;
  avcoUnitCost: string;
};

export type LockedBalance = {
  id: string;
  physicalQty: Prisma.Decimal;
  reservedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  damagedQty: Prisma.Decimal;
  quarantinedQty: Prisma.Decimal;
  inProductionQty: Prisma.Decimal;
  avcoUnitCost: Prisma.Decimal;
};

export type MovementInput = {
  variantId: string;
  warehouseId: string;
  storeId?: string | null;
  movementType: StockMovementType;
  /** Always positive. Direction comes from `movementType`. */
  quantity: Numeric;
  /** Required for inbound movements that should blend AVCO. */
  unitCost?: Numeric;
  referenceType: string;
  referenceId: string;
  note?: string | null;
  actorUserId: string;
  /** Offline sync is the only caller allowed to go negative. */
  allowNegative?: boolean;
};

export type MovementResult = {
  ledgerId: string;
  physicalQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  avcoUnitCost: Prisma.Decimal;
  /** Signed value of this movement: positive in, negative out. */
  ledgerValue: Prisma.Decimal;
  ledgerUnitCost: Prisma.Decimal;
};

async function lockBalance(
  tx: Prisma.TransactionClient,
  variantId: string,
  warehouseId: string,
): Promise<LockedBalance> {
  // Create the row if it does not exist yet. ON CONFLICT DO NOTHING keeps two
  // concurrent first movements from racing; the SELECT below then locks the one
  // surviving row.
  await tx.inventoryBalance.createMany({
    data: [{ variantId, warehouseId }],
    skipDuplicates: true,
  });

  const rows = await tx.$queryRaw<RawBalance[]>`
    SELECT
      "id",
      "physicalQty"::text AS "physicalQty",
      "reservedQty"::text AS "reservedQty",
      "availableQty"::text AS "availableQty",
      "damagedQty"::text AS "damagedQty",
      "quarantinedQty"::text AS "quarantinedQty",
      "inProductionQty"::text AS "inProductionQty",
      "avcoUnitCost"::text AS "avcoUnitCost"
    FROM "inventory_balances"
    WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) throw new InventoryError("Could not lock the stock row.");

  return {
    id: row.id,
    physicalQty: dec(row.physicalQty),
    reservedQty: dec(row.reservedQty),
    availableQty: dec(row.availableQty),
    damagedQty: dec(row.damagedQty),
    quarantinedQty: dec(row.quarantinedQty),
    inProductionQty: dec(row.inProductionQty),
    avcoUnitCost: dec(row.avcoUnitCost),
  };
}

async function writeBalance(
  tx: Prisma.TransactionClient,
  balanceId: string,
  next: {
    physicalQty: Prisma.Decimal;
    availableQty: Prisma.Decimal;
    damagedQty: Prisma.Decimal;
    quarantinedQty: Prisma.Decimal;
    inProductionQty: Prisma.Decimal;
    avcoUnitCost: Prisma.Decimal;
  },
): Promise<void> {
  await tx.inventoryBalance.update({
    where: { id: balanceId },
    data: {
      physicalQty: next.physicalQty,
      availableQty: next.availableQty,
      damagedQty: next.damagedQty,
      quarantinedQty: next.quarantinedQty,
      inProductionQty: next.inProductionQty,
      avcoUnitCost: next.avcoUnitCost,
      lastMovementAt: new Date(),
    },
  });
}

/**
 * Apply one stock movement inside an existing transaction.
 *
 * Callers own the surrounding transaction so an adjustment, its ledger rows and
 * any journal entry commit together or not at all.
 */
export async function postStockMovement(
  tx: Prisma.TransactionClient,
  input: MovementInput,
): Promise<MovementResult> {
  const quantity = qty(input.quantity);
  if (!quantity.greaterThan(0)) {
    throw new InventoryError("Quantity must be greater than zero.");
  }

  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, fulfillmentType: true, status: true },
  });
  if (!variant) throw new InventoryError("That variant no longer exists.");
  if (variant.fulfillmentType !== "STOCKED") {
    throw new InventoryError("Only stocked variants use the stock ledger.");
  }

  const balance = await lockBalance(tx, input.variantId, input.warehouseId);

  let physicalQty = balance.physicalQty;
  let availableQty = balance.availableQty;
  let damagedQty = balance.damagedQty;
  let quarantinedQty = balance.quarantinedQty;
  const inProductionQty = balance.inProductionQty;
  let avcoUnitCost = balance.avcoUnitCost;

  let ledgerQty: Prisma.Decimal;
  let ledgerUnitCost: Prisma.Decimal;
  let ledgerValue: Prisma.Decimal;
  let balanceAfterQty: Prisma.Decimal;
  let costBefore: Prisma.Decimal | null = null;
  let costAfter: Prisma.Decimal | null = null;

  if (INBOUND.has(input.movementType)) {
    const landed = unitCost(input.unitCost ?? balance.avcoUnitCost);
    if (landed.lessThan(0)) throw new InventoryError("Unit cost cannot be negative.");

    costBefore = avcoUnitCost;
    const oldValue = balance.physicalQty.mul(avcoUnitCost);
    const newValue = oldValue.add(quantity.mul(landed));
    const newQty = balance.physicalQty.add(quantity);
    avcoUnitCost = newQty.greaterThan(0)
      ? newValue.div(newQty).toDecimalPlaces(4, D.ROUND_HALF_UP)
      : avcoUnitCost;
    costAfter = avcoUnitCost;

    physicalQty = physicalQty.add(quantity);
    availableQty = availableQty.add(quantity);
    ledgerQty = quantity;
    ledgerUnitCost = landed;
    ledgerValue = money(quantity.mul(landed));
    balanceAfterQty = physicalQty;
  } else if (input.movementType === "DAMAGE") {
    if (!input.allowNegative && availableQty.lessThan(quantity)) {
      throw new InventoryError("Not enough sellable stock to mark as damaged.");
    }
    damagedQty = damagedQty.add(quantity);
    availableQty = availableQty.sub(quantity);
    ledgerQty = quantity.neg();
    ledgerUnitCost = avcoUnitCost;
    ledgerValue = money(quantity.mul(avcoUnitCost).neg());
    balanceAfterQty = physicalQty;
  } else if (input.movementType === "QUARANTINE") {
    if (!input.allowNegative && availableQty.lessThan(quantity)) {
      throw new InventoryError("Not enough sellable stock to quarantine.");
    }
    quarantinedQty = quarantinedQty.add(quantity);
    availableQty = availableQty.sub(quantity);
    ledgerQty = quantity.neg();
    ledgerUnitCost = avcoUnitCost;
    ledgerValue = money(quantity.mul(avcoUnitCost).neg());
    balanceAfterQty = physicalQty;
  } else if (input.movementType === "WRITE_OFF") {
    if (physicalQty.lessThan(quantity)) {
      throw new InventoryError("Cannot write off more stock than is on hand.");
    }
    // Consume damaged units first, then sellable units. Reserved stock is never
    // written off: it belongs to a customer order.
    const fromDamaged = damagedQty.lessThan(quantity) ? damagedQty : quantity;
    const fromAvailable = quantity.sub(fromDamaged);
    if (!input.allowNegative && fromAvailable.greaterThan(availableQty)) {
      throw new InventoryError("Not enough damaged or sellable stock to write off.");
    }
    damagedQty = damagedQty.sub(fromDamaged);
    availableQty = availableQty.sub(fromAvailable);
    physicalQty = physicalQty.sub(quantity);
    ledgerQty = quantity.neg();
    ledgerUnitCost = avcoUnitCost;
    ledgerValue = money(quantity.mul(avcoUnitCost).neg());
    balanceAfterQty = physicalQty;
  } else if (OUTBOUND.has(input.movementType)) {
    if (!input.allowNegative && availableQty.lessThan(quantity)) {
      throw new InventoryError("Not enough available stock for this movement.");
    }
    physicalQty = physicalQty.sub(quantity);
    availableQty = availableQty.sub(quantity);
    ledgerQty = quantity.neg();
    ledgerUnitCost = avcoUnitCost;
    ledgerValue = money(quantity.mul(avcoUnitCost).neg());
    balanceAfterQty = physicalQty;
  } else {
    throw new InventoryError(`Unsupported stock movement: ${input.movementType}.`);
  }

  await writeBalance(tx, balance.id, {
    physicalQty,
    availableQty,
    damagedQty,
    quarantinedQty,
    inProductionQty,
    avcoUnitCost,
  });

  const ledger = await tx.stockLedger.create({
    data: {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      storeId: input.storeId ?? null,
      movementType: input.movementType,
      quantity: ledgerQty,
      unitCost: ledgerUnitCost,
      totalValue: ledgerValue,
      balanceAfterQty,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      note: input.note?.trim() || null,
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  if (costBefore !== null && costAfter !== null) {
    await tx.inventoryCostHistory.create({
      data: {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        method: "AVCO",
        unitCostBefore: costBefore,
        unitCostAfter: costAfter,
        qtyBefore: balance.physicalQty,
        qtyIn: quantity,
        totalValueBefore: money(balance.physicalQty.mul(costBefore)),
        totalValueAfter: money(physicalQty.mul(costAfter)),
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.actorUserId,
      },
    });
  }

  return {
    ledgerId: ledger.id,
    physicalQty,
    availableQty,
    avcoUnitCost,
    ledgerValue,
    ledgerUnitCost,
  };
}

/** Format a human-readable document number, e.g. `ADJ-20261116-A1B2C3`. */
export function documentNumber(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const random = randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}
