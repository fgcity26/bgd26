import { Prisma } from "@/generated/prisma/client";

/**
 * Decimal helpers for inventory.
 *
 * Quantities are 3 dp, unit costs 4 dp and money 2 dp — the same precision as
 * the database columns. Rounding is half-up everywhere, and all arithmetic goes
 * through decimal.js (via Prisma's Decimal) so a quantity never drifts the way a
 * JavaScript float would.
 */
export const D = Prisma.Decimal;
export type Numeric = Prisma.Decimal | string | number;

export function dec(value: Numeric): Prisma.Decimal {
  return value instanceof D ? value : new D(value);
}

export function qty(value: Numeric): Prisma.Decimal {
  return dec(value).toDecimalPlaces(3, D.ROUND_HALF_UP);
}

export function unitCost(value: Numeric): Prisma.Decimal {
  return dec(value).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

export function money(value: Numeric): Prisma.Decimal {
  return dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function isPositive(value: Prisma.Decimal): boolean {
  return value.greaterThan(0);
}

export function isZero(value: Prisma.Decimal): boolean {
  return value.isZero();
}
