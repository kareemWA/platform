require("dotenv").config();

const os = require("node:os");
const path = require("node:path");

process.env.UPLOAD_DIR ||= path.join(os.tmpdir(), "math-learning-platform-uploads");

const env = require("../server/config");
const { connectDatabase } = require("../server/db");
const { createApp } = require("../server/app");

const app = createApp(env);
let databaseConnection;

module.exports = async function handler(req, res) {
  if (!databaseConnection) {
    databaseConnection = connectDatabase(env.MONGODB_URI).catch(error => {
      databaseConnection = undefined;
      throw error;
    });
  }
  await databaseConnection;
  return app(req, res);
};
