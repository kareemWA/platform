const crypto = require("node:crypto");
const express = require("express");
const { z } = require("zod");
const { Course, Enrollment, Payment, AuditLog } = require("../models");
const { HttpError, asyncRoute, validate } = require("../lib/errors");
const { hasCourseAccess } = require("../lib/access");
const { isPublicHttpsOrigin, verifyWebhookSignature, createKashierCheckout } = require("../payments/kashier");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const checkoutRouter = express.Router();

checkoutRouter.post("/checkout/:courseId", asyncRoute(async (req, res) => {
  const courseId = validate(objectId, req.params.courseId);
  const course = await Course.findOne({ _id: courseId, status: "published" });
  if (!course) throw new HttpError(404, "الكورس غير موجود.");
  if (await hasCourseAccess(req.user, course._id)) return res.json({ access: true, courseId: course.id });
  if (req.user.role !== "admin" && String(course.grade || "") !== String(req.user.grade || "")) {
    throw new HttpError(404, "الكورس غير موجود.");
  }
  if (course.isFree) {
    const enrollment = await Enrollment.findOneAndUpdate(
      { user: req.user._id, course: course._id },
      { $set: { status: "active", source: "free", grantedBy: null, expiresAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ access: true, enrollment });
  }
  if (!req.app.locals.env.paymentsEnabled) throw new HttpError(503, "الدفع الإلكتروني غير مفعّل. تواصل مع الإدارة لإعداد بوابة الدفع.");
  if (!isPublicHttpsOrigin(req.app.locals.env.WEB_ORIGIN)) {
    throw new HttpError(503, "عنوان WEB_ORIGIN غير صالح للدفع عبر Kashier. استخدم عنوان HTTPS عامًا للنطاق أو نفق التطوير بدل localhost.");
  }
  if (!req.user.phoneNumber) throw new HttpError(400, "أضف رقم هاتفك إلى الملف الشخصي قبل بدء الدفع.");
  let payment = await Payment.findOne({
    user: req.user._id, course: course._id, status: "pending", provider: "kashier"
  }).sort({ createdAt: -1 });
  if (payment?.checkoutUrl) return res.json({ access: false, checkoutUrl: payment.checkoutUrl, merchantOrderId: payment.merchantOrderId });
  if (payment) {
    payment.status = "failed";
    await payment.save();
  }
  payment = await Payment.create({
    user: req.user._id, course: course._id, amountCents: course.priceCents,
    currency: course.currency, merchantOrderId: crypto.randomUUID(), provider: "kashier"
  });
  try {
    const checkout = await createKashierCheckout({ payment, user: req.user, course, env: req.app.locals.env });
    payment.providerOrderId = checkout.providerOrderId;
    payment.checkoutUrl = checkout.checkoutUrl;
    await payment.save();
  } catch (error) {
    payment.status = "failed";
    await payment.save();
    console.error("Kashier checkout creation failed", {
      merchantOrderId: payment.merchantOrderId,
      message: error.message
    });
    throw new HttpError(502, "تعذر إنشاء طلب دفع لدى بوابة الدفع. لم يتم منح صلاحية للكورس.");
  }
  res.status(201).json({ access: false, checkoutUrl: payment.checkoutUrl, merchantOrderId: payment.merchantOrderId });
}));

checkoutRouter.get("/payments/:merchantOrderId", asyncRoute(async (req, res) => {
  const merchantOrderId = z.string().uuid().parse(req.params.merchantOrderId);
  const payment = await Payment.findOne({ merchantOrderId, user: req.user._id }).select("status amountCents currency course paidAt").populate("course", "title").lean();
  if (!payment) throw new HttpError(404, "طلب الدفع غير موجود.");
  res.json({ payment });
}));

function amountMatchesPayment(amount, amountCents) {
  const value = Number(amount);
  return Number.isFinite(value) &&
    (Math.round(value * 100) === amountCents || (Number.isInteger(value) && value === amountCents));
}

const webhookRouter = express.Router();
webhookRouter.post("/webhook", asyncRoute(async (req, res) => {
  const env = req.app.locals.env;
  if (!env.paymentsEnabled) throw new HttpError(503, "إشعارات بوابة الدفع غير مفعّلة.");
  const transaction = req.body?.data;
  if (!transaction || typeof transaction !== "object" ||
      !verifyWebhookSignature(transaction, req.get("x-kashier-signature"), env.KASHIER_API_KEY)) {
    throw new HttpError(401, "تعذر التحقق من توقيع إشعار بوابة الدفع.");
  }
  const merchantOrderId = transaction.orderReference;
  const providerTransactionId = String(transaction.transactionId || "");
  if (!merchantOrderId || !providerTransactionId) throw new HttpError(400, "بيانات معاملة الدفع غير مكتملة.");
  const payment = await Payment.findOne({ merchantOrderId, provider: "kashier" });
  if (!payment) throw new HttpError(404, "طلب الدفع غير موجود.");
  if (!amountMatchesPayment(transaction.amount, payment.amountCents) ||
      String(transaction.currency).toUpperCase() !== payment.currency) {
    throw new HttpError(400, "مبلغ أو عملة إشعار الدفع لا تطابق الطلب.");
  }
  if (req.body.event !== "pay" || transaction.status !== "SUCCESS") {
    if (payment.status === "paid") return res.status(200).json({ received: true });
    if (transaction.status === "FAILURE") {
      payment.status = "failed";
      await payment.save();
    }
    return res.status(200).json({ received: true });
  }
  const duplicate = await Payment.findOne({ providerTransactionId, _id: { $ne: payment._id } });
  if (duplicate) throw new HttpError(409, "معرّف معاملة الدفع مستخدم مسبقًا.");
  await Enrollment.findOneAndUpdate(
    { user: payment.user, course: payment.course },
    { $set: { status: "active", source: "payment", grantedBy: null, expiresAt: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const confirmedPayment = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "paid" } },
    { $set: { status: "paid", providerTransactionId, paidAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!confirmedPayment) return res.status(200).json({ received: true });
  await AuditLog.create({
    actor: payment.user, action: "payment.confirmed", targetType: "Payment", targetId: payment._id,
    details: { providerTransactionId, amountCents: payment.amountCents }
  });
  res.status(200).json({ received: true });
}));

module.exports = { checkoutRouter, webhookRouter };
