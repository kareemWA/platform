const path = require("node:path");
const mongoose = require("mongoose");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createAuthMiddleware, createCsrfMiddleware } = require("./middleware/auth");
const { authRoutes } = require("./routes/auth");
const { catalogRoutes } = require("./routes/catalog");
const { adminRoutes } = require("./routes/admin");
const { checkoutRouter, webhookRouter } = require("./routes/payments");
const { fileRoutes, videoRoutes } = require("./routes/files");

function createApp(env) {
  const app = express();
  const { optional, required, admin } = createAuthMiddleware(env.JWT_SECRET);
  app.locals.env = env;
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'", "https://payments.kashier.io"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        frameSrc: ["'self'", "https://payments.kashier.io", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
        connectSrc: ["'self'", "https:"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "database_unavailable" });
  });
  app.get("/api/_assets/teacher-portrait", (_req, res, next) => {
    res.sendFile(path.resolve(__dirname, "..", "photo", "Professional Suit Portrait Cutout.png"), error => {
      if (error) next(error);
    });
  });
  app.get("/api/_assets/hls.min.js", (_req, res, next) => {
    res.sendFile(path.resolve(__dirname, "..", "node_modules", "hls.js", "dist", "hls.min.js"), error => {
      if (error) next(error);
    });
  });
  app.use("/api/payments", webhookRouter);
  app.use("/api", createCsrfMiddleware(), optional);

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
  app.use("/api/auth", (req, res, next) => ["POST"].includes(req.method) && ["/login", "/register"].includes(req.path) ? authLimiter(req, res, next) : next());
  app.use("/api/auth", authRoutes(env));
  app.use("/api", catalogRoutes);
  app.use("/api", required, checkoutRouter);
  app.use("/api/files", fileRoutes);
  app.use("/api/videos", videoRoutes);
  app.use("/api/admin", required, admin, adminRoutes);

  const webFiles = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/styles.css", "styles.css"],
    ["/watch.css", "watch.css"],
    ["/exam-admin.css", "exam-admin.css"],
    ["/app.js", "app.js"]
  ]);
  app.get([...webFiles.keys()], (req, res, next) => {
    const file = webFiles.get(req.path);
    if (!file) return next();
    res.sendFile(path.resolve(__dirname, "..", "public", file));
  });
  app.get("/teacher-portrait.png", (_req, res, next) => {
    res.sendFile(path.resolve(__dirname, "..", "photo", "Professional Suit Portrait Cutout.png"), error => {
      if (error) next(error);
    });
  });
  app.get("/hls.min.js", (_req, res, next) => {
    res.sendFile(path.resolve(__dirname, "..", "node_modules", "hls.js", "dist", "hls.min.js"), error => {
      if (error) next(error);
    });
  });

  app.use("/api", (_req, _res, next) => {
    const error = new Error("المسار المطلوب غير موجود.");
    error.status = 404;
    next(error);
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error.status || (error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE" ? 413 :
      error.name === "ValidationError" || error.name === "CastError" ? 400 : error.code === 11000 ? 409 : 500);
    if (status >= 500 && status !== 503) console.error(error);
    res.status(status).json({
      error: status >= 500 && env.NODE_ENV === "production" ? "حدث خطأ غير متوقع. حاول مرة أخرى." :
        status === 413 ? "حجم الملف يتجاوز الحد المسموح." : error.message,
      ...(env.NODE_ENV !== "production" && status >= 500 ? { details: error.message } : {})
    });
  });
  return app;
}

module.exports = { createApp };
