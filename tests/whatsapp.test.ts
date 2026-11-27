import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  cloudTimeoutMs,
  getWhatsAppAdapter,
  retryDelaySeconds,
  retryPolicy,
  whatsappSettings,
  WhatsAppError,
} from "../src/lib/adapters/whatsapp";
import { cloudWhatsappAdapter } from "../src/lib/adapters/whatsapp/cloud";
import { localWhatsappAdapter } from "../src/lib/adapters/whatsapp/local";
import { verifyHmacSha256 } from "../src/lib/adapters/whatsapp/signature";
import { buildVariables, renderTemplate } from "../src/lib/whatsapp/templates";
import {
  dispatchMessage,
  dispatchQueue,
  maskedRecipient,
} from "../src/lib/whatsapp/service";

/**
 * WhatsApp unit tests: the parts that must never depend on Meta being reachable
 * or credentials existing. Queue durability is exercised by verify:whatsapp
 * against the database; here we pin the phone/template/signature/provider
 * contracts and the retry arithmetic.
 */

const ENV_KEYS = [
  "FEATURE_WHATSAPP",
  "WHATSAPP_PROVIDER",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_BUSINESS_NUMBER",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_SEND_TIMEOUT_MS",
  "WHATSAPP_MAX_ATTEMPTS",
  "WHATSAPP_RETRY_BASE_SECONDS",
  "WHATSAPP_RETRY_MAX_SECONDS",
  "NODE_ENV",
] as const;

/** Run with a clean WhatsApp env, restoring every key afterwards. */
async function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function signature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

test("template variables follow Meta's positional order for every event", () => {
  const data = {
    customerName: "Rahim",
    orderNumber: "BGD-1001",
    total: "1250.00",
    dueAmount: "250.00",
    amount: "500.00",
    courier: "Pathao",
    trackingNumber: "PT-9",
    method: "bKash",
    link: "https://bgd26.com/review/abc",
  };

  assert.deepEqual(buildVariables("ORDER_CONFIRMED", data), [
    "Rahim",
    "BGD-1001",
    "1250.00",
  ]);
  assert.deepEqual(buildVariables("ORDER_SHIPPED", data), [
    "Rahim",
    "BGD-1001",
    "Pathao",
    "PT-9",
  ]);
  assert.deepEqual(buildVariables("REFUND_COMPLETED", data), [
    "Rahim",
    "BGD-1001",
    "500.00",
    "bKash",
  ]);
  assert.deepEqual(buildVariables("PAYMENT_REMINDER", data), [
    "Rahim",
    "BGD-1001",
    "250.00",
  ]);
  assert.deepEqual(buildVariables("REVIEW_REQUEST", data), [
    "Rahim",
    "BGD-1001",
    "https://bgd26.com/review/abc",
  ]);
});

test("missing customer and shipping details fall back instead of rendering empty", () => {
  const variables = buildVariables("ORDER_SHIPPED", {
    customerName: "   ",
    orderNumber: "BGD-2",
    courier: null,
    trackingNumber: null,
  });
  assert.equal(variables[0], "কাস্টমার");
  assert.equal(variables[2], "আমাদের ডেলিভারি");
  assert.equal(variables[3], "—");

  const refund = buildVariables("REFUND_COMPLETED", {
    customerName: "Karim",
    orderNumber: "BGD-3",
    amount: "100.00",
  });
  assert.equal(refund[3], "আগের মাধ্যমে");

  const reminder = buildVariables("PAYMENT_REMINDER", {
    customerName: "Karim",
    orderNumber: "BGD-3",
    total: "900.00",
  });
  assert.equal(reminder[2], "900.00");
});

test("rendering replaces known placeholders and keeps unknown ones visible", () => {
  assert.equal(
    renderTemplate("হ্যালো {{1}}, অর্ডার {{ 2 }} — {{3}}", ["Rahim", "BGD-1"]),
    "হ্যালো Rahim, অর্ডার BGD-1 — {{3}}",
  );
  assert.equal(renderTemplate("no variables", []), "no variables");
  // A repeated placeholder is replaced everywhere.
  assert.equal(renderTemplate("{{1}}/{{1}}", ["a"]), "a/a");
});

/* -------------------------------------------------------------------------- */
/* Signatures                                                                 */
/* -------------------------------------------------------------------------- */

