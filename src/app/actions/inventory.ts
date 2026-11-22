"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  ADJUSTMENT_TYPES,
  cancelTransfer,
  createAdjustment,
  createTransfer,
  createWarehouse,
  postAdjustment,
  postOpeningStock,
  receiveTransfer,
  sendTransfer,
  setWarehouseActive,
  updateWarehouse,
  voidAdjustment,
} from "@/lib/inventory/service";
import { InventoryError } from "@/lib/inventory/stock";

/**
 * Inventory actions are thin: validate, authorise, call one domain service,
 * audit, revalidate. The ledger is append-only, so there is no delete action.
 */
export type InventoryFormState = {
  error?: string;
  success?: string;
};

const optionalText = (max: number) => z.string().trim().max(max).optional();

function quantityField(places: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .regex(
      new RegExp(`^\\d{1,11}(\\.\\d{1,${places}})?$`),
      `Use a number with up to ${places} decimal places.`,
    );
}

const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Enter a short warehouse code.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only."),
  name: z.string().trim().min(2, "Enter the warehouse name.").max(120),
  nameBn: optionalText(120),
  type: z.enum(["MAIN", "SECONDARY", "TRANSIT", "VIRTUAL_DROPSHIP"]),
  division: optionalText(60),
  district: optionalText(60),
  address: optionalText(300),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

const openingSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse."),
  variantId: z.string().trim().min(1, "Choose a variant."),
  quantity: quantityField(3, "a quantity"),
  unitCost: quantityField(4, "a unit cost"),
  note: optionalText(500),
});

const adjustmentSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse."),
  variantId: z.string().trim().min(1, "Choose a variant."),
  adjustmentType: z.enum(ADJUSTMENT_TYPES),
  quantity: quantityField(3, "a quantity"),
  unitCost: optionalText(30),
  reason: z.string().trim().min(3, "Give a reason for the adjustment.").max(500),
});

