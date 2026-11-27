import {
  Prisma,
  type FulfillmentType,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifyPin } from "@/lib/password";
import { ACCOUNTS, paymentAccountCode, postJournal, reverseJournalsForReference } from "@/lib/accounting/journal";
import { tryNormalizeBdMobile } from "@/lib/crm/phone";
import { money, qty, type Numeric } from "@/lib/inventory/decimal";
import { documentNumber, InventoryError, postStockMovement } from "@/lib/inventory/stock";
import {
  accrueForOrder,
  LoyaltyError,
  quoteRedemption,
  redeemForOrder,
  reverseEarnedForRefund,
  reverseLoyaltyForCancellation,
} from "@/lib/loyalty/service";
import { createDropshipOrdersForOrder } from "@/lib/dropship/create";
import {
  queueOrderNotification,
  queueRefundNotification,
  recordOrderConsent,
} from "@/lib/whatsapp/service";
import { computeSaleTotals, exceedsCashierCap, TotalsError } from "./totals";

/**
 * Orders, payments, refunds and POS shifts.
 *
 * The service owns every rule that moves money or stock. Server actions only
 * validate and authorise; tests and verification scripts call this module
 * directly so the same SQL, row locks and constraints are exercised.
 *
 * Principles:
 *  - prices, VAT and totals are recomputed from the catalogue, never trusted
 *    from the browser;
 *  - an offline sale is queued and accepted even when stock is short;
 *  - cash is verifiable at the drawer, digital money waits in
 *    `PENDING_VERIFICATION`;
 *  - stock leaves the ledger exactly once, when the sale is created;
 *  - documents and ledger rows are never edited, only superseded.
 */
export class OrdersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrdersError";
  }
}

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

function explain(error: unknown): never {
  if (error instanceof OrdersError) throw error;
  if (error instanceof InventoryError) throw new OrdersError(error.message);
  if (error instanceof TotalsError) throw new OrdersError(error.message);
  if (error instanceof LoyaltyError) throw new OrdersError(error.message);
  throw error;
}

const WALK_IN_MOBILE = "+8800000000000";

const PROVIDER_FOR_METHOD: Record<PaymentMethod, PaymentProvider> = {
  CASH: "CASH",
  BKASH: "BKASH",
  NAGAD: "NAGAD",
  CARD: "MANUAL",
  BANK_TRANSFER: "BANK",
  COD: "COURIER_COD",
  CHEQUE: "MANUAL",
  GATEWAY: "SSLCOMMERZ",
};

export const DIGITAL_METHODS: PaymentMethod[] = [
  "BKASH",
  "NAGAD",
  "CARD",
  "BANK_TRANSFER",
  "GATEWAY",
];

export type SaleLineInput = { variantId: string; quantity: Numeric };

export type SalePaymentInput = {
  method: PaymentMethod;
  /**
   * Omitted by the online checkout: the server fills in the payable amount so
   * a tampered form can never under- or over-pay the order.
   */
  amount?: Numeric;
  /** bKash/Nagad transaction id or card slip number. */
  reference?: string | null;
};

export type SaleCouponInput = {
  id: string;
  code: string;
  /** Discount in taka, already capped and rounded by the coupon service. */
  discount: Numeric;
};

export type CreateSaleInput = {
  source: Extract<OrderSource, "POS_ONLINE" | "POS_OFFLINE" | "ADMIN" | "WEB">;
  deviceId?: string | null;
  /** Online orders ship from this warehouse; POS derives it from the device. */
  warehouseId?: string | null;
  shiftId?: string | null;
  customerMobile?: string | null;
  customerName?: string | null;
  recipientName?: string | null;
  recipientMobile?: string | null;
  shippingAddress?: Prisma.InputJsonValue | null;
  lines: SaleLineInput[];
  discountTotal?: Numeric;
  deliveryCharge?: Numeric;
  deliveryZoneId?: string | null;
  coupon?: SaleCouponInput | null;
  /** Points the customer wants to spend; ignored on an offline sale. */
  loyaltyRedeemPoints?: Numeric | number | null;
  payments: SalePaymentInput[];
  /** Required for a walk-in cash sale and for a discount above 5 %. */
  managerPin?: string | null;
  note?: string | null;
  clientTransactionUuid?: string | null;
  offlineCreatedAt?: Date | null;
  actorUserId: string;
};

export type SaleResult = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  grandTotal: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  dueAmount: Prisma.Decimal;
  duplicate: boolean;
  /**
   * True when an offline sale needed a manager PIN but could not present one.
   * The sale is still accepted — an offline sale is never rejected — and the
   * caller records an audit entry so a manager can review it afterwards.
   */
  approvalDeferred: boolean;
};

/**
 * A manager PIN is accepted from any active user who holds the required
 * permission. The PIN never travels beyond this function and is never logged.
 */
