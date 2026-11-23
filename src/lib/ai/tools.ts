import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { money, qty } from "@/lib/inventory/decimal";
import { documentNumber } from "@/lib/inventory/stock";
import { computeSaleTotals } from "@/lib/orders/totals";
import { createSale, type SalePaymentInput } from "@/lib/orders/service";
import { aiSettings } from "./config";
import { maskMobile, writeActionLog } from "./audit";
import type { AiToolDefinition } from "@/lib/adapters/ai/types";

/**
 * Server-side assistant tools.
 *
 * This file is the whole capability surface. The model cannot run SQL, call an
 * internal URL or choose a price: it can only ask for one of these functions,
 * each with a Zod schema and a server-side permission check. Prices, VAT, stock
 * and delivery fees always come from the database. Draft creation writes one
 * DRAFT order with `aiDraft = true`; it never reserves stock, creates a payment,
 * posts a journal, earns loyalty or raises a dropship purchase order.
 */

export class AiToolError extends Error {
  constructor(
    message: string,
    readonly blocked = false,
  ) {
    super(message);
    this.name = "AiToolError";
  }
}

export type ToolContext = {
  actorUserId: string;
  permissions: ReadonlySet<string>;
  conversationLogId?: string | null;
  tx?: Prisma.TransactionClient;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  status: "SUCCESS" | "ERROR" | "BLOCKED";
  relatedOrderId?: string | null;
};

type ToolDefinition = AiToolDefinition & {
  risk: "READ" | "DRAFT";
  permission?: string;
  draftOnly?: boolean;
  schema: z.ZodType;
};

const searchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

const orderSchema = z.object({
  orderNumber: z.string().trim().min(4).max(60),
});

const deliverySchema = z.object({
  query: z.string().trim().max(200).optional(),
  district: z.string().trim().max(80).optional(),
  zone: z.string().trim().max(80).optional(),
  subtotal: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
});

const draftItemSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().positive().max(999),
});

const draftSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerMobile: z.string().trim().min(6).max(30),
  items: z.array(draftItemSchema).min(1).max(20),
  deliveryZoneId: z.string().trim().max(60).optional(),
  zone: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  note: z.string().trim().max(300).optional(),
});

const DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_products",
    description:
      "Search published products by name, Bangla name or SKU. Returns live prices, VAT rate, stock at the default warehouse and the fulfilment type. Use this before quoting any price or stock.",
    risk: "READ",
    permission: "product.read",
    schema: searchSchema,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, word or SKU." },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_order_status",
    description:
      "Look up one order by its order number. Returns status, payment status, total, items, masked customer mobile and tracking numbers. Never guesses an order number.",
    risk: "READ",
    permission: "order.read",
    schema: orderSchema,
    parameters: {
      type: "object",
      properties: {
        orderNumber: { type: "string", description: "Exact order number, e.g. SO-20261122-A1B2C3." },
      },
      required: ["orderNumber"],
      additionalProperties: false,
    },
  },
  {
    name: "quote_delivery",
    description:
      "Quote active delivery zones and charges. Pass a district/zone name or a search phrase. If the order value is known, pass subtotal so a free-shipping threshold is applied.",
    risk: "READ",
    schema: deliverySchema,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text such as 'delivery to Dhaka'." },
        district: { type: "string" },
        zone: { type: "string" },
        subtotal: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_draft_order",
    description:
      "Create a DRAFT order only. Requires customer name, mobile, SKUs with quantities and a delivery zone. It reserves no stock, takes no payment and posts no journal. Never use it unless the user explicitly asked for a draft.",
    risk: "DRAFT",
    permission: "ai.write",
    draftOnly: true,
    schema: draftSchema,
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        customerMobile: { type: "string", description: "Bangladeshi mobile, e.g. 01712345678." },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              quantity: { type: "number", minimum: 0.001 },
            },
            required: ["sku", "quantity"],
            additionalProperties: false,
          },
        },
        deliveryZoneId: { type: "string" },
        zone: { type: "string", description: "Zone or district name when the id is unknown." },
        district: { type: "string" },
        address: { type: "string" },
        note: { type: "string" },
      },
      required: ["customerName", "customerMobile", "items"],
      additionalProperties: false,
    },
  },
];

