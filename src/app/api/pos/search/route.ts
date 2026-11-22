import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/auth/permissions";
import { getStaffSession } from "@/lib/auth/session";
import { searchPosVariants } from "@/lib/orders/pos";

export const dynamic = "force-dynamic";

/**
 * Counter search. Answers from indexed columns only and never returns cost
 * price. A cashier must be able to search while the terminal is offline, so the
 * browser caches this response; the server still prices every sale again.
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
  const query = url.searchParams.get("q")?.trim() ?? "";
  const warehouse = url.searchParams.get("warehouse")?.trim() || null;

  try {
    const variants = await searchPosVariants({ query, warehouseId: warehouse, limit: 20 });
    return NextResponse.json(
      { variants },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[pos/search] failed", error);
    return NextResponse.json({ error: "Search is unavailable." }, { status: 503 });
  }
}