async function requireManagerApproval(
  tx: Prisma.TransactionClient,
  pin: string | null | undefined,
  permission: string,
  reason: string,
): Promise<string> {
  if (!pin?.trim()) {
    throw new OrdersError(`A manager PIN is required to ${reason}.`);
  }

  const candidates = await tx.user.findMany({
    where: { status: "ACTIVE", deletedAt: null, managerPinHash: { not: null } },
    select: {
      id: true,
      managerPinHash: true,
      userRoles: {
        select: {
          role: {
            select: {
              permissions: { select: { permission: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  for (const candidate of candidates) {
    const allowed = candidate.userRoles.some((userRole) =>
      userRole.role.permissions.some((grant) => grant.permission.code === permission),
    );
    if (!allowed || !candidate.managerPinHash) continue;
    if (await verifyPin(pin.trim(), candidate.managerPinHash)) return candidate.id;
  }

  throw new OrdersError("That manager PIN is not valid.");
}

async function resolveCustomer(
  tx: Prisma.TransactionClient,
  input: CreateSaleInput,
): Promise<{ id: string; mobile: string; name: string; walkIn: boolean }> {
  const raw = input.customerMobile?.trim() ?? "";
  if (raw) {
    const normalized = tryNormalizeBdMobile(raw);
    if (!normalized) throw new OrdersError("Enter a valid Bangladeshi mobile number.");
    const existing = await tx.customer.findUnique({
      where: { mobileNormalized: normalized },
      select: { id: true, fullName: true, mobileNormalized: true },
    });
    if (existing) {
      return {
        id: existing.id,
        mobile: existing.mobileNormalized,
        name: existing.fullName,
        walkIn: false,
      };
    }
    const name = input.customerName?.trim() || input.recipientName?.trim() || "Counter customer";
    const created = await tx.customer.create({
      data: {
        mobileNormalized: normalized,
        mobileRaw: raw,
        fullName: name,
        customerType: "RETAIL",
      },
      select: { id: true, mobileNormalized: true, fullName: true },
    });
    return { id: created.id, mobile: created.mobileNormalized, name: created.fullName, walkIn: false };
  }

  const walkIn = await tx.customer.findUnique({
    where: { mobileNormalized: WALK_IN_MOBILE },
    select: { id: true, fullName: true, mobileNormalized: true },
  });
  if (!walkIn) throw new OrdersError("The walk-in customer profile is missing. Run the seed.");
  return { id: walkIn.id, mobile: walkIn.mobileNormalized, name: walkIn.fullName, walkIn: true };
}

type VariantForSale = {
  id: string;
  sku: string;
  name: string;
  price: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  dropshipCost: Prisma.Decimal | null;
  fulfillmentType: FulfillmentType;
  status: string;
  dropshipSupplierId: string | null;
  productId: string;
  productName: string;
  productStatus: string;
  vatPercentage: Prisma.Decimal;
};

async function loadVariants(
  tx: Prisma.TransactionClient,
  lines: SaleLineInput[],
): Promise<Map<string, VariantForSale>> {
  const merged = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const quantity = qty(line.quantity);
    if (!quantity.greaterThan(0)) throw new OrdersError("Every quantity must be greater than zero.");
    merged.set(line.variantId, (merged.get(line.variantId) ?? money(0)).add(quantity));
  }
  if (merged.size === 0) throw new OrdersError("Add at least one item to the sale.");

  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...merged.keys()] } },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      costPrice: true,
      dropshipCost: true,
      fulfillmentType: true,
      status: true,
      dropshipSupplierId: true,
      productId: true,
      product: {
        select: {
          name: true,
          status: true,
          category: { select: { vatPercentage: true } },
        },
      },
    },
  });

  const byId = new Map<string, VariantForSale>();
  for (const variant of variants) {
    if (variant.status !== "ACTIVE" || variant.product.status !== "ACTIVE") {
      throw new OrdersError(`“${variant.sku}” is not on sale any more.`);
    }
    byId.set(variant.id, {
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      price: variant.price,
      costPrice: variant.costPrice,
      dropshipCost: variant.dropshipCost,
      fulfillmentType: variant.fulfillmentType,
      status: variant.status,
      dropshipSupplierId: variant.dropshipSupplierId,
      productId: variant.productId,
      productName: variant.product.name,
      productStatus: variant.product.status,
      vatPercentage: variant.product.category.vatPercentage,
    });
  }
  if (byId.size !== merged.size) throw new OrdersError("One of the items no longer exists.");
  return byId;
}

export async function createSale(
  input: CreateSaleInput,
  outer?: Prisma.TransactionClient,
): Promise<SaleResult> {
  try {
    const result = await run(outer, async (tx) => {
      if (input.clientTransactionUuid) {
        const existing = await tx.order.findUnique({
          where: { clientTransactionUuid: input.clientTransactionUuid },
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            grandTotal: true,
            paidAmount: true,
            dueAmount: true,
          },
        });
        if (existing) {
          return {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            customerId: existing.customerId,
            grandTotal: existing.grandTotal,
            paidAmount: existing.paidAmount,
            dueAmount: existing.dueAmount,
            duplicate: true,
            approvalDeferred: false,
          };
        }
      }

      const device = input.deviceId
        ? await tx.posDevice.findUnique({
            where: { id: input.deviceId },
            select: {
              id: true,
              status: true,
              storeId: true,
              warehouseId: true,
            },
          })
        : null;
      if (input.deviceId && !device) throw new OrdersError("That POS device is not registered.");
      if (device && device.status !== "ACTIVE") throw new OrdersError("That POS device is inactive.");

      if (input.shiftId) {
        const shift = await tx.posShift.findUnique({
          where: { id: input.shiftId },
          select: { id: true, status: true, deviceId: true, cashierUserId: true },
        });
        if (!shift) throw new OrdersError("That shift no longer exists.");
        if (shift.status !== "OPEN") throw new OrdersError("That shift is closed.");
        if (device && shift.deviceId !== device.id) {
          throw new OrdersError("That shift belongs to another device.");
        }
      }

      const customer = await resolveCustomer(tx, input);
      const variants = await loadVariants(tx, input.lines);

      const mergedLines = new Map<string, Prisma.Decimal>();
      for (const line of input.lines) {
        mergedLines.set(
          line.variantId,
          (mergedLines.get(line.variantId) ?? money(0)).add(qty(line.quantity)),
        );
      }

      // A coupon is a second discount. Both are allocated across the line
      // totals so refunds stay proportional; the order keeps them separate so
      // coupon reporting and the `chk_order_totals` identity both hold.
      const manualDiscount = money(input.discountTotal ?? 0);
      const couponDiscount = money(input.coupon?.discount ?? 0);
      if (couponDiscount.lessThan(0)) throw new OrdersError("A coupon discount cannot be negative.");
      const combinedDiscount = money(manualDiscount.add(couponDiscount));

      const totals = computeSaleTotals(
        [...mergedLines.entries()].map(([variantId, quantity]) => {
          const variant = variants.get(variantId);
          if (!variant) throw new OrdersError("One of the items no longer exists.");
          return {
            quantity,
            unitPrice: variant.price,
            vatPercentage: variant.vatPercentage,
          };
        }),
        combinedDiscount,
        input.deliveryCharge ?? 0,
      );
      const isPos = input.source === "POS_ONLINE" || input.source === "POS_OFFLINE";

      // A sale made only of dropship lines has nothing to pick or pack: the
      // supplier ships directly, so fulfilment starts in `PENDING_DROPSHIP`.
      const saleVariants = [...variants.values()];
      const hasDropship = saleVariants.some(
        (variant) => variant.fulfillmentType === "DROPSHIP",
      );
      const allDropship =
        saleVariants.length > 0 &&
        saleVariants.every((variant) => variant.fulfillmentType === "DROPSHIP");

      // --- loyalty redemption ---------------------------------------------
      // An offline sale cannot check a live balance, so it never redeems; it
      // still earns when it syncs and is paid. A walk-in has no points to spend.
      const requestedLoyaltyPoints =
        input.source === "POS_OFFLINE" ? 0 : Number(input.loyaltyRedeemPoints ?? 0);
      if (!Number.isInteger(requestedLoyaltyPoints) || requestedLoyaltyPoints < 0) {
        throw new OrdersError("Points to redeem must be a whole number.");
      }
      let loyaltyPoints = 0;
      if (requestedLoyaltyPoints > 0) {
        if (customer.walkIn) {
          throw new OrdersError("A walk-in sale cannot redeem loyalty points.");
        }
        const quote = await quoteRedemption(
          {
            customerId: customer.id,
            requestedPoints: requestedLoyaltyPoints,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
          },
          tx,
        );
        loyaltyPoints = quote.points;
      }
      const loyaltyDiscount = money(loyaltyPoints);
      const payable = money(totals.grandTotal.sub(loyaltyDiscount));
      if (payable.lessThan(0)) throw new OrdersError("The sale total cannot be negative.");

      // --- payments -------------------------------------------------------
      // A fully discounted online order needs no payment at all. Every other
      // sale needs at least one tender.
      const noPaymentNeeded = input.source === "WEB" && payable.isZero();
      if (input.payments.length === 0 && !noPaymentNeeded) {
        throw new OrdersError("Add at least one payment.");
      }
      const paymentRows = input.payments.map((payment) => {
        const amount = money(payment.amount ?? payable);
        if (!amount.greaterThan(0)) throw new OrdersError("A payment must be greater than zero.");
        return { ...payment, amount };
      });
      const tendered = paymentRows.reduce((sum, payment) => sum.add(payment.amount), money(0));
      if (tendered.greaterThan(payable)) {
        throw new OrdersError("Payments cannot be more than the sale total.");
      }

      // The cashier cap is a counter control. An online customer has no
      // cashier to approve, and the coupon service has already validated its
      // own limits.
      const needsPin =
        !(input.source === "WEB") && (customer.walkIn || exceedsCashierCap(totals));
      const offline = input.source === "POS_OFFLINE";
      let approverId: string | null = null;
      let approvalDeferred = false;
      if (needsPin) {
        if (input.managerPin?.trim()) {
          approverId = await requireManagerApproval(
            tx,
            input.managerPin,
            "order.approve",
            customer.walkIn ? "sell to a walk-in customer" : "give a discount above 5 %",
          );
        } else if (offline) {
          // The device already handed over the goods. The control becomes
          // after-the-fact: flag the sale for a manager instead of refusing it.
          approvalDeferred = true;
        } else {
          await requireManagerApproval(
            tx,
            null,
            "order.approve",
            customer.walkIn ? "sell to a walk-in customer" : "give a discount above 5 %",
          );
        }
      }

      if (customer.walkIn) {
        if (paymentRows.some((payment) => payment.method !== "CASH")) {
          throw new OrdersError("A walk-in sale must be paid in cash.");
        }
        if (!tendered.equals(payable)) {
          throw new OrdersError("A walk-in sale must be paid in full.");
        }
      }

      const paidAmount = paymentRows
        .filter((payment) => payment.method === "CASH")
        .reduce((sum, payment) => sum.add(payment.amount), money(0));
      const hasPending = paymentRows.some((payment) => payment.method !== "CASH");
      const paymentStatus: PaymentStatus = hasPending
        ? "PENDING_VERIFICATION"
        : paidAmount.greaterThanOrEqualTo(payable)
          ? "PAID"
          : paidAmount.greaterThan(0)
            ? "PARTIALLY_PAID"
            : "UNPAID";
      const dueAmount = payable.sub(paidAmount);

      const placedAt = input.offlineCreatedAt ?? new Date();
      const orderNumber = documentNumber("SO");
      const stockWarehouseId = device?.warehouseId ?? input.warehouseId ?? null;

      const order = await tx.order.create({
        data: {
          orderNumber,
          channel: isPos ? "POS" : "ONLINE",
          status: "CONFIRMED",
          paymentStatus,
          fulfillmentStatus: isPos
            ? "FULFILLED"
            : allDropship
              ? "PENDING_DROPSHIP"
              : "UNFULFILLED",
          source: input.source,
          customerId: customer.id,
          storeId: device?.storeId ?? null,
          warehouseId: stockWarehouseId,
          posDeviceId: device?.id ?? null,
          posShiftId: input.shiftId ?? null,
          cashierUserId: isPos ? input.actorUserId : null,
          createdByUserId: input.actorUserId,
          couponId: input.coupon?.id ?? null,
          deliveryZoneId: input.deliveryZoneId ?? null,
          clientTransactionUuid: input.clientTransactionUuid ?? null,
          offlineCreatedAt: input.offlineCreatedAt ?? null,
          syncedAt: input.source === "POS_OFFLINE" ? new Date() : null,
          isWalkInCash: customer.walkIn,
          walkInReason: customer.walkIn ? "Walk-in counter sale" : null,
          walkInApprovedByUserId: customer.walkIn ? approverId : null,
          subtotal: totals.subtotal,
          discountTotal: manualDiscount,
          couponDiscount,
          vatTotal: totals.vatTotal,
          deliveryCharge: totals.deliveryCharge,
          loyaltyRedeemedPoints: loyaltyPoints,
          loyaltyDiscount,
          grandTotal: payable,
          paidAmount,
          dueAmount,
          recipientName: input.recipientName?.trim() || customer.name,
          recipientMobile:
            tryNormalizeBdMobile(input.recipientMobile ?? "") ?? customer.mobile,
          shippingAddress: input.shippingAddress ?? undefined,
          customerNote: input.note?.trim() || null,
          internalNote: approvalDeferred
            ? "Offline sale: manager approval deferred to review queue."
            : null,
          hasDropshipItems: hasDropship,
          requiresProduction: false,
          placedAt,
          confirmedAt: new Date(),
        },
        select: { id: true, orderNumber: true },
      });

      // The points leave the customer's balance in the same transaction as the
      // sale that spends them. The sale journal already debits the liability.
      if (loyaltyPoints > 0) {
        await redeemForOrder(tx, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: customer.id,
          points: loyaltyPoints,
          actorUserId: input.actorUserId,
        });
      }

      const orderItems: Array<{
        id: string;
        variantId: string;
        quantity: Prisma.Decimal;
        costPrice: Prisma.Decimal;
        fulfillmentType: FulfillmentType;
      }> = [];

      for (const [index, [variantId]] of [...mergedLines.entries()].entries()) {
        const variant = variants.get(variantId);
        const line = totals.lines[index];
        if (!variant || !line) throw new OrdersError("Could not price every line.");

        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            variantId: variant.id,
            productId: variant.productId,
            dropshipSupplierId: variant.dropshipSupplierId,
            warehouseId: stockWarehouseId,
            productNameSnapshot: variant.productName,
            variantNameSnapshot: variant.name,
            skuSnapshot: variant.sku,
            unitPrice: line.unitPrice,
            costPriceSnapshot: variant.costPrice,
            vatPercentageSnapshot: line.vatPercentage,
            vatAmount: line.vatAmount,
            discountAmount: line.discount,
            lineSubtotal: line.lineSubtotal,
            lineTotal: line.lineTotal,
            quantity: line.quantity,
            fulfillmentType: variant.fulfillmentType,
            productionRequired: false,
          },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            fulfillmentType: true,
          },
        });
        orderItems.push({
          id: item.id,
          variantId: variant.id,
          quantity: line.quantity,
          costPrice: variant.costPrice,
          fulfillmentType: variant.fulfillmentType,
        });
      }

      // Every dropship line becomes a supplier order in the same transaction.
      // The supplier is told what to ship and to whom; the payable is the
      // purchase order, not a stored balance.
      if (hasDropship) {
        await createDropshipOrdersForOrder(tx, order.id);
      }

      // Stock leaves the ledger once, at sale time. An offline sale is never
      // rejected: the device already handed the goods over.
      let cogsTotal = money(0);
      if (stockWarehouseId) {
        for (const item of orderItems) {
          if (item.fulfillmentType !== "STOCKED") continue;
          const movement = await postStockMovement(tx, {
            variantId: item.variantId,
            warehouseId: stockWarehouseId,
            storeId: device?.storeId ?? null,
            movementType: "SALE",
            quantity: item.quantity,
            referenceType: "order",
            referenceId: order.id,
            note: `${order.orderNumber} · ${input.source}`,
            actorUserId: input.actorUserId,
            allowNegative: input.source === "POS_OFFLINE",
          });
          cogsTotal = cogsTotal.add(movement.ledgerValue.abs());
        }
      }

      // One balanced entry carries the whole sale: receivable, discount, cost of
      // goods sold on one side; product sales, VAT, delivery and the inventory
      // credit on the other. Cash received is a second entry, because a digital
      // payment does not exist in the books until a manager verifies it.
      await postJournal(tx, {
        description: `${order.orderNumber} · ${isPos ? "Counter sale" : "Online sale"}`,
        source: isPos ? "POS_SALE" : "ONLINE_SALE",
        referenceType: "order",
        referenceId: order.id,
        actorUserId: input.actorUserId,
        lines: [
          { account: ACCOUNTS.receivable, debit: payable, customerId: customer.id },
          { account: ACCOUNTS.salesDiscounts, debit: totals.discountTotal },
          { account: ACCOUNTS.loyaltyLiability, debit: loyaltyDiscount, customerId: customer.id },
          { account: ACCOUNTS.cogs, debit: cogsTotal },
          { account: ACCOUNTS.sales, credit: totals.subtotal },
          { account: ACCOUNTS.vatPayable, credit: totals.vatTotal },
          { account: ACCOUNTS.deliveryRevenue, credit: totals.deliveryCharge },
          { account: ACCOUNTS.inventory, credit: cogsTotal },
        ],
      });

      for (const payment of paymentRows) {
        const isCash = payment.method === "CASH";
        const created = await tx.payment.create({
          data: {
            paymentNumber: documentNumber("PAY"),
            orderId: order.id,
            customerId: customer.id,
            amount: payment.amount,
            method: payment.method,
            provider: PROVIDER_FOR_METHOD[payment.method],
            status: isCash ? "PAID" : "PENDING_VERIFICATION",
            isOffline: input.source === "POS_OFFLINE",
            offlineCreatedAt: input.source === "POS_OFFLINE" ? placedAt : null,
            verificationMethod: isCash ? "CASH_DRAWER" : null,
            verifiedAt: isCash ? new Date() : null,
            verifiedByUserId: isCash ? input.actorUserId : null,
            paidAt: isCash ? new Date() : null,
            posShiftId: input.shiftId ?? null,
            createdByUserId: input.actorUserId,
            notes: payment.reference?.trim() || null,
          },
          select: { id: true, paymentNumber: true },
        });

        if (isCash) {
          await postJournal(tx, {
            description: `${created.paymentNumber} · cash at the drawer`,
            source: "POS_SALE",
            referenceType: "payment",
            referenceId: created.id,
            actorUserId: input.actorUserId,
            lines: [
              { account: paymentAccountCode("CASH"), debit: payment.amount },
              { account: ACCOUNTS.receivable, credit: payment.amount, customerId: customer.id },
            ],
          });
        }
      }

      await tx.orderStatusHistory.createMany({
        data: [
          {
            orderId: order.id,
            field: "ORDER_STATUS",
            fromValue: "DRAFT",
            toValue: "CONFIRMED",
            note: input.source === "POS_OFFLINE" ? "Offline POS sale synced" : null,
            actorUserId: input.actorUserId,
          },
          {
            orderId: order.id,
            field: "PAYMENT_STATUS",
            fromValue: "UNPAID",
            toValue: paymentStatus,
            note: hasPending ? "Digital payment awaiting verification" : null,
            actorUserId: input.actorUserId,
          },
        ],
      });

      if (!customer.walkIn) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            totalOrders: { increment: 1 },
            lastOrderAt: placedAt,
            lifetimeValue: { increment: payable },
          },
        });

        // Cash paid in full earns immediately; a digital or partly paid sale
        // earns when verification or completion makes it paid.
        await accrueForOrder(tx, { orderId: order.id, actorUserId: input.actorUserId });
      }

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: customer.id,
        grandTotal: payable,
        paidAmount,
        dueAmount,
        duplicate: false,
        approvalDeferred,
      };
    });

    // A completed online sale is the transactional opt-in: the customer just
    // gave a mobile number for order updates. Queueing happens after commit so
    // a template or provider problem can never roll the sale back.
    if (!outer && !result.duplicate && input.source === "WEB") {
      try {
        const customer = await prisma.customer.findUnique({
          where: { id: result.customerId },
          select: { mobileNormalized: true },
        });
        if (customer) {
          await recordOrderConsent(
            result.customerId,
            customer.mobileNormalized,
            "online_checkout",
          );
          await queueOrderNotification({
            event: "ORDER_CONFIRMED",
            orderId: result.orderId,
            actorUserId: input.actorUserId,
          });
        }
      } catch (error) {
        console.error("[whatsapp] order confirmation queue failed", result.orderId, error);
      }
    }
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      input.clientTransactionUuid
    ) {
      const existing = await prisma.order.findUnique({
        where: { clientTransactionUuid: input.clientTransactionUuid },
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          grandTotal: true,
          paidAmount: true,
          dueAmount: true,
        },
      });
      if (existing) {
        return {
          orderId: existing.id,
          orderNumber: existing.orderNumber,
          customerId: existing.customerId,
          grandTotal: existing.grandTotal,
          paidAmount: existing.paidAmount,
          dueAmount: existing.dueAmount,
          duplicate: true,
          approvalDeferred: false,
        };
      }
    }
    explain(error);
  }
}

