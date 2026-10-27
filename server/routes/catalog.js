const express = require("express");
const crypto = require("node:crypto");
const { z } = require("zod");
const { User, Course, Grade, Lesson, Enrollment, ActivationCode, Progress, StudentActivity, Exam, ExamAttempt, ExamSession, Announcement, Payment } = require("../models");
const { HttpError, asyncRoute, validate } = require("../lib/errors");
const { hasCourseAccess } = require("../lib/access");
const { calculateStudentRanking } = require("../lib/student-ranking");
const { getCurrentWeekActivity } = require("../lib/student-activity");
const { calculateCourseProgress, calculateOverallCourseProgress, mergeLessonProgress } = require("../lib/course-progress");

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const catalogRoutes = express.Router();

async function getStudentRanking(user) {
  const gradeId = user.grade?._id || user.grade;
  if (!gradeId) return null;
  const students = await User.find({ role: "student", isActive: true, grade: gradeId }).select("_id").lean();
  const studentIdsById = new Map(students.map(student => [String(student._id), student._id]));
  studentIdsById.set(String(user._id), user._id);
  const studentIds = [...studentIdsById.values()];
  const enrollments = await Enrollment.find({
    user: { $in: studentIds },
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  }).select("user course").lean();
  const courseIds = [...new Set(enrollments.map(row => String(row.course)))];
  const [lessons, progress, exams, attempts] = await Promise.all([
    Lesson.find({ course: { $in: courseIds }, published: true }).select("_id course durationMinutes").lean(),
    Progress.find({ user: { $in: studentIds }, course: { $in: courseIds } }).select("user lesson watchedSeconds durationSeconds completedAt").lean(),
    Exam.find({ course: { $in: courseIds }, published: true }).select("_id course").lean(),
    ExamAttempt.find({ user: { $in: studentIds }, course: { $in: courseIds } }).select("user exam score maxScore").lean()
  ]);
  return calculateStudentRanking({
    studentIds,
    currentStudentId: user._id,
    enrollments,
    lessons,
    progress,
    exams,
    attempts
  });
}

async function getCatalogCourses(req) {
  const query = { status: "published" };
  const mineOnly = req.query.mine === "1";
  let activeEnrollments = [];
  if (mineOnly) {
    if (!req.user || req.user.role !== "student") throw new HttpError(401, "سجّل الدخول لعرض كورساتك.");
    activeEnrollments = await Enrollment.find({
      user: req.user._id,
      status: "active",
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    }).select("course").lean();
    const enrolledCourseIds = activeEnrollments.map(row => row.course);
    if (!enrolledCourseIds.length) return [];
    query._id = { $in: enrolledCourseIds };
  } else {
    const studentGrade = req.user && req.user.role !== "admin" ? req.user.grade : null;
    if (studentGrade) query.grade = studentGrade;
    else if (req.user && req.user.role !== "admin") return [];
    else if (req.query.grade) query.grade = validate(objectIdSchema, req.query.grade);
  }
  if (req.query.q) {
    const search = String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(search, "i");
    query.$or = [{ title: pattern }, { description: pattern }, { instructor: pattern }];
  }
  const courses = await Course.find(query).populate("grade", "name slug").sort({ featured: -1, position: 1, createdAt: -1 }).limit(100).lean();
  const courseIds = courses.map(course => course._id);
  const [counts, enrollmentCounts, enrollments] = await Promise.all([
    Lesson.aggregate([
      { $match: { course: { $in: courseIds }, published: true } },
      { $group: { _id: "$course", count: { $sum: 1 } } }
    ]),
    Enrollment.aggregate([
      { $match: { course: { $in: courseIds }, status: "active", $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] } },
      { $group: { _id: "$course", count: { $sum: 1 } } }
    ]),
    mineOnly ? activeEnrollments : req.user ? Enrollment.find({
      user: req.user._id, status: "active",
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    }).select("course").lean() : []
  ]);
  const countByCourse = new Map(counts.map(item => [String(item._id), item.count]));
  const enrollmentsByCourse = new Map(enrollmentCounts.map(item => [String(item._id), item.count]));
  const enrolledIds = new Set(enrollments.map(row => String(row.course)));
  return courses.map(course => ({
    ...course,
    lessonCount: countByCourse.get(String(course._id)) || 0,
    enrollmentCount: enrollmentsByCourse.get(String(course._id)) || 0,
    enrolled: enrolledIds.has(String(course._id))
  }));
}

