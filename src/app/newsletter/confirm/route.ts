import { confirmSubscription } from "@/lib/crm/newsletter-service";
import { escapeHtml } from "@/lib/cms/markdown";

/**
 * Newsletter double opt-in endpoint.
 *
 * The link in the confirmation email points here. A GET is acceptable because
 * the token is random and single-purpose; it changes only the subscriber's own
 * status. Nothing is rendered from the request except the escaped email.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, message: string, email?: string): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)} · bgd26</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #f8fafc; color: #0f172a;
        font-family: system-ui, "Noto Sans Bengali", sans-serif; padding: 24px; }
      main { max-width: 34rem; background: #fff; border: 1px solid #e2e8f0;
        border-radius: 16px; padding: 28px; }
      h1 { font-size: 1.35rem; margin: 0 0 12px; }
      p { line-height: 1.6; margin: 0 0 10px; }
      .bn { color: #334155; }
      a { display: inline-block; margin-top: 14px; background: #006a4e; color: #fff;
        text-decoration: none; padding: 12px 18px; border-radius: 12px; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${email ? `<p class="bn">${escapeHtml(email)}</p>` : ""}
      <p class="bn">বাংলা: নিউজলেটার নিশ্চিতকরণের অবস্থা উপরে দেখানো হয়েছে।</p>
      <a href="/">bgd26</a>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await confirmSubscription(token);

  if (result.outcome === "not_found") {
    return page(
      "Link not recognised",
      "This confirmation link is invalid or has expired. Ask the shop to add you again.",
    );
  }

  if (result.outcome === "already_confirmed") {
    return page(
      "Already subscribed",
      "This address is already on the newsletter list. Nothing else is needed.",
      result.email,
    );
  }

  return page(
    "Subscription confirmed",
    "Thank you. You will receive occasional news and offers from bgd26.",
    result.email,
  );
}