export function availableTools(settings = aiSettings()): AiToolDefinition[] {
  return DEFINITIONS.filter(
    (tool) => !tool.draftOnly || settings.draftOrdersEnabled,
  ).map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export function toolDefinitions(): ToolDefinition[] {
  return DEFINITIONS;
}

function has(ctx: ToolContext, permission: string | undefined): boolean {
  return !permission || ctx.permissions.has(permission);
}

async function defaultWarehouse(tx: Prisma.TransactionClient) {
  return tx.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true, code: true },
  });
}

async function searchProducts(
  input: z.infer<typeof searchSchema>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tx = ctx.tx ?? prisma;
  const warehouse = await defaultWarehouse(tx);
  if (!warehouse) {
    throw new AiToolError("No active default warehouse is configured, so stock cannot be quoted.");
  }

  const terms = input.query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);
  const searchTerms = terms.length > 0 ? terms : [input.query];

  const products = await tx.product.findMany({
    where: {
      status: "ACTIVE",
      archivedAt: null,
      isPublished: true,
      OR: searchTerms.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { nameBn: { contains: term, mode: "insensitive" as const } },
        { slug: { contains: term, mode: "insensitive" as const } },
        {
          variants: {
            some: { sku: { contains: term, mode: "insensitive" as const } },
          },
        },
      ]),
    },
    orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
    take: input.limit ?? 5,
    select: {
      id: true,
      slug: true,
      name: true,
      nameBn: true,
      shortDescription: true,
      isPublished: true,
      category: { select: { name: true, nameBn: true, vatPercentage: true } },
      variants: {
        where: { status: "ACTIVE" },
        orderBy: [{ isDefault: "desc" }, { price: "asc" }],
        select: {
          id: true,
          sku: true,
          name: true,
          price: true,
          fulfillmentType: true,
          inventoryBalances: {
            where: { warehouseId: warehouse.id },
            select: { availableQty: true },
          },
        },
      },
    },
  });

  return {
    ok: true,
    status: "SUCCESS",
    data: {
      warehouse: warehouse.code,
      products: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        nameBn: product.nameBn,
        shortDescription: product.shortDescription,
        category: product.category.name,
        vatPercentage: product.category.vatPercentage.toFixed(2),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          price: variant.price.toFixed(2),
          fulfillmentType: variant.fulfillmentType,
          availableQty:
            variant.fulfillmentType === "STOCKED"
              ? Number(variant.inventoryBalances[0]?.availableQty ?? 0)
              : null,
        })),
      })),
    },
  };
}

async function getOrderStatus(
  input: z.infer<typeof orderSchema>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tx = ctx.tx ?? prisma;
  const order = await tx.order.findUnique({
    where: { orderNumber: input.orderNumber.trim().toUpperCase() },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      grandTotal: true,
      placedAt: true,
      recipientName: true,
      recipientMobile: true,
      customer: { select: { fullName: true, mobileNormalized: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          productNameSnapshot: true,
          variantNameSnapshot: true,
          skuSnapshot: true,
          quantity: true,
        },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        select: { status: true, trackingNumber: true, courier: { select: { name: true } } },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { fromValue: true, toValue: true, createdAt: true, note: true },
      },
    },
  });

  if (!order) {
    throw new AiToolError("No order matches that number.");
  }

  return {
    ok: true,
    status: "SUCCESS",
    relatedOrderId: order.id,
    data: {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        grandTotal: order.grandTotal.toFixed(2),
        placedAt: order.placedAt.toISOString(),
        recipientName: order.recipientName,
        mobileMasked: maskMobile(order.customer.mobileNormalized),
        items: order.items.map((item) => ({
          name: [item.productNameSnapshot, item.variantNameSnapshot].filter(Boolean).join(" · "),
          sku: item.skuSnapshot,
          quantity: qty(item.quantity).toFixed(3),
        })),
        shipments: order.shipments.map((shipment) => ({
          status: shipment.status,
          courier: shipment.courier?.name ?? "Manual delivery",
          trackingNumber: shipment.trackingNumber,
        })),
        recentHistory: order.statusHistory.map((entry) => ({
          from: entry.fromValue,
          to: entry.toValue,
          at: entry.createdAt.toISOString(),
          note: entry.note,
        })),
      },
    },
  };
}

