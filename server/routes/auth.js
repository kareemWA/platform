const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { User, Grade } = require("../models");
const { HttpError, asyncRoute, validate } = require("../lib/errors");

const phoneSchema = z.string().trim().regex(/^\+?[0-9\s()-]{8,20}$/, "أدخل رقم هاتف صحيحًا.");
const registerSchema = z.object({
  displayName: z.string().trim().regex(/^[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+){3}$/, "اكتب الاسم الرباعي باللغة العربية."),
  password: z.string().min(10).max(128),
  grade: z.string().regex(/^[a-f\d]{24}$/i, "اختر صفك الدراسي."),
  phoneNumber: phoneSchema,
  parentPhoneNumber: phoneSchema,
  studyType: z.enum(["online", "center"])
});
const loginSchema = z.object({
  phoneNumber: z.union([phoneSchema, z.string().trim().email().max(254)]),
  password: z.string().min(1).max(128)
});

function publicUser(user) {
  const email = user.email?.endsWith("@students.local") ? "" : user.email || "";
  return {
    id: user.id, displayName: user.displayName, email, role: user.role,
    grade: user.grade || null, phoneNumber: user.phoneNumber || "",
    parentPhoneNumber: user.parentPhoneNumber || "", studyType: user.studyType || "online"
  };
}

function internalStudentEmail(phoneNumber) {
  return `student-${crypto.createHash("sha256").update(phoneNumber).digest("hex").slice(0, 24)}@students.local`;
}

function normalizePhone(value) {
  return value.trim().replace(/(?!^)[^0-9]/g, "");
}

function sessionCookieOptions(env) {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: "strict", path: "/", maxAge: 24 * 60 * 60 * 1000 };
}

function issueSession(user, res, env) {
  const token = jwt.sign({ sub: user.id, ver: user.tokenVersion }, env.JWT_SECRET, { expiresIn: "1d", issuer: "math-platform" });
  res.cookie("platform_session", token, sessionCookieOptions(env));
}

function authRoutes(env) {
  const router = require("express").Router();

  router.get("/csrf", (req, res) => {
    let token = req.cookies?.platform_csrf;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) token = crypto.randomBytes(32).toString("hex");
    res.cookie("platform_csrf", token, { httpOnly: false, secure: env.cookieSecure, sameSite: "strict", path: "/", maxAge: 24 * 60 * 60 * 1000 });
    res.json({ csrfToken: token });
  });

  router.post("/register", asyncRoute(async (req, res) => {
    const input = validate(registerSchema, req.body);
    const phoneNumber = normalizePhone(input.phoneNumber);
    const parentPhoneNumber = normalizePhone(input.parentPhoneNumber);
    if (await User.exists({ phoneNumber })) throw new HttpError(409, "يوجد حساب مسجل بهذا الرقم.");
    if (!await Grade.exists({ _id: input.grade, active: true })) throw new HttpError(400, "الصف الدراسي غير متاح.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    let user;
    try {
      user = await User.create({ displayName: input.displayName, email: internalStudentEmail(phoneNumber), passwordHash, grade: input.grade || null, phoneNumber, parentPhoneNumber, studyType: input.studyType });
    } catch (error) {
      if (error?.code === 11000) throw new HttpError(409, "يوجد حساب مسجل بهذا الرقم.");
      throw error;
    }
    issueSession(user, res, env);
    res.status(201).json({ user: publicUser(user) });
  }));

  router.post("/login", asyncRoute(async (req, res) => {
    const input = validate(loginSchema, req.body);
    const identifier = phoneSchema.safeParse(input.phoneNumber).success ? normalizePhone(input.phoneNumber) : input.phoneNumber.trim().toLowerCase();
    const user = await User.findOne({ $or: [{ phoneNumber: identifier }, { email: identifier.toLowerCase() }] });
    if (!user || !await bcrypt.compare(input.password, user.passwordHash)) throw new HttpError(401, "رقم الهاتف أو كلمة المرور غير صحيحة.");
    if (!user.isActive) throw new HttpError(403, "تم إيقاف الحساب. تواصل مع إدارة المنصة.");
    issueSession(user, res, env);
    res.json({ user: publicUser(user) });
  }));

  router.post("/logout", asyncRoute(async (req, res) => {
    if (req.user) await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.clearCookie("platform_session", { httpOnly: true, secure: env.cookieSecure, sameSite: "strict", path: "/" });
    res.status(204).end();
  }));

  router.get("/me", (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  router.get("/profile", (req, res) => {
    if (!req.user) throw new HttpError(401, "سجل الدخول أولًا.");
    res.json({ user: publicUser(req.user), phoneNumber: req.user.phoneNumber });
  });

  router.patch("/profile", asyncRoute(async (req, res) => {
    if (!req.user) throw new HttpError(401, "سجل الدخول أولًا.");
    throw new HttpError(403, "تعديل البيانات الشخصية غير متاح.");
  }));

  return router;
}

module.exports = { authRoutes, publicUser };
