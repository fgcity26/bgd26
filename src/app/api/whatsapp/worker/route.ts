import { dispatchQueue } from "@/lib/whatsapp/service";

/**
 * WhatsApp retry worker.
 *
 * A failed or deferred message stays in `whatsapp_messages` with a
 * `nextAttemptAt`. This endpoint drains due rows. It is protected by a shared
 * secret (`WHATSAPP_WORKER_SECRET` or Vercel's `CRON_SECRET`), and is called by
 * the daily Vercel cron as well as the "Send queued now" button in the console.
 * On Hobby the cron is daily; the inline send after each event covers the rest.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secrets = [
    process.env.WHATSAPP_WORKER_SECRET?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (secrets.length === 0) {
    // No secret configured: allow only outside production, so a deployed site
    // can never be drained by an anonymous request.
    return process.env.NODE_ENV !== "production";
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const direct = request.headers.get("x-worker-secret")?.trim() ?? "";
  const query = new URL(request.url).searchParams.get("secret")?.trim() ?? "";

  return secrets.some((secret) => secret === bearer || secret === direct || secret === query);
}

async function run(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  try {
    const summary = await dispatchQueue({
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[whatsapp] worker failed", error);
    return Response.json({ ok: false, error: "Worker failed." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