async function quoteDelivery(
  input: z.infer<typeof deliverySchema>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tx = ctx.tx ?? prisma;
  const explicit = [input.district, input.zone].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const words = (input.query ?? "")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
    .slice(0, 6);
  const terms = [...explicit, ...words];

  const zones = await tx.deliveryZone.findMany({
    where: {
      isActive: true,
      ...(terms.length > 0
        ? {
            OR: terms.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { division: { contains: term, mode: "insensitive" as const } },
              { district: { contains: term, mode: "insensitive" as const } },
              { upazila: { contains: term, mode: "insensitive" as const } },
            ]),
          }
        : {}),
    },
    orderBy: [{ charge: "asc" }, { name: "asc" }],
    take: 6,
    select: {
      id: true,
      name: true,
      division: true,
      district: true,
      charge: true,
      freeShippingThreshold: true,
      estimatedDaysMin: true,
      estimatedDaysMax: true,
      isDropshipCovered: true,
    },
  });

  return {
    ok: true,
    status: "SUCCESS",
    data: {
      zones: zones.map((zone) => {
        const threshold = zone.freeShippingThreshold;
        const isFree =
          input.subtotal !== undefined &&
          threshold !== null &&
          input.subtotal >= Number(threshold);
        return {
          id: zone.id,
          name: zone.name,
          division: zone.division,
          district: zone.district,
          charge: zone.charge.toFixed(2),
          effectiveCharge: isFree ? "0.00" : zone.charge.toFixed(2),
          isFree,
          freeShippingThreshold: threshold?.toFixed(2) ?? null,
          estimatedDaysMin: zone.estimatedDaysMin,
          estimatedDaysMax: zone.estimatedDaysMax,
          isDropshipCovered: zone.isDropshipCovered,
        };
      }),
    },
  };
}

export type CreateDraftInput = z.infer<typeof draftSchema>;

export type DraftOrderView = {
  id: string;
  orderNumber: string;
  grandTotal: string;
  itemCount: number;
  url: string;
};

function formatDraft(order: {
  id: string;
  orderNumber: string;
  grandTotal: Prisma.Decimal;
  items: unknown[];
}): DraftOrderView {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    grandTotal: order.grandTotal.toFixed(2),
    itemCount: order.items.length,
    url: `/orders/${order.id}`,
  };
}

