import { randomBytes } from "node:crypto";
import {
  Prisma,
  type ProductionPriority,
  type ProductionStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { money, qty, type Numeric } from "@/lib/inventory/decimal";
import { postStockMovement } from "@/lib/inventory/stock";

/**
 * Engraving production.
 *
 * A job belongs to one order line. The design moves through revisions and an
 * approval before anything is made; components are then issued from a warehouse
 * at AVCO into work in progress (`1130`), and completing the job expenses that
 * value to cost of goods sold. The order keeps its own shipping status, so
 * production and dispatch stay independent.
 *
 * Stock uses the existing `PRODUCTION_ISSUE` outbound and `PRODUCTION_RETURN`
 * inbound movements, so the AVCO engine and the append-only ledger apply
 * unchanged. Cancelling a job after issue returns the components to stock.
 */

export class ProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionError";
  }
}

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

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  PENDING_DESIGN: "Pending design",
  DESIGN_PREPARATION: "Design in progress",
  AWAITING_CUSTOMER_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  PRODUCTION: "In production",
  QUALITY_CHECK: "Quality check",
  READY_TO_SHIP: "Ready to ship",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** The only status moves this module allows. */
export const PRODUCTION_TRANSITIONS: Record<ProductionStatus, ProductionStatus[]> = {
  PENDING_DESIGN: ["DESIGN_PREPARATION", "CANCELLED"],
  DESIGN_PREPARATION: ["AWAITING_CUSTOMER_APPROVAL", "CANCELLED"],
  AWAITING_CUSTOMER_APPROVAL: ["APPROVED", "DESIGN_PREPARATION", "CANCELLED"],
  APPROVED: ["PRODUCTION", "CANCELLED"],
  PRODUCTION: ["QUALITY_CHECK", "CANCELLED"],
  QUALITY_CHECK: ["READY_TO_SHIP", "PRODUCTION", "CANCELLED"],
  READY_TO_SHIP: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const ORDER_STATUSES = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"] as const;

/** Order statuses where a production job can still be raised. */
export const PRODUCTION_ORDER_STATUSES = ORDER_STATUSES;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type ProductionComponentInput = {
  variantId: string;
  quantity: Numeric;
};

export type CreateProductionJobInput = {
  orderItemId: string;
  priority?: ProductionPriority;
  dueAt?: Date | null;
  designNotes?: string | null;
  engravingText?: string | null;
  fontName?: string | null;
  instructions?: string | null;
  components?: ProductionComponentInput[];
  actorUserId: string;
};

export async function createProductionJob(
  input: CreateProductionJobInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: {
        id: true,
        orderId: true,
        variantId: true,
        fulfillmentType: true,
        productNameSnapshot: true,
        variantNameSnapshot: true,
        skuSnapshot: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            storeId: true,
            warehouseId: true,
          },
        },
      },
    });
    if (!item) throw new ProductionError("That order line no longer exists.");
    if (!item.variantId) {
      throw new ProductionError("That line has no variant, so it cannot be produced.");
    }
    if (item.fulfillmentType === "DROPSHIP") {
      throw new ProductionError("A dropship line is produced by the supplier, not here.");
    }
    if (!ORDER_STATUSES.includes(item.order.status as (typeof ORDER_STATUSES)[number])) {
      throw new ProductionError(
        "A production job can only be raised for a confirmed, processing or ready-to-ship order.",
      );
    }

    const live = await tx.productionJob.findFirst({
      where: {
        orderItemId: item.id,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      select: { id: true, jobNumber: true },
    });
    if (live) {
      throw new ProductionError(`That line already has a live job (${live.jobNumber}).`);
    }

    let warehouseId = item.order.warehouseId;
    if (!warehouseId) {
      const warehouse = await tx.warehouse.findFirst({
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!warehouse) throw new ProductionError("No active warehouse is available.");
      warehouseId = warehouse.id;
    }

    // Merge repeated variants and refuse the finished variant as its own
    // component, which would make the average cost meaningless.
    const merged = new Map<string, Prisma.Decimal>();
    for (const component of input.components ?? []) {
      const quantity = qty(component.quantity);
      if (!quantity.greaterThan(0)) {
        throw new ProductionError("Every component needs a quantity greater than zero.");
      }
      if (component.variantId === item.variantId) {
        throw new ProductionError("A job cannot consume the same variant it produces.");
      }
      merged.set(component.variantId, (merged.get(component.variantId) ?? qty(0)).add(quantity));
    }

    for (const variantId of merged.keys()) {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { fulfillmentType: true, status: true },
      });
      if (!variant) throw new ProductionError("A component variant no longer exists.");
      if (variant.fulfillmentType !== "STOCKED") {
        throw new ProductionError("Components must be stocked variants.");
      }
      if (variant.status !== "ACTIVE") {
        throw new ProductionError("A component variant is not active.");
      }
    }

    const job = await tx.productionJob.create({
      data: {
        jobNumber: code("JOB"),
        orderId: item.orderId,
        orderItemId: item.id,
        storeId: item.order.storeId,
        warehouseId,
        status: "PENDING_DESIGN",
        priority: input.priority ?? "NORMAL",
        designNotes: text(input.designNotes),
        dueAt: input.dueAt ?? null,
        createdByUserId: input.actorUserId,
        items: {
          create: [...merged.entries()].map(([variantId, quantity]) => ({
            variantId,
            quantityRequired: quantity,
          })),
        },
        statusHistory: {
          create: {
            toStatus: "PENDING_DESIGN",
            changedByUserId: input.actorUserId,
            note: "Job created",
          },
        },
      },
      select: { id: true, jobNumber: true },
    });

    const engraving = text(input.engravingText) ?? text(input.instructions);
    if (engraving) {
      await tx.orderItemCustomization.create({
        data: {
          orderItemId: item.id,
          type: "ENGRAVING",
          instructions: text(input.instructions),
          textContent: text(input.engravingText),
          fontName: text(input.fontName),
          status: "UPLOADED",
        },
      });
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        productionRequired: true,
        productionStatus: "PENDING_DESIGN",
        ...(engraving ? { customizationRequired: true } : {}),
      },
    });
    await tx.order.update({
      where: { id: item.orderId },
      data: { requiresProduction: true },
    });

    return job;
  });
}

