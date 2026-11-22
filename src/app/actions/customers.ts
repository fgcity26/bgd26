"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { normalizeBdMobile, PhoneError } from "@/lib/crm/phone";
import { prisma } from "@/lib/db";

/**
 * Customer (CRM) actions.
 *
 * Customers are soft-deleted, never removed: orders, payments, loyalty and
 * journals reference them. A mobile number is the identity key, stored in one
 * canonical `+8801XXXXXXXXX` form; a change writes `customer_mobile_history`.
 */
export type CustomerFormState = {
  error?: string;
  success?: string;
};

const CUSTOMER_TYPES = ["RETAIL", "WHOLESALE", "WALK_IN_CASH", "DROPSHIP_PARTNER"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const customerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the customer's name.").max(160),
  mobile: z.string().trim().min(1, "Enter a mobile number."),
  email: optionalText(200),
  customerType: z.enum(CUSTOMER_TYPES),
  tags: optionalText(600),
});

const addressSchema = z.object({
  customerId: z.string().trim().min(1),
  label: optionalText(40),
  recipientName: z.string().trim().min(2, "Enter the recipient's name.").max(160),
  mobile: z.string().trim().min(1, "Enter a mobile number."),
  division: z.string().trim().min(1, "Enter the division.").max(60),
  district: z.string().trim().min(1, "Enter the district.").max(60),
  upazila: z.string().trim().min(1, "Enter the upazila.").max(60),
  area: optionalText(120),
  addressLine: z.string().trim().min(3, "Enter the street address.").max(300),
  postcode: optionalText(12),
  addressType: z.enum(["SHIPPING", "BILLING", "BOTH"]),
  isDefault: z.boolean(),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function parseTags(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((tag) => tag.slice(0, 40));
}

function parseEmail(value: string | undefined): string | null {
  const email = optional(value);
  if (!email) return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address, or leave it blank.");
  }
  return email.toLowerCase();
}

function readCustomerForm(formData: FormData) {
  const parsed = customerSchema.safeParse({
    fullName: text(formData, "fullName"),
    mobile: text(formData, "mobile"),
    email: text(formData, "email"),
    customerType: text(formData, "customerType") || "RETAIL",
    tags: text(formData, "tags"),
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  return parsed.data;
}

function explain(error: unknown): string {
  if (error instanceof PhoneError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "A customer with that mobile number already exists.";
  }
  return error instanceof Error ? error.message : "Could not save the customer.";
}

export async function createCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const session = await requirePermission("customer.write");

  let customerId: string;
  try {
    const data = readCustomerForm(formData);
    const mobileNormalized = normalizeBdMobile(data.mobile);
    const email = parseEmail(data.email);

    const existing = await prisma.customer.findUnique({
      where: { mobileNormalized },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      return {
        error: existing.deletedAt
          ? "A deleted customer uses that number. Restore it instead of creating a duplicate."
          : "A customer with that mobile number already exists.",
      };
    }

    const created = await prisma.customer.create({
      data: {
        fullName: data.fullName,
        mobileNormalized,
        mobileRaw: data.mobile.trim(),
        email,
        customerType: data.customerType,
        tags: parseTags(data.tags),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    customerId = created.id;
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.created",
    entityType: "customer",
    entityId: customerId,
    metadata: { name: text(formData, "fullName") },
    ...(await requestMeta()),
  });

  revalidatePath("/customers");
  redirect(`/customers/${customerId}`);
}

export async function updateCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const session = await requirePermission("customer.write");
  const id = text(formData, "id");
  if (!id) return { error: "Missing customer id." };

  let mobileChanged: { from: string; to: string } | null = null;
  try {
    const data = readCustomerForm(formData);
    const mobileNormalized = normalizeBdMobile(data.mobile);
    const email = parseEmail(data.email);

    const current = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, mobileNormalized: true, isWalkInCash: true },
    });
    if (!current) return { error: "That customer no longer exists." };
    if (current.isWalkInCash) return { error: "The walk-in cash customer cannot be edited." };

    if (mobileNormalized !== current.mobileNormalized) {
      const clash = await prisma.customer.findUnique({
        where: { mobileNormalized },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        return { error: "Another customer already uses that mobile number." };
      }
      mobileChanged = { from: current.mobileNormalized, to: mobileNormalized };
    }

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          fullName: data.fullName,
          mobileNormalized,
          mobileRaw: data.mobile.trim(),
          email,
          customerType: data.customerType,
          tags: parseTags(data.tags),
        },
      });

      if (mobileChanged) {
        await tx.customerMobileHistory.create({
          data: {
            customerId: id,
            oldMobile: mobileChanged.from,
            newMobile: mobileChanged.to,
            changedByUserId: session.user.id,
            reason: "Updated in the staff console",
          },
        });
      }
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.updated",
    entityType: "customer",
    entityId: id,
    metadata: mobileChanged ?? undefined,
    ...(await requestMeta()),
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { success: "Customer saved." };
}

