const qtyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const costFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function numeric(value: unknown): number {
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatQty(value: unknown): string {
  return qtyFormat.format(numeric(value));
}

export function formatCost(value: unknown): string {
  return costFormat.format(numeric(value));
}

export function formatMoney(value: unknown): string {
  return moneyFormat.format(numeric(value));
}
