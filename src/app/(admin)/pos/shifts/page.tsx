import type { Metadata } from "next";
import {
  CashMovementForm,
  CloseShiftForm,
  OpenShiftForm,
} from "@/components/pos/shift-forms";
import { PosNav } from "@/components/pos/pos-nav";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/inventory/format";

export const metadata: Metadata = {
  title: "POS shifts",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

function expectedFor(shift: {
  openingFloat: Prisma.Decimal;
  payments: Array<{ amount: Prisma.Decimal }>;
  cashMovements: Array<{ type: string; amount: Prisma.Decimal }>;
}): Prisma.Decimal {
  const cashSales = shift.payments.reduce(
    (sum, payment) => sum.add(payment.amount),
    new Prisma.Decimal(0),
  );
  const movement = shift.cashMovements.reduce((sum, row) => {
    const signed = row.type === "CASH_IN" ? row.amount : row.amount.neg();
    return sum.add(signed);
  }, new Prisma.Decimal(0));
  return shift.openingFloat.add(cashSales).add(movement);
}

export default async function PosShiftsPage() {
  const session = await requirePagePermission("pos.read");
  const canWrite = hasPermission(session, "pos.write");

  const [openShifts, closedShifts, devices] = await Promise.all([
    prisma.posShift.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        shiftNumber: true,
        openedAt: true,
        openingFloat: true,
        device: { select: { code: true, name: true } },
        cashier: { select: { fullName: true } },
        payments: {
          where: { method: "CASH", status: "PAID" },
          select: { amount: true },
        },
        cashMovements: {
          where: { type: { in: ["CASH_IN", "CASH_OUT", "CASH_DROP"] } },
          select: { type: true, amount: true, reason: true, createdAt: true },
        },
      },
    }),
    prisma.posShift.findMany({
      where: { status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 20,
      select: {
        id: true,
        shiftNumber: true,
        openedAt: true,
        closedAt: true,
        openingFloat: true,
        expectedCash: true,
        closingCounted: true,
        cashVariance: true,
        device: { select: { code: true } },
        cashier: { select: { fullName: true } },
      },
    }),
    prisma.posDevice.findMany({
      where: { status: "ACTIVE" },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">POS shifts</h1>
          <p className="mt-1 text-sm text-ink-500">
            শিফটের নগদ হিসাব। প্রতিটি শিফট খোলা ও বন্ধের সময় আলাদা করে রাখা হয়।
          </p>
        </div>
        <PosNav />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          {openShifts.length === 0 ? (
            <div className="rounded-2xl bg-white p-4 text-sm text-ink-500 shadow-sm ring-1 ring-slate-200">
              No shift is open right now.
            </div>
          ) : (
            openShifts.map((shift) => {
              const expected = expectedFor(shift);
              const cashSales = shift.payments.reduce(
                (sum, payment) => sum.add(payment.amount),
                new Prisma.Decimal(0),
              );
              return (
                <section
                  key={shift.id}
                  className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">{shift.shiftNumber}</h2>
                      <p className="text-xs text-ink-500">
                        {shift.device.code} · {shift.device.name} · {shift.cashier.fullName} ·
                        opened {dateTime.format(shift.openedAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200">
                      OPEN
                    </span>
                  </div>

                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <dt className="text-xs text-ink-500">Opening float</dt>
                      <dd className="font-semibold">৳{formatMoney(shift.openingFloat)}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <dt className="text-xs text-ink-500">Cash sales</dt>
                      <dd className="font-semibold">৳{formatMoney(cashSales)}</dd>
                    </div>
                    <div className="rounded-xl bg-brand-50 p-2">
                      <dt className="text-xs text-brand-700">Expected in drawer</dt>
                      <dd className="font-semibold text-brand-800">৳{formatMoney(expected)}</dd>
                    </div>
                  </dl>

                  {shift.cashMovements.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-xs text-ink-500">
                      {shift.cashMovements.map((movement, index) => (
                        <li key={`${movement.type}-${index}`}>
                          {movement.type.replaceAll("_", " ")} · ৳{formatMoney(movement.amount)} ·{" "}
                          {movement.reason ?? "no reason"} · {dateTime.format(movement.createdAt)}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {canWrite ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                          Close shift
                        </h3>
                        <div className="mt-2">
                          <CloseShiftForm shiftId={shift.id} expectedCash={formatMoney(expected)} />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                          Cash movement
                        </h3>
                        <div className="mt-2">
                          <CashMovementForm shiftId={shift.id} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })
          )}

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Recently closed</h2>
            {closedShifts.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No closed shift yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="py-2 pr-3">Shift</th>
                      <th className="py-2 pr-3">Closed</th>
                      <th className="py-2 pr-3">Expected</th>
                      <th className="py-2 pr-3">Counted</th>
                      <th className="py-2">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {closedShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="py-2 pr-3">
                          <span className="font-medium">{shift.shiftNumber}</span>
                          <span className="block text-xs text-ink-500">
                            {shift.device.code} · {shift.cashier.fullName}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-ink-500">
                          {shift.closedAt ? dateTime.format(shift.closedAt) : "—"}
                        </td>
                        <td className="py-2 pr-3">৳{formatMoney(shift.expectedCash)}</td>
                        <td className="py-2 pr-3">৳{formatMoney(shift.closingCounted)}</td>
                        <td
                          className={`py-2 font-medium ${
                            Number(shift.cashVariance ?? 0) === 0 ? "" : "text-red-700"
                          }`}
                        >
                          ৳{formatMoney(shift.cashVariance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold">Open a shift</h2>
          {canWrite ? (
            devices.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">Register a device first.</p>
            ) : (
              <div className="mt-3">
                <OpenShiftForm devices={devices} />
              </div>
            )
          ) : (
            <p className="mt-3 text-sm text-ink-500">
              A cashier with <code>pos.write</code> opens shifts.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
