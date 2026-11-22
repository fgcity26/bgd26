"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { InventoryError } from "@/lib/inventory/stock";
import {
  PurchasingError,
  cancelGrn,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createGrn,
  createPurchaseOrder,
  createSupplier,
  postGrn,
  sendPurchaseOrder,
  setSupplierStatus,
  updatePurchaseOrder,
  updateSupplier,
} from "@/lib/purchasing/service";
import {
  SUPPLIER_PAYMENT_METHODS,
  approvePurchaseReturn,
  cancelPurchaseReturn,
  completePurchaseReturn,
  createPurchaseReturn,
  recordPurchasePayment,
  type SupplierPaymentMethod,
} from "@/lib/purchasing/settlement";

/**
 * Purchasing actions: validate, authorise, call one service, audit, revalidate.
 *
 * Drafts need `purchase.write`; sending an order, posting a GRN and cancelling
 * committed documents need `purchase.approve`. Nothing here edits stock directly:
 * only `postGrn` appends stock ledger rows, through the inventory engine.
 */
export type PurchasingFormState = {
  error?: string;
  success?: string;
};

const optionalText = (max: number) => z.string().trim().max(max).optional();

const supplierSchema = z.object({
  code: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Za-z0-9-]*$/, "Use letters, numbers and hyphens only.")
    .optional(),
  name: z.string().trim().min(2, "Enter the supplier name.").max(120),
  nameBn: optionalText(120),
  contactPerson: optionalText(120),
  mobile: optionalText(30),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email address.").max(160)])
    .optional(),
  address: optionalText(300),
  division: optionalText(60),
  district: optionalText(60),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  leadTimeDays: z.coerce.number().int().min(0).max(365),
  isDropshipVendor: z.boolean(),
  status: z.enum(["ACTIVE", "INACTIVE", "BLACKLISTED"]),
  notes: optionalText(1000),
});

function decimalPattern(places: number) {
  return new RegExp(`^\\d{1,11}(\\.\\d{1,${places}})?$`);
}


function requiredDecimal(places: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .regex(decimalPattern(places), `Use a number with up to ${places} decimal places.`);
}

function optionalDecimal(places: number) {
  return z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(decimalPattern(places), `Use a number with up to ${places} decimal places.`),
    ])
    .optional();
}

const purchaseSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
  warehouseId: z.string().trim().min(1, "Choose a warehouse."),
  expectedAt: optionalText(10),
  discountTotal: optionalDecimal(2),
  shippingTotal: optionalDecimal(2),
  notes: optionalText(500),
});

const grnSchema = z.object({
  purchaseOrderId: z.string().trim().min(1, "Missing purchase order."),
  warehouseId: optionalText(40),
  notes: optionalText(500),
});

const statuses = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;
const conditions = ["GOOD", "DAMAGED", "QUARANTINED"] as const;

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
  if (error instanceof PurchasingError) return error.message;
  if (error instanceof InventoryError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "That code or document number is already in use.";
    if (error.code === "P2025") return "That record no longer exists.";
  }
  return error instanceof Error ? error.message : "Could not save the purchasing change.";
}

function parseDate(value: string | undefined, label: string): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${label} must be a date.`);
  }
  const date = new Date(`${trimmed}T00:00:00+06:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date.`);
  return date;
}

function readSupplier(formData: FormData) {
  const parsed = supplierSchema.safeParse({
    code: text(formData, "code"),
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    contactPerson: text(formData, "contactPerson"),
    mobile: text(formData, "mobile"),
    email: text(formData, "email"),
    address: text(formData, "address"),
    division: text(formData, "division"),
    district: text(formData, "district"),
    paymentTermsDays: text(formData, "paymentTermsDays") || "0",
    leadTimeDays: text(formData, "leadTimeDays") || "0",
    isDropshipVendor: checkbox(formData, "isDropshipVendor"),
    status: text(formData, "status") || "ACTIVE",
    notes: text(formData, "notes"),
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplierAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");

  let created: { id: string; code: string; name: string };
  try {
    created = await createSupplier(readSupplier(formData));
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "purchase.supplier.created",
    entityType: "supplier",
    entityId: created.id,
    metadata: { code: created.code, name: created.name },
    ...(await requestMeta()),
  });

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
  redirect(`/suppliers/${created.id}`);
}

export async function updateSupplierAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing supplier id." };

  try {
    const updated = await updateSupplier(id, readSupplier(formData));
    await audit({
      actorUserId: session.user.id,
      action: "purchase.supplier.updated",
      entityType: "supplier",
      entityId: id,
      metadata: { code: updated.code, name: updated.name },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${id}`);
  return { success: "Supplier saved." };
}

