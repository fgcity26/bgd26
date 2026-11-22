/**
 * Money and VAT arithmetic.
 *
 * Bangladesh B2C prices are stored VAT-inclusive. All arithmetic happens in
 * integer paisa (1 BDT = 100 paisa) with half-up rounding, never floating point.
 * Unit costs use four decimal places and are handled by the caller as strings.
 */
const PAISA_PER_TAKA = 100n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Round a rational number half-up, away from zero for negatives. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("Cannot divide by zero.");
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Parse a user-entered taka amount into integer paisa.
 * Accepts "1,234.50", "1234", "1234.5" and rejects more than two decimals.
 */
export function parseMoneyToPaisa(value: string | number): number {
  const text = String(value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new MoneyError("Enter an amount with at most two decimal places.");
  }

  const [taka, fraction = ""] = text.split(".");
  const paisa = BigInt(taka) * PAISA_PER_TAKA + BigInt(fraction.padEnd(2, "0"));
  if (paisa > 99_999_999_999_999n) {
    throw new MoneyError("That amount is too large.");
  }
  return Number(paisa);
}

/** Format integer paisa as a plain decimal string with two places. */
export function formatPaisa(paisa: number): string {
  if (!Number.isSafeInteger(paisa)) throw new MoneyError("Amount must be an integer number of paisa.");
  const negative = paisa < 0;
  const absolute = Math.abs(paisa);
  const taka = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${taka}.${fraction}`;
}

/** Percentage stored as Decimal(5,2) → basis points (15.00 → 1500). */
export function percentageToBasisPoints(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new MoneyError("VAT must be a percentage with at most two decimals.");
  }
  const [whole, fraction = ""] = text.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}

/**
 * VAT contained in a VAT-inclusive gross amount:
 *   vat = round(gross × rate / (100 + rate))
 * Returns integer paisa.
 */
export function vatPortionInclusive(grossPaisa: number, vatPercentage: string | number): number {
  const basisPoints = BigInt(percentageToBasisPoints(vatPercentage));
  if (basisPoints === 0n) return 0;
  if (basisPoints > 10_000n) throw new MoneyError("VAT cannot exceed 100%.");

  return Number(
    roundHalfUp(BigInt(grossPaisa) * basisPoints, 10_000n + basisPoints),
  );
}

/** Net (VAT-exclusive) amount contained in a VAT-inclusive gross amount. */
export function netOfVatInclusive(grossPaisa: number, vatPercentage: string | number): number {
  return grossPaisa - vatPortionInclusive(grossPaisa, vatPercentage);
}

export function formatTaka(paisa: number): string {
  return `৳${formatPaisa(paisa)}`;
}

/** Parse a 4-decimal unit cost ("12.3456") into a plain decimal string. */
export function parseUnitCost(value: string | number): string {
  const text = String(value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) {
    throw new MoneyError("Cost must have at most four decimal places.");
  }
  return text.includes(".") ? text : `${text}.0000`;
}
