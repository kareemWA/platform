require("dotenv").config();

const dns = require("node:dns");
const env = require("./config");
if (env.MONGODB_DNS_SERVERS.length) dns.setServers(env.MONGODB_DNS_SERVERS);
const { connectDatabase } = require("./db");
const { createApp } = require("./app");

async function start() {
  await connectDatabase(env.MONGODB_URI);
  const app = createApp(env);
  const server = app.listen(env.PORT, () => {
    console.log(`Learning platform listening on port ${env.PORT} (${env.NODE_ENV}).`);
  });
  const shutdown = async () => {
    server.close();
    await require("mongoose").disconnect();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch(error => {
  console.error("Failed to start the learning platform:", error);
  process.exitCode = 1;
});
