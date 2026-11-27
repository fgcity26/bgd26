import { audit } from "@/lib/auth/audit";
import { requestMeta } from "@/lib/auth/request-meta";
import { handleWebhook, WebhookError } from "@/lib/whatsapp/service";

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * GET is the subscription handshake (verify token). POST carries inbound
 * messages and delivery receipts; the raw body is verified against
 * X-Hub-Signature-256 before anything is parsed. Meta retries non-2xx
 * responses, so a duplicate is acknowledged with 200 and ignored by the unique
 * waMessageId.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");

  try {
    const result = await handleWebhook({ rawBody, signatureHeader });
    return Response.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof WebhookError) {
      if (error.status === 401) {
        const meta = await requestMeta();
        await audit({
          action: "whatsapp.webhook.rejected",
          entityType: "whatsapp",
          reason: error.message,
          ...meta,
        });
      }
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("[whatsapp] webhook failed", error);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