async function recomputePaymentStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PaymentStatus> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { grandTotal: true, paymentStatus: true },
  });
  const payments = await tx.payment.findMany({
    where: { orderId },
    select: { amount: true, status: true },
  });

  const paid = payments
    .filter((payment) => payment.status === "PAID")
    .reduce((sum, payment) => sum.add(payment.amount), money(0));
  const pending = payments.some((payment) => payment.status === "PENDING_VERIFICATION");
  const next: PaymentStatus = pending
    ? "PENDING_VERIFICATION"
    : paid.greaterThanOrEqualTo(order.grandTotal)
      ? "PAID"
      : paid.greaterThan(0)
        ? "PARTIALLY_PAID"
        : "UNPAID";

  await tx.order.update({
    where: { id: orderId },
    data: {
      paidAmount: paid,
      dueAmount: order.grandTotal.sub(paid),
      paymentStatus: next,
    },
  });

  if (next !== order.paymentStatus) {
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        field: "PAYMENT_STATUS",
        fromValue: order.paymentStatus,
        toValue: next,
      },
    });
  }

  return next;
}

export async function verifyPayment(
  paymentId: string,
  actorUserId: string,
  options?: { reference?: string | null; note?: string | null },
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        method: true,
        paymentNumber: true,
      },
    });
    if (!payment) throw new OrdersError("That payment no longer exists.");
    if (payment.status !== "PENDING_VERIFICATION") {
      throw new OrdersError("Only a payment awaiting verification can be verified.");
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        verifiedAt: new Date(),
        verifiedByUserId: actorUserId,
        verificationMethod: "MANUAL_MANAGER",
        paidAt: new Date(),
        notes: options?.note?.trim() || undefined,
      },
    });

    await tx.paymentVerification.create({
      data: {
        paymentId: payment.id,
        verificationType: "MANUAL_MANAGER",
        status: "VERIFIED",
        providerTxnId: options?.reference?.trim() || null,
        verifiedAmount: payment.amount,
        verifiedByUserId: actorUserId,
        notes: options?.note?.trim() || null,
        verifiedAt: new Date(),
      },
    });

    await tx.paymentAuditLog.create({
      data: {
        paymentId: payment.id,
        action: "payment.verified",
        actorUserId,
        oldStatus: payment.status,
        newStatus: "PAID",
        metadata: { method: payment.method, reference: options?.reference ?? null },
      },
    });

    // The claim becomes money in the books only now, when a manager verifies it.
    await postJournal(tx, {
      description: `${payment.paymentNumber} · ${payment.method.replaceAll("_", " ").toLowerCase()} verified`,
      source: "POS_SALE",
      referenceType: "payment",
      referenceId: payment.id,
      actorUserId,
      lines: [
        { account: paymentAccountCode(payment.method), debit: payment.amount },
        { account: ACCOUNTS.receivable, credit: payment.amount },
      ],
    });

    const status = await recomputePaymentStatus(tx, payment.orderId);
    if (status === "PAID") {
      await accrueForOrder(tx, { orderId: payment.orderId, actorUserId });
    }
  });
}