export async function addComponent(
  jobId: string,
  component: ProductionComponentInput,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        orderItem: { select: { variantId: true } },
        items: { select: { quantityIssued: true } },
      },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (!["PENDING_DESIGN", "DESIGN_PREPARATION", "AWAITING_CUSTOMER_APPROVAL", "APPROVED"].includes(job.status)) {
      throw new ProductionError("Components can only be changed before production starts.");
    }
    if (job.items.some((item) => item.quantityIssued.greaterThan(0))) {
      throw new ProductionError("Components have already been issued; they cannot be changed.");
    }
    if (component.variantId === job.orderItem.variantId) {
      throw new ProductionError("A job cannot consume the same variant it produces.");
    }

    const quantity = qty(component.quantity);
    if (!quantity.greaterThan(0)) {
      throw new ProductionError("The quantity must be greater than zero.");
    }

    const variant = await tx.productVariant.findUnique({
      where: { id: component.variantId },
      select: { fulfillmentType: true, status: true },
    });
    if (!variant) throw new ProductionError("That variant no longer exists.");
    if (variant.fulfillmentType !== "STOCKED") {
      throw new ProductionError("Components must be stocked variants.");
    }
    if (variant.status !== "ACTIVE") {
      throw new ProductionError("That variant is not active.");
    }

    const existing = await tx.productionJobItem.findFirst({
      where: { jobId, variantId: component.variantId },
      select: { id: true, quantityRequired: true },
    });
    if (existing) {
      return tx.productionJobItem.update({
        where: { id: existing.id },
        data: { quantityRequired: existing.quantityRequired.add(quantity) },
        select: { id: true, quantityRequired: true },
      });
    }

    return tx.productionJobItem.create({
      data: { jobId, variantId: component.variantId, quantityRequired: quantity },
      select: { id: true, quantityRequired: true },
    });
  });
}