export async function setSupplierStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  const status = text(formData, "status");
  if (!id || !(statuses as readonly string[]).includes(status)) return;

  try {
    await setSupplierStatus(id, status as (typeof statuses)[number]);
    await audit({
      actorUserId: session.user.id,
      action: "purchase.supplier.status",
      entityType: "supplier",
      entityId: id,
      metadata: { status },
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/suppliers/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${id}`);
  revalidatePath("/purchases");
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

function readPurchaseLines(formData: FormData) {
  const variantIds = formData.getAll("variantId").map((value) => String(value).trim());
  const quantities = formData.getAll("quantity").map((value) => String(value).trim());
  const unitCosts = formData.getAll("unitCost").map((value) => String(value).trim());
  const taxes = formData.getAll("taxAmount").map((value) => String(value).trim());

  const length = Math.max(variantIds.length, quantities.length, unitCosts.length);
  const lines: Array<{
    variantId: string;
    quantity: string;
    unitCost: string;
    taxAmount: string;
  }> = [];

  for (let index = 0; index < length; index += 1) {
    const variantId = variantIds[index] ?? "";
    if (!variantId) continue;

    const quantity = requiredDecimal(3, `a quantity on line ${index + 1}`).safeParse(
      quantities[index] ?? "",
    );
    if (!quantity.success) throw new Error(firstIssue(quantity.error));

    const unitCost = requiredDecimal(4, `a unit cost on line ${index + 1}`).safeParse(
      unitCosts[index] ?? "",
    );
    if (!unitCost.success) throw new Error(firstIssue(unitCost.error));

    const taxAmount = optionalDecimal(2).safeParse(
      taxes[index] ?? "",
    );
    if (!taxAmount.success) throw new Error(firstIssue(taxAmount.error));

    lines.push({
      variantId,
      quantity: quantity.data,
      unitCost: unitCost.data,
      taxAmount: taxAmount.data || "0",
    });
  }

  if (lines.length === 0) throw new Error("Add at least one purchase line.");
  return lines;
}

function readPurchaseOrder(formData: FormData) {
  const parsed = purchaseSchema.safeParse({
    supplierId: text(formData, "supplierId"),
    warehouseId: text(formData, "warehouseId"),
    expectedAt: text(formData, "expectedAt"),
    discountTotal: text(formData, "discountTotal"),
    shippingTotal: text(formData, "shippingTotal"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));

  const data = parsed.data;
  return {
    supplierId: data.supplierId,
    warehouseId: data.warehouseId,
    expectedAt: parseDate(data.expectedAt, "Expected date"),
    discountTotal: data.discountTotal || "0",
    shippingTotal: data.shippingTotal || "0",
    notes: data.notes,
    lines: readPurchaseLines(formData),
  };
}

export async function createPurchaseOrderAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");

  let created: { id: string; poNumber: string };
  try {
    created = await createPurchaseOrder(readPurchaseOrder(formData));
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "purchase.order.created",
    entityType: "purchase_order",
    entityId: created.id,
    metadata: { document: created.poNumber },
    ...(await requestMeta()),
  });

  revalidatePath("/purchases");
  redirect(`/purchases/${created.id}`);
}

export async function updatePurchaseOrderAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing purchase order id." };

  try {
    const updated = await updatePurchaseOrder(id, readPurchaseOrder(formData));
    await audit({
      actorUserId: session.user.id,
      action: "purchase.order.updated",
      entityType: "purchase_order",
      entityId: id,
      metadata: { document: updated.poNumber },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  return { success: "Draft purchase order saved." };
}

async function transitionOrder(
  formData: FormData,
  action: "sent" | "cancelled" | "closed",
  run: (id: string, actorUserId: string) => Promise<unknown>,
): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await run(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: `purchase.order.${action}`,
      entityType: "purchase_order",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/purchases/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
}

export async function sendPurchaseOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, "sent", sendPurchaseOrder);
}

export async function cancelPurchaseOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, "cancelled", cancelPurchaseOrder);
}

export async function closePurchaseOrderAction(formData: FormData): Promise<void> {
  await transitionOrder(formData, "closed", closePurchaseOrder);
}

// ---------------------------------------------------------------------------
// Goods-received notes
// ---------------------------------------------------------------------------

function readGrnLines(formData: FormData) {
  const purchaseItemIds = formData.getAll("purchaseItemId").map((value) => String(value).trim());
  const quantities = formData.getAll("quantity").map((value) => String(value).trim());
  const unitCosts = formData.getAll("unitCost").map((value) => String(value).trim());
  const receivedConditions = formData.getAll("condition").map((value) => String(value).trim());
  const batches = formData.getAll("batchNumber").map((value) => String(value).trim());
  const expiries = formData.getAll("expiryDate").map((value) => String(value).trim());

  const lines: Array<{
    purchaseItemId: string;
    quantity: string;
    unitCost?: string | null;
    condition: (typeof conditions)[number];
    batchNumber?: string | null;
    expiryDate?: Date | null;
  }> = [];

  for (let index = 0; index < purchaseItemIds.length; index += 1) {
    const purchaseItemId = purchaseItemIds[index];
    if (!purchaseItemId) continue;

    const rawQuantity = quantities[index] ?? "";
    if (!rawQuantity || Number(rawQuantity) === 0) continue;

    const quantity = requiredDecimal(3, `a received quantity on line ${index + 1}`).safeParse(
      rawQuantity,
    );
    if (!quantity.success) throw new Error(firstIssue(quantity.error));

    const unitCost = optionalDecimal(4).safeParse(
      unitCosts[index] ?? "",
    );
    if (!unitCost.success) throw new Error(firstIssue(unitCost.error));

    const condition = receivedConditions[index] || "GOOD";
    if (!(conditions as readonly string[]).includes(condition)) {
      throw new Error("Choose a valid condition for every received line.");
    }

    lines.push({
      purchaseItemId,
      quantity: quantity.data,
      unitCost: unitCost.data || null,
      condition: condition as (typeof conditions)[number],
      batchNumber: batches[index] || null,
      expiryDate: parseDate(expiries[index], `Expiry date on line ${index + 1}`),
    });
  }

  if (lines.length === 0) throw new Error("Enter a received quantity on at least one line.");
  return lines;
}

export async function createGrnAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");

  const parsed = grnSchema.safeParse({
    purchaseOrderId: text(formData, "purchaseOrderId"),
    warehouseId: text(formData, "warehouseId"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  let created: { id: string; grnNumber: string };
  try {
    created = await createGrn({
      purchaseOrderId: parsed.data.purchaseOrderId,
      warehouseId: parsed.data.warehouseId,
      notes: parsed.data.notes,
      lines: readGrnLines(formData),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "purchase.grn.created",
    entityType: "goods_received_note",
    entityId: created.id,
    metadata: {
      document: created.grnNumber,
      purchaseOrderId: parsed.data.purchaseOrderId,
    },
    ...(await requestMeta()),
  });

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${parsed.data.purchaseOrderId}`);
  revalidatePath("/purchases/grn");
  redirect(`/purchases/grn/${created.id}`);
}

export async function postGrnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    const posted = await postGrn(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: "purchase.grn.posted",
      entityType: "goods_received_note",
      entityId: id,
      metadata: { document: posted.grnNumber, purchaseOrderStatus: posted.status },
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/purchases/grn/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/inventory");
  revalidatePath("/purchases");
  revalidatePath("/purchases/grn");
  revalidatePath(`/purchases/grn/${id}`);
}

export async function cancelGrnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await cancelGrn(id);
    await audit({
      actorUserId: session.user.id,
      action: "purchase.grn.cancelled",
      entityType: "goods_received_note",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/purchases/grn/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/purchases");
  revalidatePath("/purchases/grn");
  revalidatePath(`/purchases/grn/${id}`);
}

// ---------------------------------------------------------------------------
// Supplier settlement
// ---------------------------------------------------------------------------

const paymentSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
  amount: requiredDecimal(2, "the amount"),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  reference: optionalText(80),
  paidAt: optionalText(10),
  note: optionalText(300),
});

