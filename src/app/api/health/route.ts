import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + database readiness probe.
 * Never returns connection strings, credentials or stack traces.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const rows = await getPrisma().$queryRaw<Array<{ version: string }>>`
      select version() as version
    `;
    return NextResponse.json({
      status: "ok",
      database: "up",
      latencyMs: Date.now() - startedAt,
      server: rows[0]?.version?.split(" ").slice(0, 2).join(" ") ?? "unknown",
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json(
      {
        status: "degraded",
        database: "down",
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
