import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { AccountError } from "./service";

/**
 * Saved delivery addresses.
 *
 * The first address becomes the default, and setting a new default clears the
 * old one inside a transaction so the checkout page always has one choice.
 * Deleting is a soft delete: an old order may still quote the address, and the
 * shop never hard-deletes customer history.
 */
export type AddressInput = {
  label?: string;
  recipientName: string;
  mobile: string;
  division: string;
  district: string;
  upazila: string;
  area?: string;
  addressLine: string;
  postcode?: string;
};

export const MAX_ADDRESSES = 20;

/** Use the caller's transaction when supplied, so tests can roll back. */
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

function validate(input: AddressInput) {
  const recipientName = clean(input.recipientName, 120);
  const division = clean(input.division, 60);
  const district = clean(input.district, 60);
  const upazila = clean(input.upazila, 60);
  const area = clean(input.area, 120);
  const addressLine = clean(input.addressLine, 400);
  const postcode = clean(input.postcode, 10);
  const label = clean(input.label, 40) || "Home";

  if (recipientName.length < 2) throw new AccountError("Enter the recipient's name.");
  if (!division || !district || !upazila) {
    throw new AccountError("Choose the division, district and upazila.");
  }
  if (addressLine.length < 6) throw new AccountError("Enter the full street address.");

  const mobile = tryNormalizeBdMobile(input.mobile);
  if (!mobile) throw new AccountError("Enter a valid Bangladeshi mobile number.");

  return {
    label,
    recipientName,
    mobileNormalized: mobile,
    division,
    district,
    upazila,
    area: area || null,
    addressLine,
    postcode: postcode || null,
  };
}

export async function listCustomerAddresses(
  customerId: string,
  outer?: Prisma.TransactionClient,
) {
  return (outer ?? prisma).customerAddress.findMany({
    where: { customerId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      label: true,
      recipientName: true,
      mobileNormalized: true,
      division: true,
      district: true,
      upazila: true,
      area: true,
      addressLine: true,
      postcode: true,
      isDefault: true,
    },
  });
}

export async function createCustomerAddress(
  customerId: string,
  input: AddressInput,
  outer?: Prisma.TransactionClient,
): Promise<string> {
  const data = validate(input);

  return run(outer, async (tx) => {
    const count = await tx.customerAddress.count({
      where: { customerId, deletedAt: null },
    });
    if (count >= MAX_ADDRESSES) {
      throw new AccountError(`Keep at most ${MAX_ADDRESSES} saved addresses.`);
    }

    const isFirst = count === 0;
    if (isFirst) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
    }

    const created = await tx.customerAddress.create({
      data: { ...data, customerId, isDefault: isFirst },
      select: { id: true },
    });
    return created.id;
  });
}

export async function updateCustomerAddress(
  customerId: string,
  addressId: string,
  input: AddressInput,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  const data = validate(input);
  const changed = await (outer ?? prisma).customerAddress.updateMany({
    where: { id: addressId, customerId, deletedAt: null },
    data,
  });
  if (changed.count === 0) throw new AccountError("That address no longer exists.");
}

export async function setDefaultCustomerAddress(
  customerId: string,
  addressId: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const address = await tx.customerAddress.findFirst({
      where: { id: addressId, customerId, deletedAt: null },
      select: { id: true },
    });
    if (!address) throw new AccountError("That address no longer exists.");

    await tx.customerAddress.updateMany({
      where: { customerId, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
    await tx.customerAddress.update({
      where: { id: address.id },
      data: { isDefault: true },
    });
  });
}

export async function deleteCustomerAddress(
  customerId: string,
  addressId: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const address = await tx.customerAddress.findFirst({
      where: { id: addressId, customerId, deletedAt: null },
      select: { id: true, isDefault: true },
    });
    if (!address) throw new AccountError("That address no longer exists.");

    await tx.customerAddress.update({
      where: { id: address.id },
      data: { deletedAt: new Date(), isDefault: false },
    });

    if (address.isDefault) {
      const next = await tx.customerAddress.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (next) {
        await tx.customerAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  });
}

/** The default address, for prefilling checkout. */
export async function defaultCustomerAddress(
  customerId: string,
  outer?: Prisma.TransactionClient,
) {
  return (outer ?? prisma).customerAddress.findFirst({
    where: { customerId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      label: true,
      recipientName: true,
      mobileNormalized: true,
      division: true,
      district: true,
      upazila: true,
      area: true,
      addressLine: true,
      postcode: true,
    },
  });
}

export type AddressView = Prisma.CustomerAddressGetPayload<{
  select: {
    id: true;
    label: true;
    recipientName: true;
    mobileNormalized: true;
    division: true;
    district: true;
    upazila: true;
    area: true;
    addressLine: true;
    postcode: true;
    isDefault: true;
  };
}>;
