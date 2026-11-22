"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import { AccountingError } from "@/lib/accounting/journal";
import {
  createAccount,
  createExpense,
  postExpense,
  reverseEntry,
  setAccountActive,
  voidExpense,
} from "@/lib/accounting/service";

/**
 * Accounting actions.
 *
 * Reads are guarded by `account.read`; creating accounts and expenses needs the
 * matching `.write`, and posting, voiding or reversing needs `.approve`. Every
 * action re-checks the permission on the server and writes an audit row.
 */
export type AccountingFormState = { error?: string; success?: string };

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

const decimal = (places: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,11}(\\.\\d{1,${places}})?$`), `Use a number with up to ${places} decimals.`);

const PAYMENT_METHODS = [
  "CASH",
  "BKASH",
  "NAGAD",
  "CARD",
  "BANK_TRANSFER",
  "COD",
  "CHEQUE",
  "GATEWAY",
] as const;

const accountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/, "Use a 3–6 digit account code."),
  name: z.string().trim().min(2, "Give the account a name.").max(120),
  nameBn: optionalText(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  description: optionalText(300),
});

const activeSchema = z.object({
  id: z.string().trim().min(1),
  isActive: z.enum(["true", "false"]),
});

const expenseSchema = z.object({
  category: z.string().trim().min(2, "Give the expense a category.").max(80),
  accountId: z.string().trim().min(1, "Choose an expense account."),
  amount: decimal(2),
  vatAmount: z.union([z.literal(""), decimal(2)]).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cashAccountId: optionalText(40),
  bankAccountId: optionalText(40),
  supplierId: optionalText(40),
  description: optionalText(300),
  expenseDate: optionalText(20),
});

const idSchema = z.object({ id: z.string().trim().min(1) });

const voidSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason for voiding.").max(300),
});

const reverseSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Give a reason for the reversal.").max(300),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function explain(error: unknown): string {
  if (error instanceof AccountingError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "That code or document number is already in use.";
    if (error.code === "P2025") return "That record no longer exists.";
  }
  return error instanceof Error ? error.message : "Could not complete that action.";
}

export async function createAccountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("account.write");
  const parsed = accountSchema.safeParse({
    code: text(formData, "code"),
    name: text(formData, "name"),
    nameBn: text(formData, "nameBn"),
    type: text(formData, "type"),
    description: text(formData, "description"),
  });
  if (!parsed.success) {
    redirect(`/accounting/accounts?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    const account = await createAccount(parsed.data);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "account.created",
      entityType: "account",
      entityId: account.id,
      metadata: { code: account.code },
      ...meta,
    });
  } catch (error) {
    redirect(`/accounting/accounts?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/accounting/accounts");
  revalidatePath("/accounting");
  redirect("/accounting/accounts?ok=created");
}

export async function setAccountActiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("account.write");
  const parsed = activeSchema.safeParse({
    id: text(formData, "id"),
    isActive: text(formData, "isActive"),
  });
  if (!parsed.success) {
    redirect(`/accounting/accounts?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await setAccountActive(parsed.data.id, parsed.data.isActive === "true");
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: parsed.data.isActive === "true" ? "account.activated" : "account.deactivated",
      entityType: "account",
      entityId: parsed.data.id,
      ...meta,
    });
  } catch (error) {
    redirect(`/accounting/accounts?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/accounting/accounts");
  redirect("/accounting/accounts?ok=updated");
}

export async function createExpenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("expense.write");
  const parsed = expenseSchema.safeParse({
    category: text(formData, "category"),
    accountId: text(formData, "accountId"),
    amount: text(formData, "amount"),
    vatAmount: text(formData, "vatAmount"),
    paymentMethod: text(formData, "paymentMethod"),
    cashAccountId: text(formData, "cashAccountId"),
    bankAccountId: text(formData, "bankAccountId"),
    supplierId: text(formData, "supplierId"),
    description: text(formData, "description"),
    expenseDate: text(formData, "expenseDate"),
  });
  if (!parsed.success) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    const expenseDate = parsed.data.expenseDate
      ? new Date(parsed.data.expenseDate)
      : undefined;
    if (expenseDate && Number.isNaN(expenseDate.getTime())) {
      throw new AccountingError("That expense date could not be read.");
    }
    const expense = await createExpense({
      category: parsed.data.category,
      accountId: parsed.data.accountId,
      amount: parsed.data.amount,
      vatAmount: parsed.data.vatAmount || 0,
      paymentMethod: parsed.data.paymentMethod,
      cashAccountId: parsed.data.cashAccountId,
      bankAccountId: parsed.data.bankAccountId,
      supplierId: parsed.data.supplierId,
      description: parsed.data.description,
      expenseDate,
      actorUserId: session.user.id,
    });
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "expense.created",
      entityType: "expense",
      entityId: expense.id,
      metadata: { expenseNumber: expense.expenseNumber },
      ...meta,
    });
  } catch (error) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/accounting/expenses");
  redirect("/accounting/expenses?ok=created");
}

export async function postExpenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("expense.approve");
  const parsed = idSchema.safeParse({ id: text(formData, "id") });
  if (!parsed.success) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    const expense = await postExpense(parsed.data.id, session.user.id);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "expense.posted",
      entityType: "expense",
      entityId: parsed.data.id,
      metadata: { expenseNumber: expense.expenseNumber },
      ...meta,
    });
  } catch (error) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/accounting/expenses");
  revalidatePath("/accounting");
  revalidatePath("/accounting/journals");
  redirect("/accounting/expenses?ok=posted");
}

export async function voidExpenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("expense.approve");
  const parsed = voidSchema.safeParse({
    id: text(formData, "id"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await voidExpense(parsed.data.id, session.user.id, parsed.data.reason);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "expense.voided",
      entityType: "expense",
      entityId: parsed.data.id,
      reason: parsed.data.reason,
      ...meta,
    });
  } catch (error) {
    redirect(`/accounting/expenses?error=${encodeURIComponent(explain(error))}`);
  }
  revalidatePath("/accounting/expenses");
  revalidatePath("/accounting");
  revalidatePath("/accounting/journals");
  redirect("/accounting/expenses?ok=voided");
}

export async function reverseJournalAction(formData: FormData): Promise<void> {
  const session = await requirePermission("account.approve");
  const parsed = reverseSchema.safeParse({
    id: text(formData, "id"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    redirect(`/accounting/journals?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }

  try {
    await reverseEntry(parsed.data.id, session.user.id, parsed.data.reason);
    const meta = await requestMeta();
    await audit({
      actorUserId: session.user.id,
      action: "journal.reversed",
      entityType: "journal_entry",
      entityId: parsed.data.id,
      reason: parsed.data.reason,
      ...meta,
    });
  } catch (error) {
    redirect(
      `/accounting/journals/${parsed.data.id}?error=${encodeURIComponent(explain(error))}`,
    );
  }
  revalidatePath("/accounting");
  revalidatePath("/accounting/journals");
  revalidatePath(`/accounting/journals/${parsed.data.id}`);
  redirect(`/accounting/journals/${parsed.data.id}?ok=reversed`);
}