function publicLesson(lesson) {
  const { resources, videoFile, videoUrl, ...safeLesson } = lesson;
  return {
    ...safeLesson,
    videoUrl: videoFile ? `/api/videos/${encodeURIComponent(String(lesson._id))}` : videoUrl,
    resources: resources.map(({ _id, name, mimeType, size }) => ({ _id, name, mimeType, size }))
  };
}

catalogRoutes.get("/grades", asyncRoute(async (_req, res) => {
  const grades = await Grade.find({ active: true }).sort({ sortOrder: 1, name: 1 }).select("name slug sortOrder");
  res.json({ grades });
}));

catalogRoutes.get("/courses", asyncRoute(async (req, res) => {
  res.json({ courses: await getCatalogCourses(req) });
}));

catalogRoutes.get("/courses/:id", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const course = await Course.findOne({ _id: id, status: "published" }).populate("grade", "name slug").lean();
  if (!course) throw new HttpError(404, "الكورس غير موجود.");
  if (req.user && req.user.role !== "admin" && String(course.grade?._id || course.grade || "") !== String(req.user.grade || "")) {
    throw new HttpError(404, "الكورس غير موجود.");
  }
  const lessons = await Lesson.find({ course: id, published: true }).sort({ position: 1 }).select("title position durationMinutes").lean();
  res.json({ course: { ...course, lessonCount: lessons.length }, lessons });
}));

catalogRoutes.post("/activation-codes/redeem", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجّل الدخول أولًا.");
  if (req.user.role !== "student" || req.user.studyType !== "center") {
    throw new HttpError(403, "أكواد الاشتراك مخصصة لطلاب السنتر فقط.");
  }
  const input = validate(z.object({ code: z.string().trim().min(1).max(40) }), req.body);
  const codeHash = crypto.createHash("sha256").update(input.code.toUpperCase()).digest("hex");
  const codeRecord = await ActivationCode.findOne({ codeHash, redeemedAt: null }).select("+codeHash");
  if (!codeRecord) throw new HttpError(400, "كود الاشتراك غير صحيح أو مستخدم من قبل.");
  if (await Enrollment.exists({
    user: req.user._id, course: codeRecord.course, status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  })) throw new HttpError(409, "لديك اشتراك فعال في هذا الكورس بالفعل.");
  const redeemed = await ActivationCode.findOneAndUpdate(
    { _id: codeRecord._id, redeemedAt: null },
    { $set: { redeemedBy: req.user._id, redeemedAt: new Date() } },
    { new: true }
  );
  if (!redeemed) throw new HttpError(400, "كود الاشتراك غير صحيح أو مستخدم من قبل.");
  const enrollment = await Enrollment.findOneAndUpdate(
    { user: req.user._id, course: codeRecord.course },
    { $set: { status: "active", source: "admin", grantedBy: codeRecord.createdBy, expiresAt: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ enrollment });
}));

catalogRoutes.get("/courses/:id/content", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const course = await Course.findById(id).lean();
  if (!course) throw new HttpError(404, "الكورس غير موجود.");
  if (!await hasCourseAccess(req.user, id)) throw new HttpError(req.user ? 403 : 401, "سجّل الدخول وامتلك اشتراكًا فعالًا للوصول إلى محتوى الكورس.");
  const lessons = await Lesson.find({ course: id, published: true }).sort({ position: 1 }).select("title description videoUrl videoFile position durationMinutes resources").lean();
  const enrollment = await Enrollment.findOne({
    user: req.user._id, course: id, status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  }).select("source expiresAt createdAt").lean();
  const progress = await Progress.find({ user: req.user._id, course: id }).select("lesson watchedSeconds durationSeconds completedAt").lean();
  res.json({ course, enrollment, lessons: lessons.map(publicLesson), progress });
}));

catalogRoutes.get("/lessons/:id", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const lesson = await Lesson.findOne({ _id: id, published: true }).lean();
  if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
  const course = await Course.findById(lesson.course).lean();
  if (!course || !await hasCourseAccess(req.user, course._id)) throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية مشاهدة هذا الدرس.");
  const [exams, progress] = await Promise.all([
    Exam.find({ lesson: lesson._id, published: true }).select("title durationSeconds passPercent").lean(),
    Progress.findOne({ user: req.user._id, lesson: lesson._id }).select("watchedSeconds durationSeconds completedAt").lean()
  ]);
  res.json({
    lesson: publicLesson(lesson),
    exams,
    progress
  });
}));