export async function createAiDraft(
  raw: CreateDraftInput,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<DraftOrderView> {
  const input = draftSchema.parse(raw);
  const mobile = tryNormalizeBdMobile(input.customerMobile);
  if (!mobile) throw new AiToolError("Enter a valid Bangladeshi mobile number.");

  const work = async (tx: Prisma.TransactionClient) => {
    const warehouse = await defaultWarehouse(tx);
    const customer = await tx.customer.findUnique({
      where: { mobileNormalized: mobile },
      select: {
        id: true,
        fullName: true,
        status: true,
        deletedAt: true,
        mobileNormalized: true,
      },
    });
    if (customer && (customer.status === "BLOCKED" || customer.deletedAt)) {
      throw new AiToolError("That customer account is blocked, so a draft cannot be created.");
    }

    const customerRow =
      customer ??
      (await tx.customer.create({
        data: {
          mobileNormalized: mobile,
          mobileRaw: input.customerMobile.trim(),
          fullName: input.customerName.trim(),
          customerType: "RETAIL",
        },
        select: {
          id: true,
          fullName: true,
          status: true,
          deletedAt: true,
          mobileNormalized: true,
        },
      }));

    // Resolve the delivery zone before pricing, because its charge is part of
    // the order total and the DB CHECK verifies the identity.
    const zone = input.deliveryZoneId
      ? await tx.deliveryZone.findFirst({
          where: { id: input.deliveryZoneId, isActive: true },
          select: {
            id: true,
            name: true,
            division: true,
            district: true,
            charge: true,
            freeShippingThreshold: true,
          },
        })
      : await tx.deliveryZone.findFirst({
          where: {
            isActive: true,
            ...(input.zone || input.district
              ? {
                  OR: [
                    ...(input.zone
                      ? [{ name: { contains: input.zone, mode: "insensitive" as const } }]
                      : []),
                    ...(input.district
                      ? [
                          {
                            district: {
                              contains: input.district,
                              mode: "insensitive" as const,
                            },
                          },
                          {
                            division: {
                              contains: input.district,
                              mode: "insensitive" as const,
                            },
                          },
                        ]
                      : []),
                  ],
                }
              : {}),
          },
          orderBy: { charge: "asc" },
          select: {
            id: true,
            name: true,
            division: true,
            district: true,
            charge: true,
            freeShippingThreshold: true,
          },
        });
    if (!zone) {
      throw new AiToolError(
        "Choose an active delivery zone (or a district that has one) before creating a draft.",
      );
    }

    const merged = new Map<string, { variantId: string; quantity: Prisma.Decimal; sku: string }>();
    const variants = new Map<
      string,
      {
        id: string;
        sku: string;
        productId: string;
        name: string;
        price: Prisma.Decimal;
        costPrice: Prisma.Decimal;
        fulfillmentType: "STOCKED" | "DROPSHIP" | "NON_STOCK" | "SERVICE";
        dropshipSupplierId: string | null;
        productName: string;
        vatPercentage: Prisma.Decimal;
      }
    >();

    for (const line of input.items) {
      const sku = line.sku.trim();
      const already = [...variants.values()].find(
        (variant) => variant.sku.toLowerCase() === sku.toLowerCase(),
      );
      let variant = already;
      if (!variant) {
        const loaded = await tx.productVariant.findFirst({
          where: {
            sku: { equals: sku, mode: "insensitive" },
            status: "ACTIVE",
            product: { status: "ACTIVE", archivedAt: null },
          },
          select: {
            id: true,
            sku: true,
            productId: true,
            name: true,
            price: true,
            costPrice: true,
            fulfillmentType: true,
            dropshipSupplierId: true,
            product: {
              select: {
                name: true,
                category: { select: { vatPercentage: true } },
              },
            },
          },
        });
        if (!loaded) throw new AiToolError(`No active product variant matches SKU ${sku}.`);
        variant = {
          id: loaded.id,
          sku: loaded.sku,
          productId: loaded.productId,
          name: loaded.name,
          price: loaded.price,
          costPrice: loaded.costPrice,
          fulfillmentType: loaded.fulfillmentType,
          dropshipSupplierId: loaded.dropshipSupplierId,
          productName: loaded.product.name,
          vatPercentage: loaded.product.category.vatPercentage,
        };
        variants.set(variant.id, variant);
      }

      const quantity = qty(line.quantity);
      const current = merged.get(variant.id);
      merged.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        quantity: current ? current.quantity.add(quantity) : quantity,
      });
    }

    const inputs = [...merged.values()].map((line) => {
      const variant = variants.get(line.variantId);
      if (!variant) throw new AiToolError("One of the items no longer exists.");
      return {
        quantity: line.quantity,
        unitPrice: variant.price,
        vatPercentage: variant.vatPercentage,
      };
    });

    const preliminary = computeSaleTotals(inputs, 0, 0);
    const gross = preliminary.lines.reduce(
      (sum, line) => sum.add(line.gross),
      money(0),
    );
    const freeShipping =
      zone.freeShippingThreshold !== null && gross.greaterThanOrEqualTo(zone.freeShippingThreshold);
    const deliveryCharge = freeShipping ? money(0) : zone.charge;
    const totals = computeSaleTotals(inputs, 0, deliveryCharge);

    const order = await tx.order.create({
      data: {
        orderNumber: documentNumber("SO"),
        channel: "ONLINE",
        status: "DRAFT",
        paymentStatus: "UNPAID",
        fulfillmentStatus: "UNFULFILLED",
        source: "AI_DRAFT",
        customerId: customerRow.id,
        warehouseId: warehouse?.id ?? null,
        deliveryZoneId: zone.id,
        createdByUserId: actorUserId,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        couponDiscount: money(0),
        vatTotal: totals.vatTotal,
        deliveryCharge: totals.deliveryCharge,
        loyaltyRedeemedPoints: 0,
        loyaltyDiscount: money(0),
        grandTotal: totals.grandTotal,
        paidAmount: money(0),
        dueAmount: totals.grandTotal,
        recipientName: input.customerName.trim(),
        recipientMobile: mobile,
        shippingAddress: {
          address: input.address?.trim() || "Address to be confirmed",
          division: zone.division,
          district: zone.district,
          zone: zone.name,
        },
        customerNote: input.note?.trim() || null,
        internalNote:
          "AI draft: no stock reserved, no payment taken, no journal posted. Review and convert to a sale.",
        hasDropshipItems: [...variants.values()].some(
          (variant) => variant.fulfillmentType === "DROPSHIP",
        ),
        requiresProduction: false,
        aiDraft: true,
      },
      select: { id: true, orderNumber: true, grandTotal: true, items: { select: { id: true } } },
    });

    let index = 0;
    for (const line of merged.values()) {
      const variant = variants.get(line.variantId);
      const priced = totals.lines[index];
      if (!variant || !priced) throw new AiToolError("Could not price every line.");
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          productId: variant.productId,
          dropshipSupplierId: variant.dropshipSupplierId,
          warehouseId: variant.fulfillmentType === "STOCKED" ? warehouse?.id ?? null : null,
          productNameSnapshot: variant.productName,
          variantNameSnapshot: variant.name,
          skuSnapshot: variant.sku,
          unitPrice: priced.unitPrice,
          costPriceSnapshot: variant.costPrice,
          vatPercentageSnapshot: priced.vatPercentage,
          vatAmount: priced.vatAmount,
          discountAmount: priced.discount,
          lineSubtotal: priced.lineSubtotal,
          lineTotal: priced.lineTotal,
          quantity: priced.quantity,
          fulfillmentType: variant.fulfillmentType,
          productionRequired: false,
        },
      });
      index += 1;
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER_STATUS",
        fromValue: null,
        toValue: "DRAFT",
        note: "Created by the AI assistant. No stock reserved.",
        actorUserId,
      },
    });

    const created = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        items: { select: { id: true } },
      },
    });
    return formatDraft(created);
  };

  if (outer) return work(outer);
  return prisma.$transaction(work, { timeout: 20_000 });
}