export async function rejectPayment(
  paymentId: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, orderId: true, status: true },
    });
    if (!payment) throw new OrdersError("That payment no longer exists.");
    if (payment.status !== "PENDING_VERIFICATION") {
      throw new OrdersError("Only a payment awaiting verification can be rejected.");
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", notes: reason.trim() || null },
    });
    await tx.paymentVerification.create({
      data: {
        paymentId: payment.id,
        verificationType: "MANUAL_MANAGER",
        status: "REJECTED",
        verifiedByUserId: actorUserId,
        notes: reason.trim() || null,
        verifiedAt: new Date(),
      },
    });
    await tx.paymentAuditLog.create({
      data: {
        paymentId: payment.id,
        action: "payment.rejected",
        actorUserId,
        oldStatus: payment.status,
        newStatus: "FAILED",
        metadata: { reason: reason.trim() },
      },
    });

    await recomputePaymentStatus(tx, payment.orderId);
  });
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED"],
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "READY_TO_SHIP", "ON_HOLD", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "ON_HOLD", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED", "RETURNED"],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
  REFUNDED: [],
  ON_HOLD: ["CONFIRMED", "CANCELLED"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The statuses a manager may move this order to next. */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from];
}

export async function setOrderStatus(
  orderId: string,
  next: OrderStatus,
  actorUserId: string,
  note?: string | null,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderNumber: true, aiDraft: true },
    });
    if (!order) throw new OrdersError("That order no longer exists.");
    // An AI draft has no stock, payment or journal behind it. Confirming it
    // directly would tell the shop a sale happened when nothing did, so staff
    // must convert it through the sale path (which re-prices and reserves).
    if (order.aiDraft && order.status === "DRAFT" && next === "CONFIRMED") {
      throw new OrdersError(
        "An AI draft cannot be confirmed directly. Convert it to a sale so prices are re-checked and stock is reserved.",
      );
    }
    if (!canTransition(order.status, next)) {
      throw new OrdersError(
        `An order cannot move from ${order.status.replaceAll("_", " ").toLowerCase()} to ${next
          .replaceAll("_", " ")
          .toLowerCase()}.`,
      );
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: next,
        confirmedAt: next === "CONFIRMED" ? new Date() : undefined,
        cancelledAt: next === "CANCELLED" ? new Date() : undefined,
        cancelReason: next === "CANCELLED" ? note?.trim() || null : undefined,
      },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER_STATUS",
        fromValue: order.status,
        toValue: next,
        note: note?.trim() || null,
        actorUserId,
      },
    });

    // Completion earns points even when the customer still owes money, matching
    // the Phase 2 decision that loyalty follows a finished sale.
    if (next === "COMPLETED") {
      await accrueForOrder(tx, { orderId: order.id, actorUserId });
    }
  });

  // Queue after commit. `outer` means a bigger transaction owns the commit;
  // that caller queues once its own work succeeds.
  if (!outer && (next === "CONFIRMED" || next === "SHIPPED")) {
    try {
      await queueOrderNotification({
        event: next === "CONFIRMED" ? "ORDER_CONFIRMED" : "ORDER_SHIPPED",
        orderId,
        actorUserId,
      });
    } catch (error) {
      console.error("[whatsapp] status notification failed", orderId, next, error);
    }
  }
}

