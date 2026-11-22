import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/auth/permissions";
import { getStaffSession } from "@/lib/auth/session";
import { posCatalog } from "@/lib/orders/pos";

export const dynamic = "force-dynamic";

/**
 * Offline catalogue snapshot. The device stores a bounded copy so the till keeps
 * working without a network; prices are a hint only, because the server re-prices
 * every sale before it is stored.
 */
export async function GET(request: Request) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to use the till." }, { status: 401 });
  }
  if (!hasPermission(session, "pos.read")) {
    return NextResponse.json({ error: "You cannot use the till." }, { status: 403 });
  }

  const url = new URL(request.url);
  const warehouse = url.searchParams.get("warehouse")?.trim() || null;

  try {
    const variants = await posCatalog({ warehouseId: warehouse });
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), variants },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[pos/catalog] failed", error);
    return NextResponse.json({ error: "The catalogue is unavailable." }, { status: 503 });
  }
}
