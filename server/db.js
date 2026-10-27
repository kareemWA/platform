const mongoose = require("mongoose");
const { ExamAttempt, ExamSession, ActivationCode } = require("./models");

async function connectDatabase(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const now = new Date();
  await ExamSession.updateMany(
    { submittedAt: null, expiresAt: { $lt: now } },
    { $set: { submittedAt: now } }
  );
  const duplicateSessions = await ExamSession.aggregate([
    { $match: { submittedAt: null } },
    { $sort: { startedAt: 1, _id: 1 } },
    { $group: { _id: { user: "$user", exam: "$exam" }, ids: { $push: "$_id" } } },
    { $match: { "ids.1": { $exists: true } } }
  ]);
  const duplicateIds = duplicateSessions.flatMap(group => group.ids.slice(1));
  if (duplicateIds.length) {
    await ExamSession.updateMany(
      { _id: { $in: duplicateIds }, submittedAt: null },
      { $set: { submittedAt: now } }
    );
  }
  await Promise.all([ExamSession.createIndexes(), ExamAttempt.createIndexes(), ActivationCode.createIndexes()]);
}

module.exports = { connectDatabase };
