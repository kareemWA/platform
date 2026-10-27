const crypto = require("node:crypto");
const net = require("node:net");

function isPublicHttpsOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch { return false; }
  const hostname = url.hostname.toLowerCase();
  return url.protocol === "https:" && !url.username && !url.password &&
    hostname.includes(".") && hostname !== "localhost" &&
    !hostname.endsWith(".localhost") && !net.isIP(hostname);
}

function encodeSignatureValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function webhookSignaturePayload(data) {
  if (!data || !Array.isArray(data.signatureKeys) || data.signatureKeys.length === 0 ||
      data.signatureKeys.length > 64 || data.signatureKeys.some(key => typeof key !== "string")) {
    throw new Error("Kashier webhook signature keys are missing or invalid.");
  }
  return [...data.signatureKeys].sort().map(key => {
    if (!Object.hasOwn(data, key)) throw new Error("Kashier webhook signature field is missing.");
    const value = data[key];
    if (value === null || typeof value === "object") throw new Error("Kashier webhook signature field is invalid.");
    return `${key}=${encodeSignatureValue(value)}`;
  }).join("&");
}

function calculateWebhookSignature(data, paymentApiKey) {
  return crypto.createHmac("sha256", paymentApiKey).update(webhookSignaturePayload(data)).digest("hex");
}

function verifyWebhookSignature(data, providedSignature, paymentApiKey) {
  if (typeof providedSignature !== "string" || !/^[a-f\d]{64}$/i.test(providedSignature)) return false;
  let expected;
  try { expected = Buffer.from(calculateWebhookSignature(data, paymentApiKey), "hex"); }
  catch (error) {
    if (error.message.startsWith("Kashier webhook signature")) return false;
    throw error;
  }
  const supplied = Buffer.from(providedSignature, "hex");
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

async function createKashierCheckout({ payment, user, course, env }) {
  const now = Date.now();
  const response = await fetch(new URL("/v3/payment/sessions", env.kashierBaseUrl), {
    method: "POST",
    headers: {
      authorization: env.KASHIER_SECRET_KEY,
      "api-key": env.KASHIER_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      expireAt: new Date(now + 30 * 60 * 1000).toISOString(),
      maxFailureAttempts: 3,
      paymentType: "credit",
      amount: (payment.amountCents / 100).toFixed(2),
      currency: payment.currency,
      order: payment.merchantOrderId,
      merchantId: env.KASHIER_MERCHANT_ID,
      merchantRedirect: `${env.WEB_ORIGIN}/?merchantOrderId=${encodeURIComponent(payment.merchantOrderId)}`,
      serverWebhook: `${env.WEB_ORIGIN}/api/payments/webhook`,
      display: "ar",
      type: "one-time",
      allowedMethods: "card,wallet",
      description: `Course ${course.id}: ${course.title}`.slice(0, 250),
      customer: {
        email: user.email,
        reference: String(user.id || user._id)
      }
    }),
    signal: AbortSignal.timeout(15000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Kashier returned a non-JSON response (${response.status}).`); }
  if (!response.ok) throw new Error(`Kashier request failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  const checkoutUrl = data.sessionUrl || data.data?.sessionUrl;
  if (typeof checkoutUrl !== "string") throw new Error("Kashier response did not include a payment session URL.");
  const parsedUrl = new URL(checkoutUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "payments.kashier.io") {
    throw new Error("Kashier returned an unexpected payment session URL.");
  }
  return {
    providerOrderId: String(data.sessionId || data.data?.sessionId || ""),
    checkoutUrl
  };
}

module.exports = {
  isPublicHttpsOrigin,
  webhookSignaturePayload,
  calculateWebhookSignature,
  verifyWebhookSignature,
  createKashierCheckout
};
