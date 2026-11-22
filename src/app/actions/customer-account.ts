"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signCustomerSessionToken } from "@/lib/auth/token";
import {
  AccountError,
  changeCustomerPassword,
  registerCustomer,
  signInCustomer,
  updateCustomerProfile,
} from "@/lib/customer-auth/service";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  updateCustomerAddress,
  type AddressInput,
} from "@/lib/customer-auth/addresses";
import { clearCustomerCookie, writeCustomerCookie } from "@/lib/customer-auth/cookies";
import { getCustomerSession, safeCustomerNext } from "@/lib/customer-auth/session";
import type { CustomerActionState } from "@/lib/customer-auth/action-state";

/**
 * Storefront account actions.
 *
 * Every protected action re-reads the signed session on the server; hiding a
 * link is never the guard. Errors go back through `?error=` on a fixed path so
 * a failed form never becomes an open redirect.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function explain(error: unknown): string {
  if (error instanceof AccountError) return error.message;
  return "Something went wrong. Please try again.";
}

function back(path: string, key: "error" | "ok", message: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

async function startSession(customer: { id: string; mobile: string }): Promise<void> {
  await writeCustomerCookie(
    signCustomerSessionToken({ customerId: customer.id, mobile: customer.mobile }),
  );
}

export async function registerCustomerAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  let customer: { id: string; mobile: string };
  try {
    customer = await registerCustomer({
      fullName: text(formData, "fullName"),
      mobile: text(formData, "mobile"),
      password: text(formData, "password"),
      confirmPassword: text(formData, "confirmPassword"),
      email: text(formData, "email"),
      orderNumber: text(formData, "orderNumber"),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await startSession(customer);
  revalidatePath("/account");
  redirect(safeCustomerNext(text(formData, "next")));
}

export async function signInCustomerAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  let customer: { id: string; mobile: string };
  try {
    customer = await signInCustomer({
      mobile: text(formData, "mobile"),
      password: text(formData, "password"),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  await startSession(customer);
  revalidatePath("/account");
  redirect(safeCustomerNext(text(formData, "next")));
}

export async function signOutCustomerAction(): Promise<void> {
  await clearCustomerCookie();
  revalidatePath("/");
  redirect("/");
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Fprofile");

  try {
    await updateCustomerProfile(customer.id, {
      fullName: text(formData, "fullName"),
      email: text(formData, "email"),
    });
  } catch (error) {
    back("/account/profile", "error", explain(error));
  }

  revalidatePath("/account");
  revalidatePath("/account/profile");
  back("/account/profile", "ok", "Profile saved.");
}

export async function changeCustomerPasswordAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Fprofile");

  try {
    await changeCustomerPassword(
      customer.id,
      text(formData, "currentPassword"),
      text(formData, "newPassword"),
      text(formData, "confirmPassword"),
    );
  } catch (error) {
    back("/account/profile", "error", explain(error));
  }

  revalidatePath("/account/profile");
  back("/account/profile", "ok", "Password changed.");
}

function readAddress(formData: FormData): AddressInput {
  return {
    label: text(formData, "label"),
    recipientName: text(formData, "recipientName"),
    mobile: text(formData, "mobile"),
    division: text(formData, "division"),
    district: text(formData, "district"),
    upazila: text(formData, "upazila"),
    area: text(formData, "area"),
    addressLine: text(formData, "addressLine"),
    postcode: text(formData, "postcode"),
  };
}

export async function createAddressAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Faddresses");

  try {
    await createCustomerAddress(customer.id, readAddress(formData));
  } catch (error) {
    back("/account/addresses", "error", explain(error));
  }

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  back("/account/addresses", "ok", "Address saved.");
}

export async function updateAddressAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Faddresses");

  const id = text(formData, "id");
  if (!id) back("/account/addresses", "error", "That address no longer exists.");

  try {
    await updateCustomerAddress(customer.id, id, readAddress(formData));
  } catch (error) {
    back("/account/addresses", "error", explain(error));
  }

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  back("/account/addresses", "ok", "Address updated.");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Faddresses");

  const id = text(formData, "id");
  if (!id) back("/account/addresses", "error", "That address no longer exists.");

  try {
    await setDefaultCustomerAddress(customer.id, id);
  } catch (error) {
    back("/account/addresses", "error", explain(error));
  }

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  back("/account/addresses", "ok", "Default address changed.");
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login?next=%2Faccount%2Faddresses");

  const id = text(formData, "id");
  if (!id) back("/account/addresses", "error", "That address no longer exists.");

  try {
    await deleteCustomerAddress(customer.id, id);
  } catch (error) {
    back("/account/addresses", "error", explain(error));
  }

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  back("/account/addresses", "ok", "Address removed.");
}
