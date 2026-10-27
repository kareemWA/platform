require("dotenv").config();

const dns = require("node:dns");
const net = require("node:net");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { z } = require("zod");
const { User } = require("../models");

const dnsServers = (process.env.MONGODB_DNS_SERVERS || "").split(",").map(value => value.trim()).filter(Boolean);
if (dnsServers.some(server => net.isIP(server) === 0)) {
  throw new Error("MONGODB_DNS_SERVERS must contain only DNS server IP addresses.");
}
if (dnsServers.length) dns.setServers(dnsServers);

async function main() {
  const input = z.object({
    MONGODB_URI: z.string().min(1),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(14).max(128)
  }).parse(process.env);
  await mongoose.connect(input.MONGODB_URI);
  const email = input.ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing && existing.role !== "admin") throw new Error("That email already belongs to a student; choose a different admin email.");
  if (existing) throw new Error("An administrator already exists with this email.");
  await User.create({
    displayName: "مدير المنصة", email,
    passwordHash: await bcrypt.hash(input.ADMIN_PASSWORD, 12),
    role: "admin"
  });
  console.log(`Administrator created: ${email}`);
}

main().catch(error => {
  console.error("Administrator setup failed:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