catalogRoutes.post("/lessons/:id/progress", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const lesson = await Lesson.findOne({ _id: id, published: true }).select("course");
  if (!lesson || !await hasCourseAccess(req.user, lesson.course)) throw new HttpError(403, "لا تملك صلاحية تحديث تقدم هذا الدرس.");
  const input = validate(z.object({
    watchedSeconds: z.number().int().min(0).max(86400).optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    completed: z.boolean().optional()
  }).refine(value => value.watchedSeconds !== undefined || value.durationSeconds !== undefined || value.completed === true, "لا يوجد تقدم صالح للحفظ."), req.body);
  const previousProgress = await Progress.findOne({ user: req.user._id, lesson: lesson._id }).select("watchedSeconds durationSeconds completedAt").lean();
  const { watchedSeconds, durationSeconds } = mergeLessonProgress(previousProgress, input);
  const activity = {
    watchedSeconds: watchedSeconds === undefined
      ? 0
      : Math.max(0, watchedSeconds - Number(previousProgress?.watchedSeconds || 0)),
    completedLessons: input.completed && !previousProgress?.completedAt ? 1 : 0
  };
  const updates = {};
  if (watchedSeconds !== undefined) updates.watchedSeconds = watchedSeconds;
  if (durationSeconds !== undefined) updates.durationSeconds = durationSeconds;
  if (input.completed) updates.completedAt = new Date();
  const progress = await Progress.findOneAndUpdate(
    { user: req.user._id, lesson: lesson._id },
    { $set: updates, $setOnInsert: { user: req.user._id, course: lesson.course, lesson: lesson._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (activity.watchedSeconds || activity.completedLessons) {
    const dateKey = new Date().toISOString().slice(0, 10);
    await StudentActivity.updateOne(
      { user: req.user._id, dateKey },
      { $inc: activity, $setOnInsert: { user: req.user._id, dateKey } },
      { upsert: true }
    );
  }
  res.json({ progress });
}));

catalogRoutes.get("/announcements", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجل الدخول لعرض الإعلانات.");
  res.json({ announcements: await visibleAnnouncements(req.user) });
}));

async function visibleAnnouncements(user) {
  const now = new Date();
  const enrollments = await Enrollment.find({
    user: user._id, status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).select("course").lean();
  const courseGrades = await Course.find({ _id: { $in: enrollments.map(row => row.course) } }).select("grade").lean();
  const gradeIds = [...new Set([user.grade, ...courseGrades.map(row => row.grade)].filter(Boolean).map(String))];
  const audience = [{ audience: "all" }];
  if (enrollments.length) audience.push({ audience: "subscribers" });
  if (gradeIds.length) audience.push({ audience: "grade", grade: { $in: gradeIds } });
  return Announcement.find({
    active: true, startsAt: { $lte: now }, endsAt: { $gte: now },
    $or: audience
  }).select("title body imageUrl linkUrl startsAt endsAt").sort({ startsAt: -1 }).limit(20).lean();
}

catalogRoutes.get("/bootstrap", asyncRoute(async (req, res) => {
  const [grades, courses, announcements] = await Promise.all([
    Grade.find({ active: true }).sort({ sortOrder: 1, name: 1 }).select("name slug sortOrder").lean(),
    getCatalogCourses(req),
    req.user ? visibleAnnouncements(req.user) : []
  ]);
  const user = req.user ? {
    id: req.user.id,
    displayName: req.user.displayName,
    email: req.user.email?.endsWith("@students.local") ? "" : req.user.email || "",
    role: req.user.role,
    grade: req.user.grade || null,
    phoneNumber: req.user.phoneNumber || "",
    parentPhoneNumber: req.user.parentPhoneNumber || "",
    studyType: req.user.studyType || "online"
  } : null;
  res.json({ user, grades, courses, announcements });
}));

catalogRoutes.get("/dashboard/ranking", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجل الدخول لعرض ترتيبك.");
  res.json({ ranking: await getStudentRanking(req.user) });
}));

