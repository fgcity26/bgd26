import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ACCOUNTS, postJournal } from "@/lib/accounting/journal";
import { money, type Numeric } from "@/lib/inventory/decimal";

/**
 * Loyalty points.
 *
 * One point is worth one taka. A customer earns one point per ৳100 of net
 * merchandise (`subtotal − discountTotal`, i.e. after discount and before VAT)
 * once the sale is paid or completed, and may spend points against at most 20 %
 * of that same net merchandise on a later sale. Points expire twelve months
 * after they are earned.
 *
 * The ledger is append-only: every movement is a `loyalty_transactions` row with
 * the signed points and the balance after it. The balance on `customers` is a
 * cached projection of that ledger, protected by a non-negative CHECK and two
 * partial unique indexes (one EARN and one REDEEM per order).
 *
 * Journals:
 *   earn          DR 5500 Loyalty Expense        CR 1500 Loyalty Points Liability
 *   redeem        included in the sale entry    DR 1500 (receivable is reduced)
 *   expire/reverse DR 1500                        CR 5500
 *   manual +      DR 5500                         CR 1500
 *   manual −      DR 1500                         CR 5500
 *
 * Redeeming points on a cancelled order needs no second journal: cancelling the
 * sale mirrors the whole sale entry, including its loyalty liability debit. Only
 * the points ledger is restored.
 */
export class LoyaltyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoyaltyError";
  }
}

export const LOYALTY = {
  /** Taka of net merchandise that earns one point. */
  takaPerPoint: 100,
  /** Taka of discount one point buys. */
  pointValue: 1,
  /** A redemption may cover at most this share of net merchandise. */
  redemptionCap: 0.2,
  /** Points expire this many months after they are earned. */
  expiryMonths: 12,
} as const;

function run<T>(
  outer: Prisma.TransactionClient | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return outer ? work(outer) : prisma.$transaction(work);
}

/** Net merchandise is the earning and redemption base: after discounts, before VAT. */
export function netMerchandise(
  subtotal: Numeric,
  discountTotal: Numeric,
  couponDiscount: Numeric = 0,
): Prisma.Decimal {
  const net = money(subtotal).sub(money(discountTotal)).sub(money(couponDiscount));
  return net.lessThan(0) ? money(0) : money(net);
}

/** One point per complete ৳100 of net merchandise. */
export function pointsForNet(net: Numeric): number {
  const value = money(net);
  if (value.lessThanOrEqualTo(0)) return 0;
  return Math.floor(value.div(LOYALTY.takaPerPoint).toNumber());
}

/** The most points a single sale may spend. */
export function maxRedeemablePoints(net: Numeric): number {
  const value = money(net);
  if (value.lessThanOrEqualTo(0)) return 0;
  return Math.floor(value.mul(LOYALTY.redemptionCap).toNumber());
}