export async function removeComponent(
  jobId: string,
  itemId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: { id: true, jobId: true, quantityIssued: true },
    });
    if (!item || item.jobId !== jobId) {
      throw new ProductionError("That component is not part of this job.");
    }
    if (item.quantityIssued.greaterThan(0)) {
      throw new ProductionError("Issued components cannot be removed; cancel the job instead.");
    }
    await tx.productionJobItem.delete({ where: { id: item.id } });
    return { id: item.id };
  });
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export async function addDesignRevision(
  jobId: string,
  input: { description?: string | null; previewUrl?: string | null },
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (!["PENDING_DESIGN", "DESIGN_PREPARATION", "AWAITING_CUSTOMER_APPROVAL"].includes(job.status)) {
      throw new ProductionError("The design is already approved.");
    }

    const last = await tx.designRevision.aggregate({
      where: { productionJobId: jobId },
      _max: { revisionNumber: true },
    });
    const revision = await tx.designRevision.create({
      data: {
        productionJobId: jobId,
        revisionNumber: (last._max.revisionNumber ?? 0) + 1,
        description: text(input.description),
        previewUrl: text(input.previewUrl),
        createdByUserId: actorUserId,
      },
      select: { id: true, revisionNumber: true },
    });

    if (job.status === "PENDING_DESIGN") {
      await tx.productionJob.update({
        where: { id: jobId },
        data: { status: "DESIGN_PREPARATION" },
      });
      await tx.productionStatusHistory.create({
        data: {
          productionJobId: jobId,
          fromStatus: "PENDING_DESIGN",
          toStatus: "DESIGN_PREPARATION",
          changedByUserId: actorUserId,
          note: "First design revision added",
        },
      });
      await tx.orderItem.updateMany({
        where: { productionJobs: { some: { id: jobId } } },
        data: { productionStatus: "DESIGN_PREPARATION" },
      });
    }

    return revision;
  });
}

export async function sendDesignForApproval(
  jobId: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        designRevisions: {
          orderBy: { revisionNumber: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (job.status !== "DESIGN_PREPARATION") {
      throw new ProductionError("Only a job in design can be sent for approval.");
    }
    const revision = job.designRevisions[0];
    if (!revision) throw new ProductionError("Add at least one design revision first.");

    await tx.designApproval.updateMany({
      where: { productionJobId: jobId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    const approval = await tx.designApproval.create({
      data: { productionJobId: jobId, designRevisionId: revision.id, status: "PENDING" },
      select: { id: true },
    });

    await tx.productionJob.update({
      where: { id: jobId },
      data: { status: "AWAITING_CUSTOMER_APPROVAL" },
    });
    await tx.productionStatusHistory.create({
      data: {
        productionJobId: jobId,
        fromStatus: "DESIGN_PREPARATION",
        toStatus: "AWAITING_CUSTOMER_APPROVAL",
        changedByUserId: actorUserId,
        note: "Sent for approval",
      },
    });
    await tx.orderItem.updateMany({
      where: { productionJobs: { some: { id: jobId } } },
      data: { productionStatus: "AWAITING_CUSTOMER_APPROVAL" },
    });

    return approval;
  });
}

export async function approveDesign(
  jobId: string,
  actorUserId: string,
  note?: string | null,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        orderItemId: true,
        designRevisions: {
          orderBy: { revisionNumber: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (job.status !== "AWAITING_CUSTOMER_APPROVAL") {
      throw new ProductionError("Only a job awaiting approval can be approved.");
    }
    const revision = job.designRevisions[0];
    if (!revision) throw new ProductionError("That job has no design revision.");

    await tx.designApproval.updateMany({
      where: { productionJobId: jobId, status: "PENDING" },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        notes: text(note),
      },
    });

    const now = new Date();
    await tx.productionJob.update({
      where: { id: jobId },
      data: { status: "APPROVED" },
    });
    await tx.orderItemCustomization.updateMany({
      where: { orderItemId: job.orderItemId },
      data: { status: "APPROVED", approvedAt: now },
    });
    await tx.orderItem.updateMany({
      where: { productionJobs: { some: { id: jobId } } },
      data: { productionStatus: "APPROVED" },
    });
    await tx.productionStatusHistory.create({
      data: {
        productionJobId: jobId,
        fromStatus: "AWAITING_CUSTOMER_APPROVAL",
        toStatus: "APPROVED",
        changedByUserId: actorUserId,
        note: text(note) ?? "Design approved",
      },
    });

    return { id: jobId, revisionId: revision.id };
  });
}

export async function requestDesignChanges(
  jobId: string,
  note: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  const reason = text(note);
  if (!reason) throw new ProductionError("Say what needs to change.");

  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (job.status !== "AWAITING_CUSTOMER_APPROVAL") {
      throw new ProductionError("Only a job awaiting approval can be sent back.");
    }

    await tx.designApproval.updateMany({
      where: { productionJobId: jobId, status: "PENDING" },
      data: { status: "CHANGES_REQUESTED", notes: reason },
    });
    await tx.productionJob.update({
      where: { id: jobId },
      data: { status: "DESIGN_PREPARATION" },
    });
    await tx.productionStatusHistory.create({
      data: {
        productionJobId: jobId,
        fromStatus: "AWAITING_CUSTOMER_APPROVAL",
        toStatus: "DESIGN_PREPARATION",
        changedByUserId: actorUserId,
        note: reason,
      },
    });
    await tx.orderItem.updateMany({
      where: { productionJobs: { some: { id: jobId } } },
      data: { productionStatus: "DESIGN_PREPARATION" },
    });

    return { id: jobId };
  });
}