async function createDraft(
  input: z.infer<typeof draftSchema>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const settings = aiSettings();
  if (!settings.draftOrdersEnabled) {
    throw new AiToolError("Draft orders from the assistant are disabled.", true);
  }
  const store = ctx.tx ?? prisma;
  const hourAgo = new Date(Date.now() - 60 * 60 * 1_000);
  const recentDrafts = await store.aiActionLog.count({
    where: {
      actorUserId: ctx.actorUserId,
      toolName: "create_draft_order",
      status: "SUCCESS",
      createdAt: { gte: hourAgo },
    },
  });
  if (recentDrafts >= settings.maxDraftsPerHour) {
    throw new AiToolError("The hourly draft limit has been reached. Try again later.", true);
  }
  const draft = await createAiDraft(input, ctx.actorUserId, ctx.tx);
  return {
    ok: true,
    status: "SUCCESS",
    relatedOrderId: draft.id,
    data: { draft },
  };
}

type Handler = (input: unknown, ctx: ToolContext) => Promise<ToolResult>;

const HANDLERS: Record<string, { definition: ToolDefinition; handler: Handler }> = {
  search_products: {
    definition: DEFINITIONS[0]!,
    handler: (input, ctx) =>
      searchProducts(searchSchema.parse(input), ctx),
  },
  get_order_status: {
    definition: DEFINITIONS[1]!,
    handler: (input, ctx) =>
      getOrderStatus(orderSchema.parse(input), ctx),
  },
  quote_delivery: {
    definition: DEFINITIONS[2]!,
    handler: (input, ctx) =>
      quoteDelivery(deliverySchema.parse(input), ctx),
  },
  create_draft_order: {
    definition: DEFINITIONS[3]!,
    handler: (input, ctx) => createDraft(draftSchema.parse(input), ctx),
  },
};

export function isKnownTool(name: string): boolean {
  return name in HANDLERS;
}

