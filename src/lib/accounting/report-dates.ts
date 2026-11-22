/**
 * Report date ranges.
 *
 * Bangladesh is UTC+6 with no daylight saving, so a "day" in a report is the
 * Dhaka day, not the server's UTC day. The helpers build explicit +06:00
 * boundaries so an entry posted at 00:30 Dhaka does not fall into yesterday.
 */

const DHAKA_OFFSET = "+06:00";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function valid(value: string | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

export function startOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000${DHAKA_OFFSET}`);
}

export function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999${DHAKA_OFFSET}`);
}

export function parseRange(fromParam?: string, toParam?: string): {
  from: Date;
  to: Date;
  fromValue: string;
  toValue: string;
} {
  const today = dhakaToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const fromValue = valid(fromParam) ?? monthStart;
  const toValue = valid(toParam) ?? today;
  const [from, to] =
    fromValue <= toValue
      ? [startOfDay(fromValue), endOfDay(toValue)]
      : [startOfDay(toValue), endOfDay(fromValue)];
  return {
    from,
    to,
    fromValue: fromValue <= toValue ? fromValue : toValue,
    toValue: fromValue <= toValue ? toValue : fromValue,
  };
}

export function parseAsOf(value?: string): { asOf: Date; value: string } {
  const chosen = valid(value) ?? dhakaToday();
  return { asOf: endOfDay(chosen), value: chosen };
}

export { dhakaToday };