function integerPoints(value: Numeric | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new LoyaltyError("Points must be a whole number.");
  }
  return parsed;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE
  `;
}

export type RedemptionQuote = {
  points: number;
  discount: Prisma.Decimal;
  balance: number;
  maxPoints: number;
  requested: number;
};

/**
 * Check a requested redemption against the customer's balance and the 20 % cap.
 * The same rule runs in the POS preview and again inside the sale transaction.
 */
export async function quoteRedemption(
  input: {
    customerId: string;
    requestedPoints: Numeric | null | undefined;
    subtotal: Numeric;
    discountTotal: Numeric;
  },
  outer?: Prisma.TransactionClient,
): Promise<RedemptionQuote> {
  const requested = integerPoints(input.requestedPoints);
  if (requested < 0) throw new LoyaltyError("Points to redeem cannot be negative.");

  const client = outer ?? prisma;
  const customer = await client.customer.findUnique({
    where: { id: input.customerId },
    select: {
      loyaltyPointsBalance: true,
      isWalkInCash: true,
      deletedAt: true,
      status: true,
    },
  });
  if (!customer || customer.deletedAt) throw new LoyaltyError("That customer no longer exists.");
  if (customer.isWalkInCash) {
    throw new LoyaltyError("A walk-in sale cannot redeem loyalty points.");
  }
  if (customer.status === "BLOCKED") {
    throw new LoyaltyError("A blocked customer cannot redeem loyalty points.");
  }

  const cap = maxRedeemablePoints(netMerchandise(input.subtotal, input.discountTotal));
  const maxPoints = Math.min(customer.loyaltyPointsBalance, cap);
  if (requested > maxPoints) {
    throw new LoyaltyError(
      maxPoints === 0
        ? "This sale cannot redeem points: the 20 % cap is zero."
        : `You can redeem at most ${maxPoints} points on this sale.`,
    );
  }

  return {
    points: requested,
    discount: money(requested * LOYALTY.pointValue),
    balance: customer.loyaltyPointsBalance,
    maxPoints,
    requested,
  };
}

export type LoyaltyMovement = {
  transactionId: string;
  points: number;
  balanceAfter: number;
};

/**
 * Award the order's points once. Safe to call repeatedly: the order row is
 * locked, the EARN row is checked, and a partial unique index backs that check.
 */
export async function accrueForOrder(
  tx: Prisma.TransactionClient,
  input: { orderId: string; actorUserId: string },
): Promise<LoyaltyMovement | null> {
  await lockOrder(tx, input.orderId);

  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      subtotal: true,
      discountTotal: true,
      couponDiscount: true,
      paymentStatus: true,
      status: true,
      customer: {
        select: { isWalkInCash: true, deletedAt: true, status: true },
      },
    },
  });
  if (!order) throw new LoyaltyError("That order no longer exists.");
  if (order.customer.isWalkInCash || order.customer.deletedAt) return null;
  if (order.customer.status === "BLOCKED") return null;
  if (order.paymentStatus !== "PAID" && order.status !== "COMPLETED") return null;

  const existing = await tx.loyaltyTransaction.findFirst({
    where: { orderId: order.id, type: "EARN" },
    select: { id: true },
  });
  if (existing) return null;

  const points = pointsForNet(
    netMerchandise(order.subtotal, order.discountTotal, order.couponDiscount),
  );
  if (points <= 0) return null;

  const customer = await tx.customer.update({
    where: { id: order.customerId },
    data: { loyaltyPointsBalance: { increment: points } },
    select: { loyaltyPointsBalance: true },
  });

  const txn = await tx.loyaltyTransaction.create({
    data: {
      customerId: order.customerId,
      orderId: order.id,
      type: "EARN",
      points,
      balanceAfter: customer.loyaltyPointsBalance,
      expiresAt: addMonths(new Date(), LOYALTY.expiryMonths),
      referenceType: "order",
      referenceId: order.id,
      note: `Earned on ${order.orderNumber}`,
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  await tx.order.update({
    where: { id: order.id },
    data: { loyaltyEarnedPoints: points },
  });

  await postJournal(tx, {
    description: `${order.orderNumber} · ${points} loyalty point${points === 1 ? "" : "s"} earned`,
    source: "MANUAL",
    referenceType: "loyalty_transaction",
    referenceId: txn.id,
    actorUserId: input.actorUserId,
    lines: [
      { account: ACCOUNTS.loyaltyExpense, debit: points },
      {
        account: ACCOUNTS.loyaltyLiability,
        credit: points,
        customerId: order.customerId,
      },
    ],
  });

  return { transactionId: txn.id, points, balanceAfter: customer.loyaltyPointsBalance };
}

/**
 * Spend points on a sale. The caller has already validated the cap; this
 * function atomically checks the balance and writes the negative ledger row.
 * The sale journal carries the matching DR 1500 line, so no journal is posted
 * here.
 */
export async function redeemForOrder(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    orderNumber: string;
    customerId: string;
    points: number;
    actorUserId: string;
  },
): Promise<LoyaltyMovement | null> {
  if (input.points <= 0) return null;

  const changed = await tx.customer.updateMany({
    where: {
      id: input.customerId,
      isWalkInCash: false,
      deletedAt: null,
      loyaltyPointsBalance: { gte: input.points },
    },
    data: { loyaltyPointsBalance: { decrement: input.points } },
  });
  if (changed.count === 0) {
    throw new LoyaltyError("The customer no longer has enough loyalty points.");
  }

  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: input.customerId },
    select: { loyaltyPointsBalance: true },
  });

  const txn = await tx.loyaltyTransaction.create({
    data: {
      customerId: input.customerId,
      orderId: input.orderId,
      type: "REDEEM",
      points: -input.points,
      balanceAfter: customer.loyaltyPointsBalance,
      referenceType: "order",
      referenceId: input.orderId,
      note: `Redeemed on ${input.orderNumber}`,
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  return {
    transactionId: txn.id,
    points: -input.points,
    balanceAfter: customer.loyaltyPointsBalance,
  };
}

/**
 * Reverse a cancellation: give redeemed points back and claw back earned points.
 *
 * Restoring redeemed points needs no journal because the cancelled sale's entry
 * is mirrored as a whole. Clawing back earned points posts DR 1500 / CR 5500 for
 * exactly the points that are still unspent; the ledger can never go negative.
 */
export async function reverseLoyaltyForCancellation(
  tx: Prisma.TransactionClient,
  input: { orderId: string; actorUserId: string; reason: string },
): Promise<{ restored: number; reversed: number }> {
  await lockOrder(tx, input.orderId);

  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      loyaltyRedeemedPoints: true,
      loyaltyEarnedPoints: true,
      customer: { select: { isWalkInCash: true, deletedAt: true } },
    },
  });
  if (!order) throw new LoyaltyError("That order no longer exists.");
  if (order.customer.isWalkInCash || order.customer.deletedAt) {
    return { restored: 0, reversed: 0 };
  }

  let restored = 0;
  if (order.loyaltyRedeemedPoints > 0) {
    const already = await tx.loyaltyTransaction.findFirst({
      where: {
        orderId: order.id,
        type: "REVERSAL",
        referenceType: "order_cancel_redeem",
        referenceId: order.id,
      },
      select: { id: true },
    });
    if (!already) {
      const customer = await tx.customer.update({
        where: { id: order.customerId },
        data: { loyaltyPointsBalance: { increment: order.loyaltyRedeemedPoints } },
        select: { loyaltyPointsBalance: true },
      });
      await tx.loyaltyTransaction.create({
        data: {
          customerId: order.customerId,
          orderId: order.id,
          type: "REVERSAL",
          points: order.loyaltyRedeemedPoints,
          balanceAfter: customer.loyaltyPointsBalance,
          referenceType: "order_cancel_redeem",
          referenceId: order.id,
          note: `Redemption restored · ${order.orderNumber} cancelled`,
          createdByUserId: input.actorUserId,
        },
      });
      restored = order.loyaltyRedeemedPoints;
    }
  }

  let reversed = 0;
  if (order.loyaltyEarnedPoints > 0) {
    const prior = await tx.loyaltyTransaction.aggregate({
      where: {
        orderId: order.id,
        type: "REVERSAL",
        points: { lt: 0 },
        referenceType: { in: ["order_cancel_earn", "refund"] },
      },
      _sum: { points: true },
    });
    const alreadyReversed = Math.abs(prior._sum.points ?? 0);
    const remaining = Math.max(0, order.loyaltyEarnedPoints - alreadyReversed);
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: order.customerId },
      select: { loyaltyPointsBalance: true },
    });
    const points = Math.min(remaining, customer.loyaltyPointsBalance);
    if (points > 0) {
      const updated = await tx.customer.update({
        where: { id: order.customerId },
        data: { loyaltyPointsBalance: { decrement: points } },
        select: { loyaltyPointsBalance: true },
      });
      const txn = await tx.loyaltyTransaction.create({
        data: {
          customerId: order.customerId,
          orderId: order.id,
          type: "REVERSAL",
          points: -points,
          balanceAfter: updated.loyaltyPointsBalance,
          referenceType: "order_cancel_earn",
          referenceId: order.id,
          note: `Earned points reversed · ${order.orderNumber} cancelled`,
          createdByUserId: input.actorUserId,
        },
        select: { id: true },
      });
      await postJournal(tx, {
        description: `${order.orderNumber} · ${points} loyalty point${points === 1 ? "" : "s"} reversed`,
        source: "MANUAL",
        referenceType: "loyalty_transaction",
        referenceId: txn.id,
        actorUserId: input.actorUserId,
        lines: [
          { account: ACCOUNTS.loyaltyLiability, debit: points, customerId: order.customerId },
          { account: ACCOUNTS.loyaltyExpense, credit: points },
        ],
      });
      reversed = points;
    }
  }

  return { restored, reversed };
}

/**
 * Claw back the share of earned points that a refund represents. A full refund
 * reverses whatever is left; a partial refund reverses the same proportion of
 * the points still unspent.
 */
export async function reverseEarnedForRefund(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    refundId: string;
    refundAmount: Numeric;
    orderTotal: Numeric;
    isFull: boolean;
    actorUserId: string;
  },
): Promise<LoyaltyMovement | null> {
  await lockOrder(tx, input.orderId);

  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      loyaltyEarnedPoints: true,
      customer: { select: { isWalkInCash: true, deletedAt: true } },
    },
  });
  if (!order) throw new LoyaltyError("That order no longer exists.");
  if (order.customer.isWalkInCash || order.customer.deletedAt) return null;
  if (order.loyaltyEarnedPoints <= 0) return null;

  const prior = await tx.loyaltyTransaction.aggregate({
    where: {
      orderId: order.id,
      type: "REVERSAL",
      points: { lt: 0 },
      referenceType: { in: ["order_cancel_earn", "refund"] },
    },
    _sum: { points: true },
  });
  const remaining = Math.max(
    0,
    order.loyaltyEarnedPoints - Math.abs(prior._sum.points ?? 0),
  );
  if (remaining <= 0) return null;

  const orderTotal = money(input.orderTotal);
  const share = orderTotal.lessThanOrEqualTo(0)
    ? 1
    : money(input.refundAmount).div(orderTotal).toNumber();
  const proportional = input.isFull ? remaining : Math.floor(remaining * Math.min(1, share));
  if (proportional <= 0) return null;

  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: order.customerId },
    select: { loyaltyPointsBalance: true },
  });
  const points = Math.min(proportional, customer.loyaltyPointsBalance);
  if (points <= 0) return null;

  const updated = await tx.customer.update({
    where: { id: order.customerId },
    data: { loyaltyPointsBalance: { decrement: points } },
    select: { loyaltyPointsBalance: true },
  });
  const txn = await tx.loyaltyTransaction.create({
    data: {
      customerId: order.customerId,
      orderId: order.id,
      type: "REVERSAL",
      points: -points,
      balanceAfter: updated.loyaltyPointsBalance,
      referenceType: "refund",
      referenceId: input.refundId,
      note: `Earned points reversed by refund on ${order.orderNumber}`,
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  await postJournal(tx, {
    description: `${order.orderNumber} · ${points} loyalty point${points === 1 ? "" : "s"} reversed by refund`,
    source: "MANUAL",
    referenceType: "loyalty_transaction",
    referenceId: txn.id,
    actorUserId: input.actorUserId,
    lines: [
      { account: ACCOUNTS.loyaltyLiability, debit: points, customerId: order.customerId },
      { account: ACCOUNTS.loyaltyExpense, credit: points },
    ],
  });

  return { transactionId: txn.id, points: -points, balanceAfter: updated.loyaltyPointsBalance };
}

/**
 * Expire points older than twelve months. Points are not kept in lots, so the
 * amount that is still alive is the balance minus positive movements whose own
 * expiry is still in the future; everything above that is old and expires now.
 * Running the job twice cannot expire the same points twice.
 */
export async function expirePoints(
  input: { customerId?: string | null; actorUserId: string },
  outer?: Prisma.TransactionClient,
): Promise<{ customers: number; points: number }> {
  return run(outer, async (tx) => {
    const now = new Date();
    const customers = await tx.customer.findMany({
      where: {
        loyaltyPointsBalance: { gt: 0 },
        isWalkInCash: false,
        deletedAt: null,
        ...(input.customerId ? { id: input.customerId } : {}),
      },
      select: { id: true, fullName: true, loyaltyPointsBalance: true },
    });

    let expiredCustomers = 0;
    let expiredPoints = 0;

    for (const customer of customers) {
      const fresh = await tx.loyaltyTransaction.aggregate({
        where: {
          customerId: customer.id,
          type: { in: ["EARN", "ADJUSTMENT"] },
          points: { gt: 0 },
          OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
        },
        _sum: { points: true },
      });
      const alive = fresh._sum.points ?? 0;
      const expired = Math.max(0, customer.loyaltyPointsBalance - alive);
      if (expired <= 0) continue;

      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { loyaltyPointsBalance: { decrement: expired } },
        select: { loyaltyPointsBalance: true },
      });

      const txn = await tx.loyaltyTransaction.create({
        data: {
          customerId: customer.id,
          type: "EXPIRE",
          points: -expired,
          balanceAfter: updated.loyaltyPointsBalance,
          referenceType: "expiry",
          note: `${expired} point${expired === 1 ? "" : "s"} expired after ${LOYALTY.expiryMonths} months`,
          createdByUserId: input.actorUserId,
        },
        select: { id: true },
      });

      await postJournal(tx, {
        description: `${customer.fullName} · ${expired} loyalty point${expired === 1 ? "" : "s"} expired`,
        source: "MANUAL",
        referenceType: "loyalty_transaction",
        referenceId: txn.id,
        actorUserId: input.actorUserId,
        lines: [
          { account: ACCOUNTS.loyaltyLiability, debit: expired, customerId: customer.id },
          { account: ACCOUNTS.loyaltyExpense, credit: expired },
        ],
      });

      expiredCustomers += 1;
      expiredPoints += expired;
    }

    return { customers: expiredCustomers, points: expiredPoints };
  });
}

/** A manager adjustment. Positive points are a grant, negative points a correction. */
export async function adjustPoints(
  input: {
    customerId: string;
    points: Numeric | null | undefined;
    reason: string;
    actorUserId: string;
  },
  outer?: Prisma.TransactionClient,
): Promise<LoyaltyMovement> {
  const points = integerPoints(input.points);
  if (points === 0) throw new LoyaltyError("Enter a non-zero number of points.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new LoyaltyError("Give a reason for the adjustment.");

  return run(outer, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: {
        id: true,
        fullName: true,
        isWalkInCash: true,
        deletedAt: true,
        loyaltyPointsBalance: true,
      },
    });
    if (!customer || customer.deletedAt) throw new LoyaltyError("That customer no longer exists.");
    if (customer.isWalkInCash) {
      throw new LoyaltyError("The walk-in customer cannot hold loyalty points.");
    }

    let balanceAfter: number;
    if (points < 0) {
      const changed = await tx.customer.updateMany({
        where: {
          id: customer.id,
          loyaltyPointsBalance: { gte: Math.abs(points) },
        },
        data: { loyaltyPointsBalance: { decrement: Math.abs(points) } },
      });
      if (changed.count === 0) {
        throw new LoyaltyError(
          `The customer only has ${customer.loyaltyPointsBalance} points.`,
        );
      }
      const updated = await tx.customer.findUniqueOrThrow({
        where: { id: customer.id },
        select: { loyaltyPointsBalance: true },
      });
      balanceAfter = updated.loyaltyPointsBalance;
    } else {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { loyaltyPointsBalance: { increment: points } },
        select: { loyaltyPointsBalance: true },
      });
      balanceAfter = updated.loyaltyPointsBalance;
    }

    const txn = await tx.loyaltyTransaction.create({
      data: {
        customerId: customer.id,
        type: "ADJUSTMENT",
        points,
        balanceAfter,
        expiresAt: points > 0 ? addMonths(new Date(), LOYALTY.expiryMonths) : null,
        referenceType: "manual_adjustment",
        note: reason,
        createdByUserId: input.actorUserId,
      },
      select: { id: true },
    });

    await postJournal(tx, {
      description: `${customer.fullName} · loyalty adjustment ${points > 0 ? "+" : ""}${points}`,
      source: "MANUAL",
      referenceType: "loyalty_transaction",
      referenceId: txn.id,
      actorUserId: input.actorUserId,
      lines:
        points > 0
          ? [
              { account: ACCOUNTS.loyaltyExpense, debit: points },
              { account: ACCOUNTS.loyaltyLiability, credit: points, customerId: customer.id },
            ]
          : [
              {
                account: ACCOUNTS.loyaltyLiability,
                debit: Math.abs(points),
                customerId: customer.id,
              },
              { account: ACCOUNTS.loyaltyExpense, credit: Math.abs(points) },
            ],
    });

    return { transactionId: txn.id, points, balanceAfter };
  });
}

export async function loyaltyOverview() {
  const [total, customers, recent] = await Promise.all([
    prisma.customer.aggregate({
      where: { isWalkInCash: false, deletedAt: null },
      _sum: { loyaltyPointsBalance: true },
      _count: { _all: true },
    }),
    prisma.customer.count({
      where: {
        isWalkInCash: false,
        deletedAt: null,
        loyaltyPointsBalance: { gt: 0 },
      },
    }),
    prisma.loyaltyTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        points: true,
        balanceAfter: true,
        note: true,
        createdAt: true,
        customer: { select: { id: true, fullName: true, mobileNormalized: true } },
      },
    }),
  ]);

  return {
    outstandingPoints: total._sum.loyaltyPointsBalance ?? 0,
    customerCount: total._count._all,
    holders: customers,
    recent,
  };
}

export async function loyaltyLedger(customerId: string, take = 100) {
  return prisma.loyaltyTransaction.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      points: true,
      balanceAfter: true,
      expiresAt: true,
      referenceType: true,
      referenceId: true,
      note: true,
      createdAt: true,
      order: { select: { id: true, orderNumber: true } },
      createdBy: { select: { fullName: true } },
    },
  });
}