/**
 * Validate, authorise, execute and log exactly one tool call.
 *
 * Logging happens even when the call fails, and a blocked call is recorded as
 * BLOCKED rather than pretending it succeeded. Tool inputs and outputs are
 * masked before they are written to the audit table.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const started = Date.now();
  const definition = HANDLERS[name]?.definition;

  const finish = async (
    result: ToolResult,
    errorMessage?: string,
  ): Promise<ToolResult> => {
    await writeActionLog(
      {
        conversationLogId: ctx.conversationLogId ?? null,
        toolName: name,
        input: rawInput,
        output: result,
        status: result.status,
        riskLevel: definition?.risk ?? "READ",
        relatedOrderId: result.relatedOrderId ?? null,
        actorUserId: ctx.actorUserId,
        durationMs: Date.now() - started,
        errorMessage: errorMessage ? maskMobile(errorMessage) : null,
      },
      ctx.tx,
    );
    return result;
  };

  if (!definition) {
    return finish(
      { ok: false, status: "BLOCKED", error: "That assistant tool is not allowed." },
      "Unknown tool",
    );
  }
  if (!has(ctx, definition.permission)) {
    return finish(
      {
        ok: false,
        status: "BLOCKED",
        error: "You do not have permission to use that assistant tool.",
      },
      "Missing permission",
    );
  }

  try {
    const parsed = definition.schema.parse(rawInput);
    const result = await HANDLERS[name]!.handler(parsed, ctx);
    return finish(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return finish(
        {
          ok: false,
          status: "ERROR",
          error: error.issues[0]?.message ?? "The tool input was invalid.",
        },
        "Invalid tool input",
      );
    }
    const message =
      error instanceof AiToolError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The tool failed.";
    return finish(
      {
        ok: false,
        status: error instanceof AiToolError && error.blocked ? "BLOCKED" : "ERROR",
        error: message,
      },
      message,
    );
  }
}

export type AiDraftPaymentMethod = "COD" | "BKASH" | "NAGAD";

export async function convertAiDraft(
  input: {
    draftOrderId: string;
    paymentMethod: AiDraftPaymentMethod;
    reference?: string | null;
    actorUserId: string;
  },
  outer?: Prisma.TransactionClient,
): Promise<{ orderId: string; orderNumber: string; draftOrderNumber: string }> {
  const work = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${input.draftOrderId} FOR UPDATE`;
    const draft = await tx.order.findUnique({
      where: { id: input.draftOrderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        aiDraft: true,
        warehouseId: true,
        deliveryZoneId: true,
        deliveryCharge: true,
        customerNote: true,
        recipientName: true,
        recipientMobile: true,
        shippingAddress: true,
        customer: { select: { id: true, fullName: true, mobileNormalized: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: { variantId: true, quantity: true },
        },
      },
    });
    if (!draft) throw new AiToolError("That draft order no longer exists.");
    if (!draft.aiDraft) throw new AiToolError("That order was not created by the assistant.");
    if (draft.status !== "DRAFT") {
      throw new AiToolError("Only a draft order can be converted to a sale.");
    }
    const lines = draft.items
      .filter((item): item is typeof item & { variantId: string } => Boolean(item.variantId))
      .map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
    if (lines.length !== draft.items.length || lines.length === 0) {
      throw new AiToolError("A draft line no longer has a live product, so it cannot be sold.");
    }

    const payment: SalePaymentInput = {
      method: input.paymentMethod,
      reference: input.reference?.trim() || null,
    };

    // createSale re-reads every price, reserves stock, posts the journal and
    // creates the pending payment. The draft itself never moved any of those.
    const sale = await createSale(
      {
        source: "ADMIN",
        warehouseId: draft.warehouseId,
        customerMobile: draft.customer.mobileNormalized,
        customerName: draft.customer.fullName,
        recipientName: draft.recipientName,
        recipientMobile: draft.recipientMobile,
        shippingAddress:
          (draft.shippingAddress as Prisma.InputJsonValue | null) ?? null,
        lines,
        deliveryCharge: draft.deliveryCharge,
        deliveryZoneId: draft.deliveryZoneId,
        payments: [payment],
        note: draft.customerNote,
        actorUserId: input.actorUserId,
      },
      tx,
    );

    await tx.order.update({
      where: { id: draft.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: `Converted to sale ${sale.orderNumber}`,
        internalNote: `Converted to sale ${sale.orderNumber}. The draft itself reserved no stock.`,
      },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: draft.id,
        field: "ORDER_STATUS",
        fromValue: "DRAFT",
        toValue: "CANCELLED",
        note: `Converted to sale ${sale.orderNumber}`,
        actorUserId: input.actorUserId,
      },
    });

    return {
      orderId: sale.orderId,
      orderNumber: sale.orderNumber,
      draftOrderNumber: draft.orderNumber,
    };
  };

  if (outer) return work(outer);
  return prisma.$transaction(work, { timeout: 30_000 });
}
