const jwt = require("jsonwebtoken");
const { User } = require("../models");
const { HttpError, asyncRoute } = require("../lib/errors");

function createAuthMiddleware(secret) {
  const optional = asyncRoute(async (req, _res, next) => {
    const token = req.cookies?.platform_session;
    if (!token) {
      req.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, secret);
      const user = await User.findById(payload.sub).select("-passwordHash");
      if (user && user.isActive && user.tokenVersion === payload.ver) req.user = user;
      else req.user = null;
    } catch (error) {
      if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") throw error;
      req.user = null;
    }
    next();
  });

  const required = (req, res, next) => optional(req, res, error => {
    if (error) return next(error);
    if (!req.user) return next(new HttpError(401, "سجل الدخول أولًا."));
    next();
  });

  const admin = (req, _res, next) => {
    if (!req.user || req.user.role !== "admin") return next(new HttpError(403, "هذه الصفحة مخصصة للإدارة."));
    next();
  };

  return { optional, required, admin };
}

function createCsrfMiddleware() {
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const cookieToken = req.cookies?.platform_csrf;
    const headerToken = req.get("x-csrf-token");
    if (!cookieToken || !headerToken || !/^[a-f0-9]{64}$/.test(cookieToken) ||
        !/^[a-f0-9]{64}$/.test(headerToken) || cookieToken.length !== headerToken.length ||
        !require("node:crypto").timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return next(new HttpError(403, "تعذر التحقق من الطلب. حدّث الصفحة وحاول مجددًا."));
    }
    next();
  };
}

module.exports = { createAuthMiddleware, createCsrfMiddleware };