export async function cancelOrder(
  orderId: string,
  actorUserId: string,
  reason: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        paymentStatus: true,
        warehouseId: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            costPriceSnapshot: true,
            fulfillmentType: true,
            warehouseId: true,
          },
        },
      },
    });
    if (!order) throw new OrdersError("That order no longer exists.");
    if (!canTransition(order.status, "CANCELLED")) {
      throw new OrdersError("This order can no longer be cancelled.");
    }

    // A draft never reserved stock, took payment or posted a journal. Running
    // the return/reversal path would invent a SALE_RETURN and put stock on the
    // shelf that never left, so cancelling a draft is only a status change.
    if (order.status === "DRAFT") {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: reason.trim() || null,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          field: "ORDER_STATUS",
          fromValue: "DRAFT",
          toValue: "CANCELLED",
          note: reason.trim() || null,
          actorUserId,
        },
      });
      return;
    }

    // A supplier order that already shipped cannot be pulled back. Once the
    // parcel is with the supplier or the customer, the return path decides what
    // happens to the goods and the money.
    const dropshipOrders = await tx.purchaseOrder.findMany({
      where: { orderId: order.id, poType: "DROPSHIP" },
      select: { id: true, poNumber: true, status: true },
    });
    const shippedDropship = dropshipOrders.find(
      (po) => po.status === "SHIPPED" || po.status === "DELIVERED",
    );
    if (shippedDropship) {
      throw new OrdersError(
        `Supplier order ${shippedDropship.poNumber} has already shipped, so this order cannot be cancelled.`,
      );
    }
    await tx.purchaseOrder.updateMany({
      where: {
        orderId: order.id,
        poType: "DROPSHIP",
        status: { in: ["DRAFT", "SENT", "CONFIRMED"] },
      },
      data: {
        status: "CANCELLED",
        cancelReason: reason.trim() || "Order cancelled",
        closedAt: new Date(),
      },
    });

    for (const item of order.items) {
      const warehouseId = item.warehouseId ?? order.warehouseId;
      if (item.fulfillmentType !== "STOCKED" || !item.variantId || !warehouseId) continue;
      await postStockMovement(tx, {
        variantId: item.variantId,
        warehouseId,
        movementType: "SALE_RETURN",
        quantity: item.quantity,
        unitCost: item.costPriceSnapshot,
        referenceType: "order",
        referenceId: order.id,
        note: `${order.orderNumber} cancelled`,
        actorUserId,
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        paymentStatus: order.paymentStatus === "PENDING_VERIFICATION" ? "FAILED" : order.paymentStatus,
        cancelledAt: new Date(),
        cancelReason: reason.trim() || null,
      },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER_STATUS",
        fromValue: order.status,
        toValue: "CANCELLED",
        note: reason.trim() || null,
        actorUserId,
      },
    });

    // A cancelled online order gives its coupon back. The redemption row is
    // removed and the global counter is decremented; the sale reversal below
    // already removes the discount from the books.
    const redemption = await tx.couponRedemption.findFirst({
      where: { orderId: order.id },
      select: { id: true, couponId: true },
    });
    if (redemption) {
      await tx.couponRedemption.delete({ where: { id: redemption.id } });
      await tx.coupon.update({
        where: { id: redemption.couponId },
        data: { usedCount: { decrement: 1 } },
      });
    }

    // A pending digital or COD payment must leave the verification queue when
    // the order is cancelled; it can never become money now.
    await tx.payment.updateMany({
      where: { orderId: order.id, status: "PENDING_VERIFICATION" },
      data: { status: "FAILED" },
    });

    // The points ledger unwinds first: redeemed points go back, earned points
    // are clawed back. Restoring a redemption needs no journal because the
    // cancellation below mirrors the sale entry that carried the liability.
    await reverseLoyaltyForCancellation(tx, {
      orderId: order.id,
      actorUserId,
      reason: reason.trim() || "Order cancelled",
    });

    // Cancelling unwinds the books the same way it unwinds stock: the sale entry
    // is mirrored, and every cash receipt already recognised is mirrored too, so
    // revenue, receivable and the drawer all return to zero.
    await reverseJournalsForReference(
      tx,
      "order",
      order.id,
      actorUserId,
      `Order ${order.orderNumber} cancelled`,
    );
    const paidPayments = await tx.payment.findMany({
      where: { orderId: order.id, status: "PAID" },
      select: { id: true },
    });
    for (const payment of paidPayments) {
      await reverseJournalsForReference(
        tx,
        "payment",
        payment.id,
        actorUserId,
        `Order ${order.orderNumber} cancelled`,
      );
    }
  });
}

