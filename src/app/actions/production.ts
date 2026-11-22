"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { requirePermission } from "@/lib/auth/session";
import {
  ProductionError,
  addComponent,
  addDesignRevision,
  approveDesign,
  createProductionJob,
  issueComponents,
  removeComponent,
  requestDesignChanges,
  sendDesignForApproval,
  transitionProduction,
} from "@/lib/production/service";

export type ProductionFormState = { error?: string };

const STATUSES = [
  "PENDING_DESIGN",
  "DESIGN_PREPARATION",
  "AWAITING_CUSTOMER_APPROVAL",
  "APPROVED",
  "PRODUCTION",
  "QUALITY_CHECK",
  "READY_TO_SHIP",
  "COMPLETED",
  "CANCELLED",
] as const;

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the highlighted fields.";
}

function explain(error: unknown): string {
  if (
    error instanceof ProductionError ||
    (error instanceof Error && error.name === "InventoryError") ||
    (error instanceof Error && error.name === "AccountingError")
  ) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional();
}

function parseDate(value: string, label: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new ProductionError(`Enter a valid ${label}.`);
  return parsed;
}

const jobSchema = z.object({
  orderItemId: z.string().trim().min(1, "Choose an order line."),
  priority: z.enum(PRIORITIES),
  dueAt: optionalText(10),
  designNotes: optionalText(1000),
  engravingText: optionalText(200),
  fontName: optionalText(80),
  instructions: optionalText(500),
});

function readComponents(formData: FormData) {
  const variantIds = formData.getAll("variantId").map((value) => String(value).trim());
  const quantities = formData.getAll("quantity").map((value) => String(value).trim());

  const components: Array<{ variantId: string; quantity: string }> = [];
  for (let index = 0; index < variantIds.length; index += 1) {
    const variantId = variantIds[index];
    const raw = quantities[index] ?? "";
    if (!variantId || !raw || Number(raw) === 0) continue;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new ProductionError(`Enter a valid quantity on component line ${index + 1}.`);
    }
    components.push({ variantId, quantity: raw });
  }
  return components;
}

export async function createProductionJobAction(
  _previous: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const session = await requirePermission("production.write");

  const parsed = jobSchema.safeParse({
    orderItemId: text(formData, "orderItemId"),
    priority: text(formData, "priority") || "NORMAL",
    dueAt: text(formData, "dueAt"),
    designNotes: text(formData, "designNotes"),
    engravingText: text(formData, "engravingText"),
    fontName: text(formData, "fontName"),
    instructions: text(formData, "instructions"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  let created: { id: string; jobNumber: string };
  try {
    created = await createProductionJob({
      orderItemId: parsed.data.orderItemId,
      priority: parsed.data.priority,
      dueAt: parseDate(parsed.data.dueAt ?? "", "due date"),
      designNotes: parsed.data.designNotes,
      engravingText: parsed.data.engravingText,
      fontName: parsed.data.fontName,
      instructions: parsed.data.instructions,
      components: readComponents(formData),
      actorUserId: session.user.id,
    });
    await audit({
      actorUserId: session.user.id,
      action: "production.job.created",
      entityType: "production_job",
      entityId: created.id,
      metadata: {
        document: created.jobNumber,
        orderItemId: parsed.data.orderItemId,
      },
      ...(await requestMeta()),
    });
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath("/production");
  revalidatePath("/orders");
  redirect(`/production/${created.id}`);
}

export async function addComponentAction(formData: FormData): Promise<void> {
  await requirePermission("production.write");
  const jobId = text(formData, "jobId");
  const variantId = text(formData, "variantId");
  const quantity = text(formData, "quantity");
  if (!jobId) return;

  try {
    if (!variantId || !quantity) throw new ProductionError("Choose a component and quantity.");
    await addComponent(jobId, { variantId, quantity });
  } catch (error) {
    redirect(`/production/${jobId}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath(`/production/${jobId}`);
}

export async function removeComponentAction(formData: FormData): Promise<void> {
  await requirePermission("production.write");
  const jobId = text(formData, "jobId");
  const itemId = text(formData, "itemId");
  if (!jobId || !itemId) return;

  try {
    await removeComponent(jobId, itemId);
  } catch (error) {
    redirect(`/production/${jobId}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath(`/production/${jobId}`);
}

export async function addRevisionAction(
  _previous: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const session = await requirePermission("production.write");
  const jobId = text(formData, "jobId");
  const description = text(formData, "description").trim();
  const previewUrl = text(formData, "previewUrl").trim();
  if (!jobId) return { error: "Missing production job." };
  if (!description && !previewUrl) {
    return { error: "Add a description or a preview link for the revision." };
  }

  try {
    await addDesignRevision(jobId, { description, previewUrl }, session.user.id);
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath(`/production/${jobId}`);
  return {};
}

export async function sendForApprovalAction(formData: FormData): Promise<void> {
  const session = await requirePermission("production.write");
  const jobId = text(formData, "jobId");
  if (!jobId) return;

  try {
    await sendDesignForApproval(jobId, session.user.id);
  } catch (error) {
    redirect(`/production/${jobId}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath(`/production/${jobId}`);
}

export async function approveDesignAction(formData: FormData): Promise<void> {
  const session = await requirePermission("production.approve");
  const jobId = text(formData, "jobId");
  const note = text(formData, "note");
  if (!jobId) return;

  try {
    await approveDesign(jobId, session.user.id, note);
    await audit({
      actorUserId: session.user.id,
      action: "production.design.approved",
      entityType: "production_job",
      entityId: jobId,
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/production/${jobId}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath(`/production/${jobId}`);
}

export async function requestChangesAction(
  _previous: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const session = await requirePermission("production.approve");
  const jobId = text(formData, "jobId");
  const note = text(formData, "note").trim();
  if (!jobId) return { error: "Missing production job." };
  if (!note) return { error: "Say what needs to change." };

  try {
    await requestDesignChanges(jobId, note, session.user.id);
  } catch (error) {
    return { error: explain(error) };
  }

  revalidatePath(`/production/${jobId}`);
  return {};
}

export async function issueComponentsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("production.approve");
  const jobId = text(formData, "jobId");
  if (!jobId) return;

  try {
    await issueComponents(jobId, session.user.id);
    await audit({
      actorUserId: session.user.id,
      action: "production.materials.issued",
      entityType: "production_job",
      entityId: jobId,
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(`/production/${jobId}?error=${encodeURIComponent(explain(error))}`);
  }

  revalidatePath(`/production/${jobId}`);
  revalidatePath("/inventory");
  revalidatePath("/accounting");
}

const transitionSchema = z.object({
  id: z.string().trim().min(1),
  to: z.enum(STATUSES),
  note: optionalText(300),
});

export async function transitionProductionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("production.approve");
  const parsed = transitionSchema.safeParse({
    id: text(formData, "id"),
    to: text(formData, "to"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return;

  try {
    await transitionProduction(
      parsed.data.id,
      parsed.data.to,
      session.user.id,
      parsed.data.note,
    );
    await audit({
      actorUserId: session.user.id,
      action: `production.job.${parsed.data.to.toLowerCase()}`,
      entityType: "production_job",
      entityId: parsed.data.id,
      metadata: { to: parsed.data.to },
      ...(await requestMeta()),
    });
  } catch (error) {
    redirect(
      `/production/${parsed.data.id}?error=${encodeURIComponent(explain(error))}`,
    );
  }

  revalidatePath("/production");
  revalidatePath(`/production/${parsed.data.id}`);
  revalidatePath("/orders");
  revalidatePath("/inventory");
  revalidatePath("/accounting");
}