// ---------------------------------------------------------------------------
// Materials and completion
// ---------------------------------------------------------------------------

/** The posted work-in-progress balance for one job. */
export async function productionWipValue(
  jobId: string,
  outer?: Prisma.TransactionClient,
): Promise<Prisma.Decimal> {
  const client = outer ?? prisma;
  const rows = await client.$queryRaw<Array<{ debit: string; credit: string }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(l."debit"), 0)::text AS "debit",
      COALESCE(SUM(l."credit"), 0)::text AS "credit"
    FROM "journal_entry_lines" l
    JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."status" = 'POSTED'
      AND a."code" = ${ACCOUNTS.wip}
      AND e."referenceType" = 'production_job'
      AND e."referenceId" = ${jobId}
  `);
  return money(money(rows[0]?.debit ?? 0).sub(money(rows[0]?.credit ?? 0)));
}

/**
 * Issue every outstanding component at AVCO and move the value from inventory
 * into work in progress. Safe to call twice: only the remainder is issued.
 */
export async function issueComponents(
  jobId: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        warehouseId: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantityRequired: true,
            quantityIssued: true,
            quantityConsumed: true,
            variant: { select: { sku: true } },
          },
        },
      },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");
    if (!["APPROVED", "PRODUCTION"].includes(job.status)) {
      throw new ProductionError("Approve the design before issuing components.");
    }

    let total = money(0);
    for (const item of job.items) {
      const remaining = item.quantityRequired.sub(item.quantityIssued);
      if (!remaining.greaterThan(0)) continue;

      const movement = await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId: job.warehouseId,
        movementType: "PRODUCTION_ISSUE",
        quantity: remaining,
        referenceType: "production_job",
        referenceId: job.id,
        note: `${job.jobNumber} · ${item.variant.sku}`,
        actorUserId,
      });

      await tx.productionJobItem.update({
        where: { id: item.id },
        data: {
          quantityIssued: item.quantityIssued.add(remaining),
          quantityConsumed: item.quantityConsumed.add(remaining),
          unitCost: movement.ledgerUnitCost,
        },
      });
      total = total.add(movement.ledgerValue.neg());
    }

    total = money(total);
    if (!total.greaterThan(0)) {
      return { issued: money(0), journalEntryId: null };
    }

    const journal = await postJournal(tx, {
      description: `${job.jobNumber} · components issued`,
      source: "PRODUCTION",
      referenceType: "production_job",
      referenceId: job.id,
      actorUserId,
      lines: [
        { account: ACCOUNTS.wip, debit: total },
        { account: ACCOUNTS.inventory, credit: total },
      ],
    });

    return { issued: total, journalEntryId: journal?.id ?? null };
  });
}

export async function transitionProduction(
  jobId: string,
  to: ProductionStatus,
  actorUserId: string,
  note?: string | null,
  outer?: Prisma.TransactionClient,
) {
  return run(outer, async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        orderItemId: true,
        warehouseId: true,
        startedAt: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantityRequired: true,
            quantityIssued: true,
            unitCost: true,
            variant: { select: { sku: true } },
          },
        },
      },
    });
    if (!job) throw new ProductionError("That production job no longer exists.");

    const allowed = PRODUCTION_TRANSITIONS[job.status];
    if (!allowed.includes(to)) {
      throw new ProductionError(
        `${PRODUCTION_STATUS_LABELS[job.status]} cannot move to ${PRODUCTION_STATUS_LABELS[to]}.`,
      );
    }

    if (to === "PRODUCTION") {
      const outstanding = job.items.find((item) =>
        item.quantityIssued.lessThan(item.quantityRequired),
      );
      if (outstanding) {
        throw new ProductionError(
          `Issue all components first: ${outstanding.variant.sku} still has ${outstanding.quantityRequired
            .sub(outstanding.quantityIssued)
            .toFixed(3)} to issue.`,
        );
      }
    }

    let journalEntryId: string | null = null;

    if (to === "COMPLETED") {
      const wip = await productionWipValue(job.id, tx);
      if (wip.greaterThan(0)) {
        const journal = await postJournal(tx, {
          description: `${job.jobNumber} · production complete`,
          source: "PRODUCTION",
          referenceType: "production_job",
          referenceId: job.id,
          actorUserId,
          lines: [
            { account: ACCOUNTS.cogs, debit: wip },
            { account: ACCOUNTS.wip, credit: wip },
          ],
        });
        journalEntryId = journal?.id ?? null;
      }
    }

    if (to === "CANCELLED") {
      let returned = money(0);
      for (const item of job.items) {
        if (!item.quantityIssued.greaterThan(0)) continue;
        const movement = await postStockMovement(tx, {
          variantId: item.variantId,
          warehouseId: job.warehouseId,
          movementType: "PRODUCTION_RETURN",
          quantity: item.quantityIssued,
          unitCost: item.unitCost ?? undefined,
          referenceType: "production_job",
          referenceId: job.id,
          note: `${job.jobNumber} · cancelled, ${item.variant.sku} returned`,
          actorUserId,
        });
        returned = returned.add(movement.ledgerValue);
      }

      returned = money(returned);
      if (returned.greaterThan(0)) {
        const journal = await postJournal(tx, {
          description: `${job.jobNumber} · cancelled, materials returned`,
          source: "PRODUCTION",
          referenceType: "production_job",
          referenceId: job.id,
          actorUserId,
          lines: [
            { account: ACCOUNTS.inventory, debit: returned },
            { account: ACCOUNTS.wip, credit: returned },
          ],
        });
        journalEntryId = journal?.id ?? null;
      }
    }

    const now = new Date();
    await tx.productionJob.update({
      where: { id: job.id },
      data: {
        status: to,
        ...(to === "PRODUCTION" && !job.startedAt ? { startedAt: now } : {}),
        ...(to === "COMPLETED" ? { completedAt: now } : {}),
      },
    });
    await tx.orderItem.update({
      where: { id: job.orderItemId },
      data: { productionStatus: to },
    });
    await tx.productionStatusHistory.create({
      data: {
        productionJobId: job.id,
        fromStatus: job.status,
        toStatus: to,
        changedByUserId: actorUserId,
        note: text(note) ?? null,
      },
    });

    return { id: job.id, status: to, journalEntryId };
  });
}

/** Order lines that can still take a production job. */
export async function producibleOrderItems() {
  return prisma.orderItem.findMany({
    where: {
      order: { status: { in: [...ORDER_STATUSES] } },
      fulfillmentType: { not: "DROPSHIP" },
      variantId: { not: null },
      productionJobs: { none: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
    },
    orderBy: { order: { placedAt: "desc" } },
    take: 50,
    select: {
      id: true,
      quantity: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      productionRequired: true,
      customizationRequired: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          placedAt: true,
          recipientName: true,
        },
      },
    },
  });
}