export type RefundLineInput = {
  orderItemId: string;
  quantity: Numeric;
  restock?: boolean;
};

export type RequestRefundInput = {
  orderId: string;
  lines: RefundLineInput[];
  reason: string;
  method: PaymentMethod;
  actorUserId: string;
  notes?: string | null;
  paymentId?: string | null;
};

export async function requestRefund(
  input: RequestRefundInput,
  outer?: Prisma.TransactionClient,
): Promise<{ refundId: string; refundNumber: string; totalAmount: Prisma.Decimal }> {
  return run(outer, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        grandTotal: true,
        customerId: true,
        items: {
          select: {
            id: true,
            quantity: true,
            refundedQty: true,
            unitPrice: true,
            vatAmount: true,
            lineSubtotal: true,
            lineTotal: true,
            costPriceSnapshot: true,
            variantId: true,
            fulfillmentType: true,
            warehouseId: true,
          },
        },
      },
    });
    if (!order) throw new OrdersError("That order no longer exists.");
    if (!["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"].includes(order.status)) {
      throw new OrdersError("This order cannot be refunded in its current state.");
    }
    if (input.lines.length === 0) throw new OrdersError("Choose at least one item to refund.");

    const itemsById = new Map(order.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const rows: Array<{
      orderItemId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      restock: boolean;
    }> = [];

    for (const line of input.lines) {
      if (seen.has(line.orderItemId)) throw new OrdersError("Each item can only appear once.");
      seen.add(line.orderItemId);
      const item = itemsById.get(line.orderItemId);
      if (!item) throw new OrdersError("That item does not belong to this order.");
      const quantity = qty(line.quantity);
      if (!quantity.greaterThan(0)) throw new OrdersError("A refund quantity must be positive.");
      const remaining = item.quantity.sub(item.refundedQty);
      if (quantity.greaterThan(remaining)) {
        throw new OrdersError("A refund cannot exceed the quantity left on the item.");
      }
      const share = quantity.div(item.quantity);
      rows.push({
        orderItemId: item.id,
        quantity,
        unitPrice: money(item.unitPrice),
        taxAmount: money(item.vatAmount.mul(share)),
        lineTotal: money(item.lineTotal.mul(share)),
        restock: line.restock ?? true,
      });
    }

    const total = rows.reduce((sum, row) => sum.add(row.lineTotal), money(0));
    const tax = rows.reduce((sum, row) => sum.add(row.taxAmount), money(0));
    const subtotal = money(total.sub(tax));

    const fullyCovered = order.items.every((item) => {
      const requested = rows.find((row) => row.orderItemId === item.id);
      const covered = item.refundedQty.add(requested?.quantity ?? money(0));
      return covered.greaterThanOrEqualTo(item.quantity);
    });

    const refund = await tx.refund.create({
      data: {
        refundNumber: documentNumber("REF"),
        orderId: order.id,
        paymentId: input.paymentId ?? null,
        customerId: order.customerId,
        refundType: fullyCovered ? "FULL" : "PARTIAL",
        reason: input.reason.trim(),
        subtotal,
        taxAmount: tax,
        totalAmount: total,
        status: "REQUESTED",
        method: input.method,
        requestedByUserId: input.actorUserId,
        notes: input.notes?.trim() || null,
        items: {
          create: rows.map((row) => ({
            orderItemId: row.orderItemId,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            taxAmount: row.taxAmount,
            lineTotal: row.lineTotal,
            restock: row.restock,
          })),
        },
      },
      select: { id: true, refundNumber: true, totalAmount: true },
    });

    return {
      refundId: refund.id,
      refundNumber: refund.refundNumber,
      totalAmount: refund.totalAmount,
    };
  });
}