export async function addCustomerAddressAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const session = await requirePermission("customer.write");

  const parsed = addressSchema.safeParse({
    customerId: text(formData, "customerId"),
    label: text(formData, "label"),
    recipientName: text(formData, "recipientName"),
    mobile: text(formData, "mobile"),
    division: text(formData, "division"),
    district: text(formData, "district"),
    upazila: text(formData, "upazila"),
    area: text(formData, "area"),
    addressLine: text(formData, "addressLine"),
    postcode: text(formData, "postcode"),
    addressType: text(formData, "addressType") || "SHIPPING",
    isDefault: checkbox(formData, "isDefault"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) return { error: "That customer cannot be edited." };

    const mobileNormalized = normalizeBdMobile(data.mobile);
    const addressCount = await prisma.customerAddress.count({
      where: { customerId: data.customerId, deletedAt: null },
    });
    const makeDefault = data.isDefault || addressCount === 0;

    await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: data.customerId, deletedAt: null },
          data: { isDefault: false },
        });
      }
      await tx.customerAddress.create({
        data: {
          customerId: data.customerId,
          label: optional(data.label) ?? "Home",
          recipientName: data.recipientName,
          mobileNormalized,
          division: data.division,
          district: data.district,
          upazila: data.upazila,
          area: optional(data.area),
          addressLine: data.addressLine,
          postcode: optional(data.postcode),
          addressType: data.addressType,
          isDefault: makeDefault,
        },
      });
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.address_added",
    entityType: "customer",
    entityId: data.customerId,
    ...(await requestMeta()),
  });

  revalidatePath(`/customers/${data.customerId}`);
  return { success: "Address added." };
}

export async function removeCustomerAddressAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.write");
  const id = text(formData, "id");
  const customerId = text(formData, "customerId");
  if (!id || !customerId) return;

  const address = await prisma.customerAddress.findFirst({
    where: { id, customerId, deletedAt: null },
    select: { id: true, isDefault: true },
  });
  if (!address) return;

  await prisma.$transaction(async (tx) => {
    await tx.customerAddress.update({ where: { id }, data: { deletedAt: new Date() } });

    if (address.isDefault) {
      const next = await tx.customerAddress.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.address_removed",
    entityType: "customer",
    entityId: customerId,
    metadata: { addressId: id },
    ...(await requestMeta()),
  });

  revalidatePath(`/customers/${customerId}`);
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.write");
  const id = text(formData, "id");
  const customerId = text(formData, "customerId");
  if (!id || !customerId) return;

  const address = await prisma.customerAddress.findFirst({
    where: { id, customerId, deletedAt: null },
    select: { id: true },
  });
  if (!address) return;

  await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: { customerId, deletedAt: null },
      data: { isDefault: false },
    }),
    prisma.customerAddress.update({ where: { id }, data: { isDefault: true } }),
  ]);

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.default_address_changed",
    entityType: "customer",
    entityId: customerId,
    metadata: { addressId: id },
    ...(await requestMeta()),
  });

  revalidatePath(`/customers/${customerId}`);
}

export async function addCustomerNoteAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const session = await requirePermission("customer.write");
  const customerId = text(formData, "customerId");
  const note = text(formData, "note").trim();
  const isPinned = checkbox(formData, "isPinned");

  if (!customerId) return { error: "Missing customer id." };
  if (note.length < 2) return { error: "Write a note first." };
  if (note.length > 2000) return { error: "Notes are limited to 2000 characters." };

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, deletedAt: true },
  });
  if (!customer || customer.deletedAt) return { error: "That customer cannot be edited." };

  await prisma.customerNote.create({
    data: { customerId, authorUserId: session.user.id, note, isPinned },
  });

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.note_added",
    entityType: "customer",
    entityId: customerId,
    ...(await requestMeta()),
  });

  revalidatePath(`/customers/${customerId}`);
  return { success: "Note added." };
}

export async function deleteCustomerNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.write");
  const id = text(formData, "id");
  const customerId = text(formData, "customerId");
  if (!id || !customerId) return;

  await prisma.customerNote.deleteMany({ where: { id, customerId } });

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.note_deleted",
    entityType: "customer",
    entityId: customerId,
    metadata: { noteId: id },
    ...(await requestMeta()),
  });

  revalidatePath(`/customers/${customerId}`);
}

export async function setCustomerBlockedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.write");
  const id = text(formData, "id");
  const blocked = text(formData, "blocked") === "true";
  if (!id) return;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, isWalkInCash: true },
  });
  if (!customer || customer.isWalkInCash) return;

  await prisma.customer.update({
    where: { id },
    data: { status: blocked ? "BLOCKED" : "ACTIVE" },
  });

  await audit({
    actorUserId: session.user.id,
    action: blocked ? "crm.customer.blocked" : "crm.customer.unblocked",
    entityType: "customer",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function softDeleteCustomerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("customer.delete");
  const id = text(formData, "id");
  if (!id) return;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, isWalkInCash: true, deletedAt: true },
  });
  if (!customer || customer.isWalkInCash || customer.deletedAt) return;

  await prisma.customer.update({
    where: { id },
    data: { status: "BLOCKED", deletedAt: new Date() },
  });

  await audit({
    actorUserId: session.user.id,
    action: "crm.customer.soft_deleted",
    entityType: "customer",
    entityId: id,
    ...(await requestMeta()),
  });

  revalidatePath("/customers");
  redirect("/customers");
}