test("webhook signatures accept only an exact HMAC of the raw body", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const secret = "test-app-secret";
  const good = signature(body, secret);

  assert.equal(verifyHmacSha256(body, good, secret), true);
  assert.equal(verifyHmacSha256(body, good.toUpperCase().replace("SHA256=", "sha256="), secret), true);

  // A changed byte, a different secret, a missing header and a malformed hex
  // string are all refused.
  assert.equal(verifyHmacSha256(`${body} `, good, secret), false);
  assert.equal(verifyHmacSha256(body, signature(body, "other-secret"), secret), false);
  assert.equal(verifyHmacSha256(body, null, secret), false);
  assert.equal(verifyHmacSha256(body, "sha256=abc", secret), false);
  assert.equal(verifyHmacSha256(body, `sha1=${good.slice(7)}`, secret), false);
  assert.equal(verifyHmacSha256(body, good, ""), false);
});

test("the local adapter verifies with the configured secret and refuses unsigned traffic in production", async () => {
  const body = '{"hello":"world"}';

  await withEnv({ WHATSAPP_APP_SECRET: "local-secret" }, () => {
    assert.equal(
      localWhatsappAdapter.verifySignature({
        rawBody: body,
        signatureHeader: signature(body, "local-secret"),
      }),
      true,
    );
    assert.equal(
      localWhatsappAdapter.verifySignature({
        rawBody: body,
        signatureHeader: signature(body, "wrong"),
      }),
      false,
    );
  });

  await withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(
      localWhatsappAdapter.verifySignature({ rawBody: body, signatureHeader: "local" }),
      true,
    );
  });

  await withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      localWhatsappAdapter.verifySignature({ rawBody: body, signatureHeader: "local" }),
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Adapters                                                                   */
/* -------------------------------------------------------------------------- */

test("the local simulator is deterministic per idempotency key", async () => {
  const first = await localWhatsappAdapter.sendTemplate({
    to: "+8801712345678",
    templateName: "order_confirmation",
    language: "bn",
    variables: ["Rahim", "BGD-1", "100.00"],
    idempotencyKey: "ORDER_CONFIRMED:order-1",
  });
  const second = await localWhatsappAdapter.sendTemplate({
    to: "+8801712345678",
    templateName: "order_confirmation",
    language: "bn",
    variables: ["Rahim", "BGD-1", "100.00"],
    idempotencyKey: "ORDER_CONFIRMED:order-1",
  });
  const other = await localWhatsappAdapter.sendTemplate({
    to: "+8801712345678",
    templateName: "order_confirmation",
    language: "bn",
    variables: [],
    idempotencyKey: "ORDER_CONFIRMED:order-2",
  });

  assert.match(first.waMessageId, /^local_[a-f0-9]{24}$/);
  assert.equal(first.waMessageId, second.waMessageId);
  assert.notEqual(first.waMessageId, other.waMessageId);

  const text = await localWhatsappAdapter.sendText({
    to: "+8801712345678",
    body: "hello",
    idempotencyKey: "manual:1",
  });
  assert.notEqual(text.waMessageId, first.waMessageId);
});

test("the cloud adapter refuses to send when it is not configured", async () => {
  await withEnv({ WHATSAPP_PROVIDER: "cloud" }, async () => {
    await assert.rejects(
      cloudWhatsappAdapter.sendTemplate({
        to: "+8801712345678",
        templateName: "order_confirmation",
        language: "bn",
        variables: ["a"],
        idempotencyKey: "x",
      }),
      (error: unknown) =>
        error instanceof WhatsAppError && error.code === "NOT_CONFIGURED" && !error.retryable,
    );
  });

  await assert.rejects(
    cloudWhatsappAdapter.sendText({
      to: "+8801712345678",
      body: "   ",
      idempotencyKey: "x",
    }),
    (error: unknown) => error instanceof WhatsAppError && error.code === "EMPTY_MESSAGE",
  );
});