export async function approveRefund(
  refundId: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        status: true,
        refundNumber: true,
        orderId: true,
        order: { select: { orderNumber: true, warehouseId: true } },
        items: {
          select: {
            id: true,
            orderItemId: true,
            quantity: true,
            restock: true,
            orderItem: {
              select: {
                variantId: true,
                fulfillmentType: true,
                warehouseId: true,
                costPriceSnapshot: true,
              },
            },
          },
        },
      },
    });
    if (!refund) throw new OrdersError("That refund no longer exists.");
    if (refund.status !== "REQUESTED") {
      throw new OrdersError("Only a requested refund can be approved.");
    }

    let restockValue = money(0);
    for (const item of refund.items) {
      const warehouseId = item.orderItem.warehouseId ?? refund.order.warehouseId;
      if (
        !item.restock ||
        item.orderItem.fulfillmentType !== "STOCKED" ||
        !item.orderItem.variantId ||
        !warehouseId
      ) {
        continue;
      }
      const movement = await postStockMovement(tx, {
        variantId: item.orderItem.variantId,
        warehouseId,
        movementType: "SALE_RETURN",
        quantity: item.quantity,
        unitCost: item.orderItem.costPriceSnapshot,
        referenceType: "refund",
        referenceId: refund.id,
        note: `${refund.refundNumber} from ${refund.order.orderNumber}`,
        actorUserId,
      });
      restockValue = restockValue.add(movement.ledgerValue.abs());
    }

    // Stock is back on the shelf, so its cost returns from COGS to inventory.
    // The customer's money is still with the shop until the payout completes.
    await postJournal(tx, {
      description: `${refund.refundNumber} · stock returned from ${refund.order.orderNumber}`,
      source: "SALE_RETURN",
      referenceType: "refund",
      referenceId: refund.id,
      actorUserId,
      lines: [
        { account: ACCOUNTS.inventory, debit: restockValue },
        { account: ACCOUNTS.cogs, credit: restockValue },
      ],
    });

    for (const item of refund.items) {
      await tx.orderItem.update({
        where: { id: item.orderItemId },
        data: { refundedQty: { increment: item.quantity } },
      });
    }

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: "APPROVED",
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
      },
    });
  });
}

export async function completeRefund(
  refundId: string,
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        status: true,
        refundNumber: true,
        orderId: true,
        customerId: true,
        paymentId: true,
        method: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        order: { select: { grandTotal: true, status: true } },
      },
    });
    if (!refund) throw new OrdersError("That refund no longer exists.");
    if (refund.status !== "APPROVED") {
      throw new OrdersError("Only an approved refund can be completed.");
    }

    const completed = await tx.refund.aggregate({
      where: { orderId: refund.orderId, status: "COMPLETED" },
      _sum: { totalAmount: true },
    });
    const refundedTotal = (completed._sum.totalAmount ?? money(0)).add(refund.totalAmount);
    const full = refundedTotal.greaterThanOrEqualTo(refund.order.grandTotal);

    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Money leaves the drawer: sales return and VAT payable are reduced, and the
    // cash or digital account is credited by exactly what the customer received.
    await postJournal(tx, {
      description: `${refund.refundNumber} · refund paid to customer`,
      source: "REFUND",
      referenceType: "refund",
      referenceId: refund.id,
      actorUserId,
      lines: [
        { account: ACCOUNTS.salesReturns, debit: refund.subtotal, customerId: refund.customerId },
        { account: ACCOUNTS.vatPayable, debit: refund.taxAmount },
        {
          account: paymentAccountCode(refund.method),
          credit: refund.totalAmount,
          customerId: refund.customerId,
        },
      ],
    });

    // Points earned on the refunded part go back to the liability. The amount is
    // capped by the points still in the customer's balance, so a spent point is
    // never turned into a negative balance.
    await reverseEarnedForRefund(tx, {
      orderId: refund.orderId,
      refundId: refund.id,
      refundAmount: refund.totalAmount,
      orderTotal: refund.order.grandTotal,
      isFull: full,
      actorUserId,
    });

    if (refund.paymentId) {
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
    }

    if (refund.order.status !== "CANCELLED") {
      await tx.order.update({
        where: { id: refund.orderId },
        data: {
          paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
          status: full ? "REFUNDED" : undefined,
        },
      });
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: refund.orderId,
        field: "PAYMENT_STATUS",
        fromValue: null,
        toValue: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
        note: `Refund completed by ${actorUserId}`,
        actorUserId,
      },
    });

    await tx.customer.update({
      where: { id: refund.customerId },
      data: { totalReturns: { increment: 1 } },
    });
  });

  if (!outer) {
    try {
      await queueRefundNotification({ refundId, actorUserId });
    } catch (error) {
      console.error("[whatsapp] refund notification failed", refundId, error);
    }
  }
}

