const { Enrollment } = require("../models");

async function hasCourseAccess(user, courseId) {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  const enrollment = await Enrollment.findOne({ user: user._id, course: courseId, status: "active" }).select("_id expiresAt").lean();
  return Boolean(enrollment && (!enrollment.expiresAt || enrollment.expiresAt > new Date()));
}

module.exports = { hasCourseAccess };
