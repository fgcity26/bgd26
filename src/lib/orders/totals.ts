import { Prisma } from "@/generated/prisma/client";
import { money, type Numeric } from "@/lib/inventory/decimal";

/**
 * Sale money math.
 *
 * B2C prices are VAT-inclusive. A line is priced as
 *   gross      = unitPrice × quantity            (before discount)
 *   vat        = VAT contained in gross
 *   subtotal   = gross − vat                     (VAT-exclusive, before discount)
 *   discount   = this line's share of the order discount
 *   netGross   = gross − discount                (what the customer pays)
 * and the order keeps `grandTotal = subtotal + vat − discount + delivery`,
 * which is exactly the shape the `chk_order_totals` constraint requires.
 *
 * VAT is calculated before the discount so the order-level identity holds:
 * subtotal + vat is the gross sale value, and the discount is then deducted
 * once. Allocating the discount into the line totals keeps per-line arithmetic
 * consistent: subtotal + vat − discount = lineTotal.
 *
 * The discount is allocated proportionally across lines and the rounding
 * remainder is pushed onto the last line, so line discounts always add up to
 * the order discount.
 */
export class TotalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalsError";
  }
}

export type PricedInput = {
  quantity: Numeric;
  unitPrice: Numeric;
  vatPercentage: Numeric;
};

export type PricedLine = {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  vatPercentage: Prisma.Decimal;
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

export type SaleTotals = {
  lines: PricedLine[];
  subtotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  deliveryCharge: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  /** Discount as a fraction of the gross value, e.g. 0.075 for 7.5 %. */
  discountRate: Prisma.Decimal;
};

function nonNegative(value: Numeric, label: string): Prisma.Decimal {
  const parsed = money(value);
  if (parsed.lessThan(0)) throw new TotalsError(`${label} cannot be negative.`);
  return parsed;
}

/** Split `discount` across `grosses` in proportion to each line's value. */
export function allocateDiscount(
  grosses: Prisma.Decimal[],
  discount: Prisma.Decimal,
): Prisma.Decimal[] {
  const total = grosses.reduce((sum, gross) => sum.add(gross), new Prisma.Decimal(0));
  if (total.isZero()) {
    if (!discount.isZero()) throw new TotalsError("A discount needs a positive sale value.");
    return grosses.map(() => money(0));
  }
  if (discount.greaterThan(total)) {
    throw new TotalsError("The discount cannot be larger than the sale value.");
  }

  const shares: Prisma.Decimal[] = [];
  let allocated = money(0);
  grosses.forEach((gross, index) => {
    if (index === grosses.length - 1) {
      shares.push(money(discount.sub(allocated)));
      return;
    }
    const share = money(gross.mul(discount).div(total));
    shares.push(share);
    allocated = allocated.add(share);
  });
  return shares;
}

export function computeSaleTotals(
  inputs: PricedInput[],
  discountTotal: Numeric = 0,
  deliveryCharge: Numeric = 0,
): SaleTotals {
  if (inputs.length === 0) throw new TotalsError("Add at least one item to the sale.");

  const priced = inputs.map((input) => {
    const quantity = new Prisma.Decimal(input.quantity).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
    const unitPrice = money(input.unitPrice);
    const vatPercentage = new Prisma.Decimal(input.vatPercentage).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    if (!quantity.greaterThan(0)) throw new TotalsError("Every quantity must be greater than zero.");
    if (unitPrice.lessThan(0)) throw new TotalsError("A price cannot be negative.");
    if (vatPercentage.lessThan(0) || vatPercentage.greaterThan(100)) {
      throw new TotalsError("VAT must be between 0 and 100 %.");
    }
    return { quantity, unitPrice, vatPercentage, gross: money(unitPrice.mul(quantity)) };
  });

  const grossTotal = priced.reduce((sum, line) => sum.add(line.gross), money(0));
  const discount = nonNegative(discountTotal, "The discount");
  const delivery = nonNegative(deliveryCharge, "The delivery charge");

  const shares = allocateDiscount(
    priced.map((line) => line.gross),
    discount,
  );

  const lines: PricedLine[] = priced.map((line, index) => {
    const lineDiscount = shares[index] ?? money(0);
    const netGross = money(line.gross.sub(lineDiscount));
    const vatAmount = money(
      line.gross.mul(line.vatPercentage).div(new Prisma.Decimal(100).add(line.vatPercentage)),
    );
    return {
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatPercentage: line.vatPercentage,
      gross: line.gross,
      discount: lineDiscount,
      vatAmount,
      lineSubtotal: money(line.gross.sub(vatAmount)),
      lineTotal: netGross,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum.add(line.lineSubtotal), money(0));
  const vatTotal = lines.reduce((sum, line) => sum.add(line.vatAmount), money(0));
  const grandTotal = money(subtotal.add(vatTotal).sub(discount).add(delivery));
  if (grandTotal.lessThan(0)) throw new TotalsError("The sale total cannot be negative.");

  return {
    lines,
    subtotal: money(subtotal),
    vatTotal: money(vatTotal),
    discountTotal: money(discount),
    deliveryCharge: money(delivery),
    grandTotal,
    discountRate: grossTotal.isZero() ? money(0) : discount.div(grossTotal),
  };
}

/** The cashier discount cap, as a fraction of the gross sale value. */
export const CASHIER_DISCOUNT_CAP = 0.05;

export function exceedsCashierCap(totals: SaleTotals): boolean {
  return totals.discountRate.greaterThan(new Prisma.Decimal(CASHIER_DISCOUNT_CAP));
}