const transferSchema = z.object({
  fromWarehouseId: z.string().trim().min(1, "Choose the source warehouse."),
  toWarehouseId: z.string().trim().min(1, "Choose the destination warehouse."),
  notes: optionalText(500),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function explain(error: unknown): string {
  if (error instanceof InventoryError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "That code or document number is already in use.";
    if (error.code === "P2025") return "That record no longer exists.";
  }
  return error instanceof Error ? error.message : "Could not save the inventory change.";
}

function readWarehouse(formData: FormData) {
  const parsed = warehouseSchema.safeParse({
    code: text(formData, "code"),
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    type: text(formData, "type") || "SECONDARY",
    division: text(formData, "division"),
    district: text(formData, "district"),
    address: text(formData, "address"),
    isDefault: checkbox(formData, "isDefault"),
    isActive: checkbox(formData, "isActive"),
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export async function createWarehouseAction(
  _previous: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const session = await requirePermission("inventory.write");

  let created: { id: string; code: string; name: string };
  try {
    created = await createWarehouse(readWarehouse(formData));
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "inventory.warehouse.created",
    entityType: "warehouse",
    entityId: created.id,
    metadata: { code: created.code, name: created.name },
    ...(await requestMeta()),
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/warehouses");
  redirect(`/inventory/warehouses/${created.id}`);
}

export async function updateWarehouseAction(
  _previous: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const session = await requirePermission("inventory.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing warehouse id." };

  try {
    const updated = await updateWarehouse(id, readWarehouse(formData));
    await audit({
      actorUserId: session.user.id,
      action: "inventory.warehouse.updated",
      entityType: "warehouse",
      entityId: id,
      metadata: { code: updated.code, name: updated.name },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/warehouses");
  revalidatePath(`/inventory/warehouses/${id}`);
  return { success: "Warehouse saved." };
}

export async function setWarehouseActiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.write");
  const id = text(formData, "id");
  const active = text(formData, "active") === "true";
  if (!id) return;

  try {
    await setWarehouseActive(id, active);
    await audit({
      actorUserId: session.user.id,
      action: active ? "inventory.warehouse.activated" : "inventory.warehouse.deactivated",
      entityType: "warehouse",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    console.error("[inventory] warehouse active toggle failed", explain(error));
    redirect(`/inventory/warehouses/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/warehouses");
  revalidatePath(`/inventory/warehouses/${id}`);
}

// ---------------------------------------------------------------------------
// Opening stock
// ---------------------------------------------------------------------------

export async function postOpeningStockAction(
  _previous: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const session = await requirePermission("inventory.approve");

  const parsed = openingSchema.safeParse({
    warehouseId: text(formData, "warehouseId"),
    variantId: text(formData, "variantId"),
    quantity: text(formData, "quantity"),
    unitCost: text(formData, "unitCost"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  let created: { id: string; adjustmentNumber: string };
  try {
    created = await postOpeningStock({
      warehouseId: data.warehouseId,
      variantId: data.variantId,
      quantity: data.quantity,
      unitCost: data.unitCost,
      note: data.note,
      actorUserId: session.user.id,
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "inventory.opening.posted",
    entityType: "stock_adjustment",
    entityId: created.id,
    metadata: {
      document: created.adjustmentNumber,
      variantId: data.variantId,
      warehouseId: data.warehouseId,
      quantity: data.quantity,
      unitCost: data.unitCost,
    },
    ...(await requestMeta()),
  });

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${data.variantId}`);
  revalidatePath("/inventory/opening");
  revalidatePath("/inventory/adjustments");
  redirect(`/inventory/${data.variantId}`);
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export async function createAdjustmentAction(
  _previous: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const session = await requirePermission("inventory.write");

  const parsed = adjustmentSchema.safeParse({
    warehouseId: text(formData, "warehouseId"),
    variantId: text(formData, "variantId"),
    adjustmentType: text(formData, "adjustmentType"),
    quantity: text(formData, "quantity"),
    unitCost: text(formData, "unitCost"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  if (data.adjustmentType === "INCREASE") {
    if (!data.unitCost) return { error: "Enter the unit cost for an increase." };
    const cost = quantityField(4, "a unit cost").safeParse(data.unitCost);
    if (!cost.success) return { error: firstIssue(cost.error) };
  }

  let created: { id: string; adjustmentNumber: string };
  try {
    created = await createAdjustment({
      warehouseId: data.warehouseId,
      variantId: data.variantId,
      adjustmentType: data.adjustmentType,
      quantity: data.quantity,
      unitCost: data.unitCost ?? null,
      reason: data.reason,
      actorUserId: session.user.id,
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "inventory.adjustment.created",
    entityType: "stock_adjustment",
    entityId: created.id,
    metadata: {
      document: created.adjustmentNumber,
      variantId: data.variantId,
      warehouseId: data.warehouseId,
      type: data.adjustmentType,
      quantity: data.quantity,
    },
    ...(await requestMeta()),
  });

  revalidatePath("/inventory/adjustments");
  revalidatePath(`/inventory/${data.variantId}`);
  redirect(`/inventory/adjustments/${created.id}`);
}

export async function postAdjustmentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    const adjustment = await postAdjustment(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: "inventory.adjustment.posted",
      entityType: "stock_adjustment",
      entityId: id,
      metadata: {
        document: adjustment.adjustmentNumber,
        type: adjustment.adjustmentType,
        quantity: adjustment.quantity.toString(),
      },
      ...(await requestMeta()),
    });
    revalidatePath(`/inventory/${adjustment.variantId}`);
  } catch (error) {
    console.error("[inventory] adjustment post failed", explain(error));
    redirect(`/inventory/adjustments/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath(`/inventory/adjustments/${id}`);
}

export async function voidAdjustmentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await voidAdjustment(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: "inventory.adjustment.voided",
      entityType: "stock_adjustment",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    console.error("[inventory] adjustment void failed", explain(error));
    redirect(`/inventory/adjustments/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/inventory/adjustments");
  revalidatePath(`/inventory/adjustments/${id}`);
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export async function createTransferAction(
  _previous: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const session = await requirePermission("inventory.write");

  const parsed = transferSchema.safeParse({
    fromWarehouseId: text(formData, "fromWarehouseId"),
    toWarehouseId: text(formData, "toWarehouseId"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  const variantIds = formData.getAll("variantId").map((value) => String(value).trim());
  const quantities = formData.getAll("quantity").map((value) => String(value).trim());
  if (variantIds.length !== quantities.length) {
    return { error: "The transfer lines are malformed. Reload the page and try again." };
  }

  const lines: Array<{ variantId: string; quantity: string }> = [];
  for (let index = 0; index < variantIds.length; index += 1) {
    const variantId = variantIds[index];
    if (!variantId) continue;
    const quantity = quantityField(3, `a quantity on line ${index + 1}`).safeParse(
      quantities[index],
    );
    if (!quantity.success) return { error: firstIssue(quantity.error) };
    lines.push({ variantId, quantity: quantity.data });
  }
  if (lines.length === 0) return { error: "Add at least one transfer line." };

  let created: { id: string; transferNumber: string };
  try {
    created = await createTransfer({
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      lines,
      notes: data.notes,
      actorUserId: session.user.id,
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "inventory.transfer.created",
    entityType: "stock_transfer",
    entityId: created.id,
    metadata: {
      document: created.transferNumber,
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      lines: lines.length,
    },
    ...(await requestMeta()),
  });

  revalidatePath("/inventory/transfers");
  redirect(`/inventory/transfers/${created.id}`);
}

async function transitionTransfer(
  formData: FormData,
  permissionAction: "sent" | "received" | "cancelled",
  run: (id: string, actorUserId: string) => Promise<unknown>,
): Promise<void> {
  const session = await requirePermission("inventory.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await run(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: `inventory.transfer.${permissionAction}`,
      entityType: "stock_transfer",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    console.error(`[inventory] transfer ${permissionAction} failed`, explain(error));
    redirect(`/inventory/transfers/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/transfers");
  revalidatePath(`/inventory/transfers/${id}`);
}

export async function sendTransferAction(formData: FormData): Promise<void> {
  await transitionTransfer(formData, "sent", sendTransfer);
}

export async function receiveTransferAction(formData: FormData): Promise<void> {
  await transitionTransfer(formData, "received", receiveTransfer);
}

export async function cancelTransferAction(formData: FormData): Promise<void> {
  await transitionTransfer(formData, "cancelled", cancelTransfer);
}