catalogRoutes.get("/dashboard", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجل الدخول لعرض لوحة الطالب.");
  const enrollments = await Enrollment.find({
    user: req.user._id, status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  }).populate({ path: "course", populate: { path: "grade", select: "name" } }).lean();
  const courses = enrollments.map(row => row.course).filter(Boolean);
  const weeklyActivity = getCurrentWeekActivity();
  const [lessons, progress, attempts, payments, activityRows, announcements] = await Promise.all([
    Lesson.find({ course: { $in: courses.map(course => course._id) }, published: true }).select("course durationMinutes").lean(),
    Progress.find({ user: req.user._id, course: { $in: courses.map(course => course._id) } }).select("lesson course watchedSeconds durationSeconds completedAt").lean(),
    ExamAttempt.find({ user: req.user._id }).populate("exam", "title").sort({ submittedAt: -1 }).limit(20).lean(),
    Payment.find({ user: req.user._id }).select("-checkoutUrl -providerTransactionId").populate("course", "title").sort({ createdAt: -1 }).limit(20).lean(),
    StudentActivity.find({
      user: req.user._id,
      dateKey: { $gte: weeklyActivity[0].dateKey, $lte: weeklyActivity[6].dateKey }
    }).select("dateKey watchedSeconds completedLessons").lean(),
    visibleAnnouncements(req.user)
  ]);
  const activityByDate = new Map(activityRows.map(row => [row.dateKey, row]));
  for (const day of weeklyActivity) {
    const activity = activityByDate.get(day.dateKey);
    if (activity) {
      day.watchedSeconds = activity.watchedSeconds;
      day.completedLessons = activity.completedLessons;
    }
  }
  const progressByLesson = new Map(progress.map(item => [String(item.lesson), item]));
  const courseRows = courses.map(course => {
    const courseLessons = lessons.filter(lesson => String(lesson.course) === String(course._id));
    const progressSummary = calculateCourseProgress(courseLessons, [...progressByLesson.values()]);
    return {
      course,
      completed: progressSummary.completed,
      total: progressSummary.total,
      watchedSeconds: progressSummary.watchedSeconds,
      durationSeconds: progressSummary.durationSeconds,
      percent: progressSummary.percent
    };
  });
  const overallDurationSeconds = courseRows.reduce((sum, row) => sum + row.durationSeconds, 0);
  const overallWatchedSeconds = courseRows.reduce((sum, row) => sum + row.watchedSeconds, 0);
  const overallPercent = calculateOverallCourseProgress(courseRows);
  res.json({ courses: courseRows, overall: { percent: overallPercent, watchedSeconds: overallWatchedSeconds, durationSeconds: overallDurationSeconds }, weeklyActivity, attempts, payments, announcements });
}));

catalogRoutes.get("/my-exams", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجل الدخول أولًا.");
  const enrollmentRows = await Enrollment.find({
    user: req.user._id, status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  }).select("course").lean();
  const exams = await Exam.find({ course: { $in: enrollmentRows.map(row => row.course) }, published: true })
    .populate("course", "title").populate("lesson", "title").select("-questions.correctAnswer -questions.explanation")
    .sort({ createdAt: -1 }).lean();
  const examIds = exams.map(exam => exam._id);
  const now = new Date();
  const [attempts, activeSessions] = await Promise.all([
    ExamAttempt.find({ user: req.user._id, exam: { $in: examIds } })
      .select("exam score maxScore submittedAt").sort({ submittedAt: -1 }).lean(),
    ExamSession.find({ user: req.user._id, exam: { $in: examIds }, submittedAt: null, expiresAt: { $gte: now } })
      .select("exam").lean()
  ]);
  const attemptsByExam = new Map();
  attempts.forEach(attempt => {
    const key = String(attempt.exam);
    const rows = attemptsByExam.get(key) || [];
    rows.push(attempt);
    attemptsByExam.set(key, rows);
  });
  const activeExamIds = new Set(activeSessions.map(session => String(session.exam)));
  res.json({ exams: exams.map(exam => {
    const examAttempts = attemptsByExam.get(String(exam._id)) || [];
    return {
      ...exam,
      attemptCount: examAttempts.length,
      latestAttempt: examAttempts[0] || null,
      attemptsRemaining: exam.maxAttempts > 0 ? Math.max(0, exam.maxAttempts - examAttempts.length) : null,
      hasActiveSession: activeExamIds.has(String(exam._id))
    };
  }) });
}));

catalogRoutes.get("/results", asyncRoute(async (req, res) => {
  if (!req.user) throw new HttpError(401, "سجل الدخول أولًا.");
  const attempts = await ExamAttempt.find({ user: req.user._id }).populate("exam", "title").populate("course", "title").sort({ submittedAt: -1 }).limit(100).lean();
  res.json({ attempts });
}));

catalogRoutes.get("/exams/:id", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const exam = await Exam.findOne({ _id: id, published: true }).lean();
  if (!exam || !await hasCourseAccess(req.user, exam.course)) throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية دخول هذا الامتحان.");
  res.json({ exam: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) } });
}));