// ---------------------------------------------------------------------------
// POS devices and shifts
// ---------------------------------------------------------------------------

export async function registerPosDevice(
  input: {
    code: string;
    name: string;
    storeId: string;
    warehouseId: string;
    deviceFingerprint: string;
    platform?: string | null;
  },
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<{ id: string; code: string }> {
  return run(outer, async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
    if (!store) throw new OrdersError("Choose a store for the device.");
    const warehouse = await tx.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, isActive: true },
    });
    if (!warehouse || !warehouse.isActive) throw new OrdersError("Choose an active warehouse.");

    const device = await tx.posDevice.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        storeId: input.storeId,
        warehouseId: input.warehouseId,
        deviceFingerprint: input.deviceFingerprint.trim(),
        platform: input.platform?.trim() || null,
        registeredByUserId: actorUserId,
      },
      select: { id: true, code: true },
    });
    return device;
  });
}

export async function openShift(
  input: {
    deviceId: string;
    openingFloat: Numeric;
    notes?: string | null;
  },
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<{ id: string; shiftNumber: string }> {
  return run(outer, async (tx) => {
    const device = await tx.posDevice.findUnique({
      where: { id: input.deviceId },
      select: { id: true, storeId: true, status: true },
    });
    if (!device) throw new OrdersError("That POS device is not registered.");
    if (device.status !== "ACTIVE") throw new OrdersError("That POS device is inactive.");

    const open = await tx.posShift.findFirst({
      where: { deviceId: device.id, status: "OPEN" },
      select: { id: true },
    });
    if (open) throw new OrdersError("This device already has an open shift.");

    const openingFloat = money(input.openingFloat);
    if (openingFloat.lessThan(0)) throw new OrdersError("The opening float cannot be negative.");

    const shift = await tx.posShift.create({
      data: {
        shiftNumber: documentNumber("SHIFT"),
        deviceId: device.id,
        storeId: device.storeId,
        cashierUserId: actorUserId,
        status: "OPEN",
        openingFloat,
        notes: input.notes?.trim() || null,
      },
      select: { id: true, shiftNumber: true },
    });

    await tx.posCashMovement.create({
      data: {
        shiftId: shift.id,
        type: "OPENING_FLOAT",
        amount: openingFloat,
        reason: "Shift opened",
        performedByUserId: actorUserId,
      },
    });

    return shift;
  });
}

export async function recordCashMovement(
  input: {
    shiftId: string;
    type: "CASH_IN" | "CASH_OUT" | "CASH_DROP";
    amount: Numeric;
    reason: string;
  },
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<void> {
  await run(outer, async (tx) => {
    const shift = await tx.posShift.findUnique({
      where: { id: input.shiftId },
      select: { id: true, status: true },
    });
    if (!shift) throw new OrdersError("That shift no longer exists.");
    if (shift.status !== "OPEN") throw new OrdersError("That shift is closed.");

    const amount = money(input.amount);
    if (!amount.greaterThan(0)) throw new OrdersError("Enter an amount greater than zero.");

    await tx.posCashMovement.create({
      data: {
        shiftId: shift.id,
        type: input.type,
        amount,
        reason: input.reason.trim(),
        performedByUserId: actorUserId,
      },
    });
  });
}

export async function closeShift(
  input: { shiftId: string; countedCash: Numeric; notes?: string | null },
  actorUserId: string,
  outer?: Prisma.TransactionClient,
): Promise<{
  expectedCash: Prisma.Decimal;
  countedCash: Prisma.Decimal;
  variance: Prisma.Decimal;
}> {
  return run(outer, async (tx) => {
    const shift = await tx.posShift.findUnique({
      where: { id: input.shiftId },
      select: { id: true, status: true, openingFloat: true, shiftNumber: true },
    });
    if (!shift) throw new OrdersError("That shift no longer exists.");
    if (shift.status !== "OPEN") throw new OrdersError("That shift is already closed.");

    const counted = money(input.countedCash);
    if (counted.lessThan(0)) throw new OrdersError("The counted cash cannot be negative.");

    const payments = await tx.payment.findMany({
      where: { posShiftId: shift.id, method: "CASH", status: "PAID" },
      select: { amount: true },
    });
    const cashSales = payments.reduce((sum, payment) => sum.add(payment.amount), money(0));

    const movements = await tx.posCashMovement.findMany({
      where: { shiftId: shift.id, type: { in: ["CASH_IN", "CASH_OUT", "CASH_DROP"] } },
      select: { type: true, amount: true },
    });
    const movementTotal = movements.reduce((sum, movement) => {
      const signed =
        movement.type === "CASH_IN" ? movement.amount : movement.amount.neg();
      return sum.add(signed);
    }, money(0));

    const expected = money(shift.openingFloat.add(cashSales).add(movementTotal));
    const variance = money(counted.sub(expected));

    await tx.posShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingCounted: counted,
        expectedCash: expected,
        cashVariance: variance,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.posCashMovement.create({
      data: {
        shiftId: shift.id,
        type: "CLOSING_COUNT",
        amount: counted,
        reason: input.notes?.trim() || "Shift closed",
        performedByUserId: actorUserId,
      },
    });

    return { expectedCash: expected, countedCash: counted, variance };
  });
}
