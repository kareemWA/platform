const path = require("node:path");
const net = require("node:net");
const { z } = require("zod");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DNS_SERVERS: z.string().optional().transform(value =>
    value ? value.split(",").map(server => server.trim()).filter(Boolean) : []
  ).refine(servers => servers.every(server => net.isIP(server) !== 0), "MONGODB_DNS_SERVERS must be a comma-separated list of DNS server IP addresses"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must contain at least 32 characters"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  UPLOAD_DIR: z.string().default("./private-uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(20),
  MAX_VIDEO_UPLOAD_MB: z.coerce.number().int().min(1).max(4096).default(1024),
  KASHIER_MODE: z.enum(["test", "live"]).default("test"),
  KASHIER_MERCHANT_ID: z.string().optional(),
  KASHIER_API_KEY: z.string().optional(),
  KASHIER_SECRET_KEY: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map(issue => `- ${issue.path.join(".")}: ${issue.message}`).join("\n")}`);
}

const env = parsed.data;
const kashierValues = [env.KASHIER_MERCHANT_ID, env.KASHIER_API_KEY, env.KASHIER_SECRET_KEY];
if (kashierValues.some(Boolean) && !kashierValues.every(Boolean)) {
  throw new Error("Configure KASHIER_MERCHANT_ID, KASHIER_API_KEY, and KASHIER_SECRET_KEY together, or leave all blank.");
}

module.exports = {
  ...env,
  cookieSecure: env.COOKIE_SECURE === undefined ? env.NODE_ENV === "production" : env.COOKIE_SECURE === "true",
  uploadDirectory: path.resolve(process.cwd(), env.UPLOAD_DIR),
  kashierBaseUrl: env.KASHIER_MODE === "live" ? "https://api.kashier.io" : "https://test-api.kashier.io",
  paymentsEnabled: kashierValues.every(Boolean)
};