const returnSchema = z.object({
  grnId: z.string().trim().min(1, "Choose a goods receipt."),
  reason: z.string().trim().min(3, "Say why the goods are going back.").max(300),
  refundMethod: z.union([z.literal(""), z.enum(SUPPLIER_PAYMENT_METHODS)]),
  refundReference: optionalText(80),
});

function readReturnLines(formData: FormData) {
  const ids = formData.getAll("goodsReceivedItemId").map((value) => String(value).trim());
  const quantities = formData.getAll("quantity").map((value) => String(value).trim());

  const lines: Array<{ goodsReceivedItemId: string; quantity: string }> = [];
  for (let index = 0; index < ids.length; index += 1) {
    const goodsReceivedItemId = ids[index];
    const raw = quantities[index] ?? "";
    if (!goodsReceivedItemId || !raw || Number(raw) === 0) continue;

    const quantity = requiredDecimal(3, `a quantity on line ${index + 1}`).safeParse(raw);
    if (!quantity.success) throw new Error(firstIssue(quantity.error));
    lines.push({ goodsReceivedItemId, quantity: quantity.data });
  }

  if (lines.length === 0) throw new Error("Enter a return quantity on at least one line.");
  return lines;
}

export async function recordPurchasePaymentAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.approve");

  const parsed = paymentSchema.safeParse({
    supplierId: text(formData, "supplierId"),
    amount: text(formData, "amount"),
    method: text(formData, "method"),
    reference: text(formData, "reference"),
    paidAt: text(formData, "paidAt"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  let recorded: { id: string; paymentNumber: string };
  try {
    recorded = await recordPurchasePayment({
      supplierId: parsed.data.supplierId,
      amount: parsed.data.amount,
      method: parsed.data.method as SupplierPaymentMethod,
      reference: parsed.data.reference,
      paidAt: parseDate(parsed.data.paidAt, "Payment date") ?? undefined,
      note: parsed.data.note,
      actorUserId: session.user.id,
    });
    await audit({
      actorUserId: session.user.id,
      action: "purchase.payment.recorded",
      entityType: "purchase_payment",
      entityId: recorded.id,
      metadata: {
        document: recorded.paymentNumber,
        supplierId: parsed.data.supplierId,
        amount: parsed.data.amount,
        method: parsed.data.method,
      },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/purchases/payments");
  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${parsed.data.supplierId}`);
  revalidatePath("/accounting");
  redirect(`/purchases/payments?ok=${encodeURIComponent(recorded.paymentNumber)}`);
}

export async function createPurchaseReturnAction(
  _previous: PurchasingFormState,
  formData: FormData,
): Promise<PurchasingFormState> {
  const session = await requirePermission("purchase.write");

  const parsed = returnSchema.safeParse({
    grnId: text(formData, "grnId"),
    reason: text(formData, "reason"),
    refundMethod: text(formData, "refundMethod"),
    refundReference: text(formData, "refundReference"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  let created: { id: string; returnNumber: string };
  try {
    created = await createPurchaseReturn({
      grnId: parsed.data.grnId,
      reason: parsed.data.reason,
      refundMethod: parsed.data.refundMethod
        ? (parsed.data.refundMethod as SupplierPaymentMethod)
        : null,
      refundReference: parsed.data.refundReference,
      lines: readReturnLines(formData),
      actorUserId: session.user.id,
    });
    await audit({
      actorUserId: session.user.id,
      action: "purchase.return.created",
      entityType: "purchase_return",
      entityId: created.id,
      metadata: { document: created.returnNumber, grnId: parsed.data.grnId },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/purchases/returns");
  revalidatePath(`/purchases/grn/${parsed.data.grnId}`);
  redirect(`/purchases/returns/${created.id}`);
}

async function transitionReturn(
  formData: FormData,
  action: "approved" | "completed" | "cancelled",
  run: (id: string, actorUserId: string) => Promise<unknown>,
): Promise<void> {
  const session = await requirePermission("purchase.approve");
  const id = text(formData, "id");
  if (!id) return;

  try {
    await run(id, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: `purchase.return.${action}`,
      entityType: "purchase_return",
      entityId: id,
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/purchases/returns/${id}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath("/purchases/returns");
  revalidatePath(`/purchases/returns/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/suppliers");
  revalidatePath("/accounting");
}

export async function approvePurchaseReturnAction(formData: FormData): Promise<void> {
  await transitionReturn(formData, "approved", (id, actorUserId) =>
    approvePurchaseReturn(id, actorUserId),
  );
}

export async function completePurchaseReturnAction(formData: FormData): Promise<void> {
  await transitionReturn(formData, "completed", (id, actorUserId) =>
    completePurchaseReturn(id, actorUserId),
  );
}

export async function cancelPurchaseReturnAction(formData: FormData): Promise<void> {
  await transitionReturn(formData, "cancelled", (id) => cancelPurchaseReturn(id));
}