catalogRoutes.post("/exams/:id/start", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const exam = await Exam.findOne({ _id: id, published: true }).lean();
  if (!exam || !await hasCourseAccess(req.user, exam.course)) throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية دخول هذا الامتحان.");
  const now = new Date();
  const sessionFilter = { user: req.user._id, exam: exam._id, submittedAt: null, expiresAt: { $gte: now } };
  const activeSession = await ExamSession.findOne(sessionFilter);
  if (activeSession) {
    return res.json({
      sessionId: activeSession.id, startedAt: activeSession.startedAt, expiresAt: activeSession.expiresAt,
      exam: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) }
    });
  }
  await ExamSession.updateMany(
    { user: req.user._id, exam: exam._id, submittedAt: null, expiresAt: { $lt: now } },
    { $set: { submittedAt: now } }
  );
  if (exam.maxAttempts > 0 && await ExamAttempt.countDocuments({ user: req.user._id, exam: exam._id }) >= exam.maxAttempts) {
    throw new HttpError(409, "وصلت إلى الحد الأقصى لمحاولات هذا الامتحان.");
  }
  const startedAt = now;
  const expiresAt = exam.durationSeconds ? new Date(startedAt.getTime() + exam.durationSeconds * 1000) : new Date("9999-12-31T23:59:59.999Z");
  let session;
  try {
    session = await ExamSession.create({ user: req.user._id, exam: exam._id, course: exam.course, startedAt, expiresAt });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    session = await ExamSession.findOne(sessionFilter);
    if (!session) throw error;
    return res.json({
      sessionId: session.id, startedAt: session.startedAt, expiresAt: session.expiresAt,
      exam: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) }
    });
  }
  res.status(201).json({
    sessionId: session.id, startedAt: session.startedAt, expiresAt: session.expiresAt,
    exam: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) }
  });
}));

catalogRoutes.post("/exams/:id/attempts", asyncRoute(async (req, res) => {
  const id = validate(objectIdSchema, req.params.id);
  const input = validate(z.object({
    sessionId: objectIdSchema,
    answers: z.array(z.object({ questionId: objectIdSchema, answer: z.string().max(500) })).max(200)
  }), req.body);
  const exam = await Exam.findOne({ _id: id, published: true }).lean();
  if (!exam || !await hasCourseAccess(req.user, exam.course)) throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية دخول هذا الامتحان.");
  if (exam.maxAttempts > 0 && await ExamAttempt.countDocuments({ user: req.user._id, exam: exam._id }) >= exam.maxAttempts) {
    throw new HttpError(409, "وصلت إلى الحد الأقصى لمحاولات هذا الامتحان.");
  }
  const answerMap = new Map(input.answers.map(item => [item.questionId, item.answer]));
  if (answerMap.size !== input.answers.length) throw new HttpError(400, "أُرسلت إجابة مكررة للسؤال نفسه.");
  const questionIds = new Set(exam.questions.map(question => String(question._id)));
  if ([...answerMap.keys()].some(questionId => !questionIds.has(questionId))) throw new HttpError(400, "تتضمن الإجابات سؤالًا لا يتبع هذا الامتحان.");
  for (const question of exam.questions) {
    const answer = answerMap.get(String(question._id));
    if (answer === undefined) continue;
    const allowed = question.type === "true_false" ? ["true", "false"] : question.options;
    if (!allowed.includes(answer)) throw new HttpError(400, "تتضمن الإجابات اختيارًا غير متاح.");
  }
  const maxScore = exam.questions.reduce((sum, question) => sum + question.points, 0);
  const score = exam.questions.reduce((sum, question) => sum + (answerMap.get(String(question._id)) === question.correctAnswer ? question.points : 0), 0);
  const session = await ExamSession.findOne({
    _id: input.sessionId, user: req.user._id, exam: exam._id, submittedAt: null, expiresAt: { $gte: new Date() }
  });
  if (!session) throw new HttpError(409, "انتهى وقت الامتحان أو تم تسليم هذه المحاولة من قبل.");
  let attempt;
  try {
    attempt = await ExamAttempt.create({
      user: req.user._id, exam: exam._id, session: session._id, course: exam.course,
      answers: input.answers.map(item => ({ question: item.questionId, answer: item.answer })),
      score, maxScore
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    attempt = await ExamAttempt.findOne({ session: session._id });
    if (!attempt) throw error;
  }
  await ExamSession.updateOne(
    { _id: session._id, submittedAt: null },
    { $set: { submittedAt: new Date() } }
  );
  res.status(201).json({
    attempt: { id: attempt.id, score, maxScore, passed: maxScore ? score / maxScore * 100 >= exam.passPercent : false },
    ...(exam.revealAnswers ? { review: exam.questions.map(question => ({ questionId: question._id, correctAnswer: question.correctAnswer, explanation: question.explanation })) } : {})
  });
}));

module.exports = { catalogRoutes };