test("provider selection falls back to the simulator and names what is missing", async () => {
  await withEnv({ WHATSAPP_PROVIDER: "cloud" }, () => {
    const settings = whatsappSettings();
    assert.equal(settings.requested, "cloud");
    assert.equal(settings.provider, "local");
    assert.equal(settings.live, false);
    assert.deepEqual(settings.missing, [
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
    ]);
    assert.match(settings.notice ?? "", /WHATSAPP_PHONE_NUMBER_ID/);
    assert.equal(getWhatsAppAdapter(settings).provider, "local");
  });

  await withEnv({ WHATSAPP_PROVIDER: "cloud" }, () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_APP_SECRET = "secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    const settings = whatsappSettings();
    assert.equal(settings.live, true);
    assert.equal(settings.provider, "cloud");
    assert.deepEqual(settings.missing, []);
    assert.equal(settings.notice, null);
    assert.equal(getWhatsAppAdapter(settings).provider, "cloud");
  });

  // Auto-detection: a phone number id and token are enough to request cloud,
  // but the secret and verify token are still required to go live.
  await withEnv(
    {
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      WHATSAPP_ACCESS_TOKEN: "token",
    },
    () => {
      const settings = whatsappSettings();
      assert.equal(settings.requested, "cloud");
      assert.equal(settings.live, false);
      assert.deepEqual(settings.missing, ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]);
    },
  );

  await withEnv({ FEATURE_WHATSAPP: "false" }, () => {
    const settings = whatsappSettings();
    assert.equal(settings.enabled, false);
    assert.equal(settings.live, false);
    assert.match(settings.notice ?? "", /switched off/i);
  });
});

test("a switched-off feature sends nothing, even from the worker", async () => {
  await withEnv({ FEATURE_WHATSAPP: "false" }, async () => {
    const direct = await dispatchMessage("not-a-real-message");
    assert.equal(direct.status, "QUEUED");
    assert.match(direct.error ?? "", /switched off/i);

    const summary = await dispatchQueue({ limit: 5 });
    assert.deepEqual(summary, {
      attempted: 0,
      sent: 0,
      queued: 0,
      failed: 0,
      skipped: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Retry policy                                                               */
/* -------------------------------------------------------------------------- */

test("retry uses exponential backoff with a hard ceiling", () => {
  assert.equal(retryDelaySeconds(1, 60, 3600), 60);
  assert.equal(retryDelaySeconds(2, 60, 3600), 120);
  assert.equal(retryDelaySeconds(3, 60, 3600), 240);
  assert.equal(retryDelaySeconds(4, 60, 3600), 480);
  assert.equal(retryDelaySeconds(7, 60, 3600), 3600);
  assert.equal(retryDelaySeconds(99, 60, 3600), 3600);
  // A nonsensical attempt never produces Infinity or NaN.
  assert.equal(retryDelaySeconds(0, 60, 3600), 60);
});

test("retry and timeout settings are clamped to safe ranges", async () => {
  await withEnv(
    {
      WHATSAPP_MAX_ATTEMPTS: "999",
      WHATSAPP_RETRY_BASE_SECONDS: "1",
      WHATSAPP_RETRY_MAX_SECONDS: "2",
      WHATSAPP_SEND_TIMEOUT_MS: "10",
    },
    () => {
      assert.deepEqual(retryPolicy(), {
        maxAttempts: 5,
        baseSeconds: 60,
        maxSeconds: 3600,
      });
      assert.equal(cloudTimeoutMs(), 15_000);
    },
  );

  await withEnv(
    {
      WHATSAPP_MAX_ATTEMPTS: "3",
      WHATSAPP_RETRY_BASE_SECONDS: "30",
      WHATSAPP_RETRY_MAX_SECONDS: "600",
      WHATSAPP_SEND_TIMEOUT_MS: "45000",
    },
    () => {
      assert.deepEqual(retryPolicy(), {
        maxAttempts: 3,
        baseSeconds: 30,
        maxSeconds: 600,
      });
      assert.equal(cloudTimeoutMs(), 45_000);
    },
  );

  await withEnv({ WHATSAPP_SEND_TIMEOUT_MS: "999999" }, () => {
    assert.equal(cloudTimeoutMs(), 60_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Privacy                                                                    */
/* -------------------------------------------------------------------------- */

test("queue recipients are masked before they reach the screen", () => {
  assert.equal(maskedRecipient("+8801712345678"), "+8801*******78");
  assert.equal(maskedRecipient(null), "—");
  assert.equal(maskedRecipient(""), "—");
});
