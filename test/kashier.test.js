const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPublicHttpsOrigin,
  calculateWebhookSignature,
  verifyWebhookSignature,
  createKashierCheckout
} = require("../server/payments/kashier");

test("Kashier redirect origin must use a public HTTPS hostname", () => {
  assert.equal(isPublicHttpsOrigin("http://localhost:3000"), false);
  assert.equal(isPublicHttpsOrigin("https://localhost:3000"), false);
  assert.equal(isPublicHttpsOrigin("https://127.0.0.1"), false);
  assert.equal(isPublicHttpsOrigin("https://platform.example.test"), true);
  assert.equal(isPublicHttpsOrigin("https://tunnel.trycloudflare.com"), true);
});

const webhookData = {
  amount: 1,
  channel: "online | e-commerce",
  currency: "EGP",
  kashierOrderId: "9ad06b17-755b-4e21-9774-aff3e2726ac9",
  merchantOrderId: "1653481557813",
  method: "card",
  orderReference: "TEST-ORD-38855",
  status: "SUCCESS",
  transactionId: "TX-249893963",
  transactionResponseCode: "00",
  signatureKeys: [
    "amount", "channel", "currency", "kashierOrderId", "merchantOrderId",
    "method", "orderReference", "status", "transactionId", "transactionResponseCode"
  ]
};

test("Kashier webhook signature matches the documented HMAC and rejects modified fields", () => {
  const signature = calculateWebhookSignature(webhookData, "11111");
  assert.equal(signature, "9610477b2255b2a8ef84fd89adfaa5f1305ff9c20324205851890f1ea03109f4");
  assert.equal(verifyWebhookSignature(webhookData, signature, "11111"), true);
  assert.equal(verifyWebhookSignature({ ...webhookData, amount: 2 }, signature, "11111"), false);
  assert.equal(verifyWebhookSignature(webhookData, "invalid", "11111"), false);
  assert.equal(verifyWebhookSignature({ amount: 1 }, signature, "11111"), false);
});

test("Kashier checkout creates an Arabic EGP session and returns the hosted URL", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      sessionId: "kashier-session-id",
      sessionUrl: "https://payments.kashier.io/session/abc?mode=test"
    }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    const checkout = await createKashierCheckout({
      payment: {
        amountCents: 12550,
        currency: "EGP",
        merchantOrderId: "merchant-order-123"
      },
      user: { id: "student-1", email: "student@example.test" },
      course: { id: "course-1", title: "رياضيات" },
      env: {
        kashierBaseUrl: "https://test-api.kashier.io",
        KASHIER_API_KEY: "test-payment-key",
        KASHIER_SECRET_KEY: "test-secret-key",
        KASHIER_MERCHANT_ID: "MID-TEST",
        WEB_ORIGIN: "https://platform.example.test"
      }
    });
    assert.equal(request.url, "https://test-api.kashier.io/v3/payment/sessions");
    assert.equal(request.options.headers.authorization, "test-secret-key");
    assert.equal(request.options.headers["api-key"], "test-payment-key");
    assert.equal(request.body.amount, "125.50");
    assert.equal(request.body.currency, "EGP");
    assert.equal(request.body.order, "merchant-order-123");
    assert.equal(request.body.display, "ar");
    assert.equal(request.body.merchantId, "MID-TEST");
    assert.equal(request.body.serverWebhook, "https://platform.example.test/api/payments/webhook");
    assert.equal(checkout.providerOrderId, "kashier-session-id");
    assert.equal(checkout.checkoutUrl, "https://payments.kashier.io/session/abc?mode=test");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Kashier checkout rejects an unexpected session URL host", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    sessionUrl: "https://attacker.example.test/checkout"
  }), { status: 201, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(createKashierCheckout({
      payment: { amountCents: 100, currency: "EGP", merchantOrderId: "order-123" },
      user: { id: "student-1", email: "student@example.test" },
      course: { id: "course-1", title: "رياضيات" },
      env: {
        kashierBaseUrl: "https://test-api.kashier.io",
        KASHIER_API_KEY: "test-payment-key",
        KASHIER_SECRET_KEY: "test-secret-key",
        KASHIER_MERCHANT_ID: "MID-TEST",
        WEB_ORIGIN: "https://platform.example.test"
      }
    }), /unexpected payment session URL/);
  } finally {
    global.fetch = originalFetch;
  }
});
