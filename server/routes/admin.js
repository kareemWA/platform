const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const config = require("../config");
const { storeFile, deleteStoredFile } = require("../lib/gridfs");
const { calculateCourseProgress, calculateOverallCourseProgress } = require("../lib/course-progress");
const { User, Grade, Course, Lesson, Exam, ExamAttempt, Announcement, Enrollment, ActivationCode, Payment, Progress, AuditLog } = require("../models");
const { HttpError, asyncRoute, validate } = require("../lib/errors");

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const httpsUrl = z.string().url().refine(value => value.toLowerCase().startsWith("https://"), "يجب استخدام رابط HTTPS آمن.");
const examQuestion = z.object({
  prompt: z.string().trim().min(1).max(5000),
  type: z.enum(["multiple_choice", "true_false"]),
  options: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  correctAnswer: z.string().min(1).max(500),
  explanation: z.string().max(5000).optional(),
  points: z.number().int().min(1).max(100)
}).superRefine((question, context) => {
  if (question.type === "multiple_choice" &&
      (question.options.length < 2 || !question.options.includes(question.correctAnswer))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "سؤال الاختيار من متعدد يحتاج خيارين على الأقل وإجابة صحيحة من ضمنها." });
  }
  if (question.type === "true_false" && !["true", "false"].includes(question.correctAnswer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "الإجابة الصحيحة لسؤال الصح والخطأ يجب أن تكون true أو false." });
  }
});
const router = express.Router();

function audit(actor, action, targetType, targetId, details = {}) {
  return AuditLog.create({ actor: actor._id, action, targetType, targetId, details });
}

async function removeStoredMedia(storageName) {
  if (await deleteStoredFile(storageName)) return;
  await fs.rm(path.join(config.uploadDirectory, path.basename(storageName)), { force: true });
}

async function cleanupTemporaryFiles(files) {
  await Promise.all((files || []).map(file => fs.rm(file.path, { force: true })));
}

function courseInput(body) {
  return validate(z.object({
    title: z.string().trim().min(2).max(160),
    description: z.string().min(1).max(5000),
    imageUrl: z.union([httpsUrl, z.literal("")]).optional(),
    instructor: z.string().trim().min(2).max(120),
    grade: z.union([objectId, z.literal("")]).optional(),
    priceCents: z.number().int().min(0).max(100000000),
    isFree: z.boolean(),
    status: z.enum(["draft", "published", "hidden"]).optional(),
    featured: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
    durationMinutes: z.number().int().min(0).max(100000).optional()
  }), body);
}

async function validGrade(id) {
  if (id && !await Grade.exists({ _id: id })) throw new HttpError(400, "الصف الدراسي غير موجود.");
}

async function getStudentRoster(query) {
  const students = await User.find(query)
    .select("displayName email grade isActive createdAt")
    .populate("grade", "name")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  if (!students.length) return [];
  const enrollments = await Enrollment.find({ user: { $in: students.map(student => student._id) } })
    .select("user course status")
    .populate("course", "title")
    .lean();
  const enrollmentsByStudent = new Map();
  for (const enrollment of enrollments) {
    const key = String(enrollment.user);
    const rows = enrollmentsByStudent.get(key) || [];
    rows.push(enrollment);
    enrollmentsByStudent.set(key, rows);
  }
  return students.map(student => ({
    ...student,
    enrollments: enrollmentsByStudent.get(String(student._id)) || []
  }));
}

router.get("/overview", asyncRoute(async (_req, res) => {
  const [students, courses, enrollments, payments, pendingPayments, attempts] = await Promise.all([
    User.countDocuments({ role: "student" }), Course.countDocuments({ status: { $ne: "hidden" } }),
    Enrollment.countDocuments({ status: "active" }), Payment.countDocuments({ status: "paid" }),
    Payment.countDocuments({ status: "pending" }), require("../models").ExamAttempt.countDocuments()
  ]);
  res.json({ overview: { students, courses, enrollments, paidPayments: payments, pendingPayments, examAttempts: attempts } });
}));

router.get("/dashboard", asyncRoute(async (_req, res) => {
  const studentQuery = { role: "student" };
  const [
    studentsCount, coursesCount, enrollmentsCount, paidPayments, pendingPayments, examAttempts,
    courses, lessons, grades, students, announcements, payments, logs
  ] = await Promise.all([
    User.countDocuments({ role: "student" }),
    Course.countDocuments({ status: { $ne: "hidden" } }),
    Enrollment.countDocuments({ status: "active" }),
    Payment.countDocuments({ status: "paid" }),
    Payment.countDocuments({ status: "pending" }),
    ExamAttempt.countDocuments(),
    Course.find().populate("grade", "name").sort({ updatedAt: -1 }).lean(),
    Lesson.find().populate("course", "title").sort({ course: 1, position: 1 }).lean(),
    Grade.find().sort({ sortOrder: 1, name: 1 }).lean(),
    getStudentRoster(studentQuery),
    Announcement.find().populate("grade", "name").sort({ startsAt: -1 }).lean(),
    Payment.find().populate("user", "displayName email").populate("course", "title")
      .select("-checkoutUrl").sort({ createdAt: -1 }).limit(200).lean(),
    AuditLog.find().populate("actor", "displayName email").sort({ createdAt: -1 }).limit(10).lean()
  ]);
  res.json({
    overview: {
      students: studentsCount, courses: coursesCount, enrollments: enrollmentsCount,
      paidPayments, pendingPayments, examAttempts
    },
    courses, lessons, grades, students, announcements,
    attemptsCount: examAttempts, payments, logs
  });
}));

router.get("/grades", asyncRoute(async (_req, res) => res.json({ grades: await Grade.find().sort({ sortOrder: 1, name: 1 }).lean() })));
router.post("/grades", asyncRoute(async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(80), slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/), sortOrder: z.number().int().min(0).optional() }), req.body);
  const grade = await Grade.create(input);
  await audit(req.user, "grade.create", "Grade", grade._id);
  res.status(201).json({ grade });
}));
router.patch("/grades/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({ name: z.string().trim().min(2).max(80).optional(), slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(), sortOrder: z.number().int().min(0).optional(), active: z.boolean().optional() }), req.body);
  const grade = await Grade.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!grade) throw new HttpError(404, "الصف الدراسي غير موجود.");
  await audit(req.user, "grade.update", "Grade", grade._id);
  res.json({ grade });
}));

router.get("/courses", asyncRoute(async (_req, res) => {
  res.json({ courses: await Course.find().populate("grade", "name").sort({ updatedAt: -1 }).lean() });
}));
router.get("/lessons", asyncRoute(async (_req, res) => {
  res.json({ lessons: await Lesson.find().populate("course", "title").sort({ course: 1, position: 1 }).lean() });
}));
router.post("/courses", asyncRoute(async (req, res) => {
  const input = courseInput(req.body);
  await validGrade(input.grade);
  if (input.isFree && input.priceCents !== 0) throw new HttpError(400, "الكورس المجاني يجب أن يكون سعره صفرًا.");
  if (!input.isFree && input.priceCents < 1) throw new HttpError(400, "حدد سعرًا موجبًا للكورس المدفوع.");
  const course = await Course.create({ ...input, grade: input.grade || null, priceCents: input.isFree ? 0 : input.priceCents, createdBy: req.user._id });
  await audit(req.user, "course.create", "Course", course._id);
  res.status(201).json({ course });
}));
router.patch("/courses/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = courseInput(req.body);
  await validGrade(input.grade);
  if (input.isFree && input.priceCents !== 0) throw new HttpError(400, "الكورس المجاني يجب أن يكون سعره صفرًا.");
  if (!input.isFree && input.priceCents < 1) throw new HttpError(400, "حدد سعرًا موجبًا للكورس المدفوع.");
  const course = await Course.findByIdAndUpdate(id, { ...input, grade: input.grade || null, priceCents: input.isFree ? 0 : input.priceCents }, { new: true, runValidators: true });
  if (!course) throw new HttpError(404, "الكورس غير موجود.");
  await audit(req.user, "course.update", "Course", course._id);
  res.json({ course });
}));
router.delete("/courses/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const course = await Course.findById(id);
  if (!course) throw new HttpError(404, "الكورس غير موجود.");
  const hasHistory = await Enrollment.exists({ course: id }) || await Payment.exists({ course: id });
  if (hasHistory) {
    course.status = "hidden";
    await course.save();
  } else {
    const lessons = await Lesson.find({ course: id }).select("resources videoFile").lean();
    await Promise.all(lessons.flatMap(lesson => [
      ...lesson.resources.map(resource => removeStoredMedia(resource.storageName)),
      ...(lesson.videoFile ? [removeStoredMedia(lesson.videoFile.storageName)] : [])
    ]));
    await Promise.all([Lesson.deleteMany({ course: id }), Exam.deleteMany({ course: id }), Course.deleteOne({ _id: id })]);
  }
  await audit(req.user, hasHistory ? "course.hide" : "course.delete", "Course", course._id);
  res.status(204).end();
}));

router.post("/courses/:courseId/lessons", asyncRoute(async (req, res) => {
  const courseId = validate(objectId, req.params.courseId);
  if (!await Course.exists({ _id: courseId })) throw new HttpError(404, "الكورس غير موجود.");
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180), description: z.string().max(10000).optional(),
    videoUrl: z.union([httpsUrl, z.literal("")]).optional(),
    published: z.boolean().optional(), position: z.number().int().min(0).optional(),
    durationMinutes: z.number().int().min(0).max(100000).optional()
  }), req.body);
  const lesson = await Lesson.create({ ...input, course: courseId });
  await audit(req.user, "lesson.create", "Lesson", lesson._id, { courseId });
  res.status(201).json({ lesson });
}));
router.patch("/lessons/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180).optional(), description: z.string().max(10000).optional(),
    videoUrl: z.union([httpsUrl, z.literal("")]).optional(), published: z.boolean().optional(),
    position: z.number().int().min(0).optional(), durationMinutes: z.number().int().min(0).max(100000).optional()
  }), req.body);
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
  const previousVideoStorageName = input.videoUrl && lesson.videoFile ? lesson.videoFile.storageName : null;
  if (previousVideoStorageName) {
    lesson.videoFile = null;
  }
  Object.assign(lesson, input);
  await lesson.save();
  if (previousVideoStorageName) await deleteStoredFile(previousVideoStorageName);
  await audit(req.user, "lesson.update", "Lesson", lesson._id);
  res.json({ lesson });
}));
router.delete("/lessons/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
  for (const resource of lesson.resources) await removeStoredMedia(resource.storageName);
  if (lesson.videoFile) await removeStoredMedia(lesson.videoFile.storageName);
  await Promise.all([Lesson.deleteOne({ _id: id }), Exam.deleteMany({ lesson: id })]);
  await audit(req.user, "lesson.delete", "Lesson", id);
  res.status(204).end();
}));

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    try {
      const temporaryDirectory = path.join(config.uploadDirectory, ".tmp");
      await fs.mkdir(temporaryDirectory, { recursive: true });
      callback(null, temporaryDirectory);
    } catch (error) { callback(error); }
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== "application/pdf" || path.extname(file.originalname).toLowerCase() !== ".pdf") {
      return callback(new HttpError(400, "ارفع ملفات PDF فقط."));
    }
    callback(null, true);
  }
});
router.post("/lessons/:id/resources", upload.array("files", 10), asyncRoute(async (req, res) => {
  const files = req.files || [];
  const storedNames = [];
  let linked = false;
  try {
    const id = validate(objectId, req.params.id);
    const lesson = await Lesson.findById(id);
    if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
    if (!files.length) throw new HttpError(400, "أرفق ملف PDF واحدًا على الأقل.");
    const resources = [];
    for (const file of files) {
      const handle = await fs.open(file.path, "r");
      const signature = Buffer.alloc(5);
      try { await handle.read(signature, 0, 5, 0); }
      finally { await handle.close(); }
      if (signature.toString("ascii") !== "%PDF-") throw new HttpError(400, "أحد الملفات لا يحتوي على ترويسة PDF صالحة.");
      const storageName = await storeFile(
        file.path,
        path.basename(file.originalname.replace(/\\/g, "/")).slice(0, 180),
        "application/pdf",
        { lessonId: String(lesson._id), kind: "resource" }
      );
      storedNames.push(storageName);
      resources.push({
        name: path.basename(file.originalname.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
        storageName, mimeType: "application/pdf", size: file.size
      });
    }
    lesson.resources.push(...resources);
    await lesson.save();
    linked = true;
    await audit(req.user, "lesson.resources.add", "Lesson", lesson._id, { count: files.length, storage: "gridfs" });
    res.status(201).json({ resources: lesson.resources });
  } finally {
    await cleanupTemporaryFiles(files);
    if (!linked) await Promise.all(storedNames.map(deleteStoredFile));
  }
}));
router.delete("/lessons/:id/resources/:resourceId", asyncRoute(async (req, res) => {
  const lessonId = validate(objectId, req.params.id);
  const resourceId = validate(objectId, req.params.resourceId);
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
  const resource = lesson.resources.id(resourceId);
  if (!resource) throw new HttpError(404, "الملف غير موجود.");
  await removeStoredMedia(resource.storageName);
  resource.deleteOne();
  await lesson.save();
  await audit(req.user, "lesson.resource.delete", "Lesson", lesson._id);
  res.status(204).end();
}));

const videoMimeTypes = new Map([
  [".mp4", { mimeType: "video/mp4", signature: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp" }],
  [".webm", { mimeType: "video/webm", signature: buffer => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }],
  [".ogg", { mimeType: "video/ogg", signature: buffer => buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS" }]
]);
const uploadVideo = multer({
  storage,
  limits: { fileSize: config.MAX_VIDEO_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const type = videoMimeTypes.get(path.extname(file.originalname).toLowerCase());
    if (!type || (file.mimetype !== type.mimeType && file.mimetype !== "application/octet-stream")) {
      return callback(new HttpError(400, "صيغة الفيديو غير مدعومة. ارفع MP4 أو WebM أو OGG."));
    }
    callback(null, true);
  }
});
router.post("/lessons/:id/video", uploadVideo.single("video"), asyncRoute(async (req, res) => {
  const file = req.file;
  let storedName;
  let linked = false;
  try {
    const id = validate(objectId, req.params.id);
    const lesson = await Lesson.findById(id);
    if (!lesson) throw new HttpError(404, "الدرس غير موجود.");
    if (!file) throw new HttpError(400, "اختر ملف فيديو لرفعه.");
    const extension = path.extname(file.originalname).toLowerCase();
    const videoType = videoMimeTypes.get(extension);
    const handle = await fs.open(file.path, "r");
    const signature = Buffer.alloc(12);
    try { await handle.read(signature, 0, signature.length, 0); }
    finally { await handle.close(); }
    if (!videoType.signature(signature)) throw new HttpError(400, "محتوى الفيديو لا يطابق صيغة الملف.");
    storedName = await storeFile(
      file.path,
      path.basename(file.originalname.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
      videoType.mimeType,
      { lessonId: String(lesson._id), kind: "video" }
    );
    const previousStorageName = lesson.videoFile?.storageName;
    lesson.videoFile = {
      name: path.basename(file.originalname.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
      storageName: storedName,
      mimeType: videoType.mimeType,
      size: file.size
    };
    lesson.videoUrl = "";
    await lesson.save();
    linked = true;
    if (previousStorageName) await removeStoredMedia(previousStorageName);
    await audit(req.user, "lesson.video.upload", "Lesson", lesson._id, { size: file.size, storage: "gridfs" });
    res.status(201).json({ videoFile: lesson.videoFile });
  } finally {
    if (file) await cleanupTemporaryFiles([file]);
    if (storedName && !linked) await deleteStoredFile(storedName);
  }
}));

router.post("/exams", asyncRoute(async (req, res) => {
  const input = validate(z.object({
    course: objectId, lesson: objectId.optional(), title: z.string().trim().min(2).max(180),
    questions: z.array(examQuestion).min(1).max(200),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    maxAttempts: z.number().int().min(0).max(100).optional(),
    passPercent: z.number().min(0).max(100).optional(), revealAnswers: z.boolean().optional(), published: z.boolean().optional()
  }), req.body);
  if (!await Course.exists({ _id: input.course })) throw new HttpError(400, "الكورس غير موجود.");
  if (input.lesson && !await Lesson.exists({ _id: input.lesson, course: input.course })) throw new HttpError(400, "الدرس لا يتبع الكورس المحدد.");
  const exam = await Exam.create(input);
  await audit(req.user, "exam.create", "Exam", exam._id);
  res.status(201).json({ exam });
}));
router.patch("/exams/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180).optional(), published: z.boolean().optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    maxAttempts: z.number().int().min(0).max(100).optional(),
    passPercent: z.number().min(0).max(100).optional(), revealAnswers: z.boolean().optional(),
    questions: z.array(examQuestion).min(1).max(200).optional()
  }), req.body);
  const exam = await Exam.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!exam) throw new HttpError(404, "الامتحان غير موجود.");
  await audit(req.user, "exam.update", "Exam", exam._id);
  res.json({ exam });
}));
router.get("/attempts", asyncRoute(async (_req, res) => {
  const attempts = await require("../models").ExamAttempt.find().populate("user", "displayName email").populate("exam", "title").sort({ submittedAt: -1 }).limit(200).lean();
  res.json({ attempts });
}));

router.get("/announcements", asyncRoute(async (_req, res) => res.json({ announcements: await Announcement.find().populate("grade", "name").sort({ startsAt: -1 }).lean() })));
router.post("/announcements", asyncRoute(async (req, res) => {
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180), body: z.string().min(1).max(5000),
    imageUrl: z.union([httpsUrl, z.literal("")]).optional(), linkUrl: z.union([httpsUrl, z.literal("")]).optional(),
    startsAt: z.coerce.date(), endsAt: z.coerce.date(), active: z.boolean().optional(),
    audience: z.enum(["all", "subscribers", "grade"]), grade: objectId.optional()
  }), req.body);
  if (input.endsAt <= input.startsAt) throw new HttpError(400, "تاريخ نهاية الإعلان يجب أن يأتي بعد بدايته.");
  if (input.audience === "grade" && (!input.grade || !await Grade.exists({ _id: input.grade }))) throw new HttpError(400, "اختر الصف الدراسي المستهدف.");
  const announcement = await Announcement.create({ ...input, createdBy: req.user._id });
  await audit(req.user, "announcement.create", "Announcement", announcement._id);
  res.status(201).json({ announcement });
}));
router.patch("/announcements/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({
    title: z.string().trim().min(2).max(180).optional(), body: z.string().min(1).max(5000).optional(),
    imageUrl: z.union([httpsUrl, z.literal("")]).optional(), linkUrl: z.union([httpsUrl, z.literal("")]).optional(),
    startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), active: z.boolean().optional(),
    audience: z.enum(["all", "subscribers", "grade"]).optional(), grade: objectId.optional()
  }), req.body);
  const announcement = await Announcement.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!announcement) throw new HttpError(404, "الإعلان غير موجود.");
  if (announcement.endsAt <= announcement.startsAt) throw new HttpError(400, "تاريخ نهاية الإعلان يجب أن يأتي بعد بدايته.");
  await audit(req.user, "announcement.update", "Announcement", announcement._id);
  res.json({ announcement });
}));
router.delete("/announcements/:id", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  if (!await Announcement.findByIdAndDelete(id)) throw new HttpError(404, "الإعلان غير موجود.");
  await audit(req.user, "announcement.delete", "Announcement", id);
  res.status(204).end();
}));

router.get("/students", asyncRoute(async (req, res) => {
  const query = { role: "student" };
  if (req.query.q) {
    const term = String(req.query.q).trim().slice(0, 80);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [{ displayName: { $regex: escaped, $options: "i" } }, { email: { $regex: escaped, $options: "i" } }];
  }
  if (req.query.summary === "1") {
    return res.json({ students: await getStudentRoster(query) });
  }
  const students = await User.find(query).select("displayName email grade isActive createdAt").populate("grade", "name").sort({ createdAt: -1 }).limit(100).lean();
  const studentIds = students.map(user => user._id);
  const [enrollments, payments] = await Promise.all([
    Enrollment.find({ user: { $in: studentIds } }).populate("course", "title").lean(),
    Payment.find({ user: { $in: studentIds } }).populate("course", "title").select("-checkoutUrl").lean()
  ]);
  const activeCourseIds = [...new Set(enrollments.filter(row => row.status === "active" && row.course).map(row => String(row.course._id)))];
  const [lessons, progress] = await Promise.all([
    Lesson.find({ course: { $in: activeCourseIds }, published: true }).select("course durationMinutes").lean(),
    Progress.find({ user: { $in: studentIds }, course: { $in: activeCourseIds } }).select("user course lesson watchedSeconds durationSeconds completedAt").lean()
  ]);
  const progressByStudent = new Map();
  for (const item of progress) {
    if (!progressByStudent.has(String(item.user))) progressByStudent.set(String(item.user), new Map());
    progressByStudent.get(String(item.user)).set(String(item.lesson), item);
  }
  res.json({ students: students.map(student => ({
    ...student,
    enrollments: enrollments.filter(row => String(row.user) === String(student._id)),
    payments: payments.filter(row => String(row.user) === String(student._id)),
    progress: (() => {
      const studentEnrollments = enrollments.filter(row => String(row.user) === String(student._id) && row.status === "active" && row.course);
      const studentLessons = lessons.filter(lesson => studentEnrollments.some(row => String(row.course._id) === String(lesson.course)));
      const studentProgress = progressByStudent.get(String(student._id)) || new Map();
      const summary = calculateCourseProgress(studentLessons, [...studentProgress.values()]);
      return {
        percent: summary.percent,
        watchedSeconds: summary.watchedSeconds,
        durationSeconds: summary.durationSeconds,
        completed: summary.completed,
        total: summary.total
      };
    })()
  })) });
}));
router.get("/students/:id/details", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const student = await User.findOne({ _id: id, role: "student" }).select("displayName email phoneNumber parentPhoneNumber studyType grade isActive createdAt").populate("grade", "name").lean();
  if (!student) throw new HttpError(404, "حساب الطالب غير موجود.");
  const enrollments = await Enrollment.find({ user: id, status: "active" }).populate("course", "title instructor").lean();
  const courseIds = enrollments.filter(row => row.course).map(row => row.course._id);
  const [lessons, progress, exams, attempts] = await Promise.all([
    Lesson.find({ course: { $in: courseIds }, published: true }).select("course title description durationMinutes position").sort({ position: 1 }).lean(),
    Progress.find({ user: id, course: { $in: courseIds } }).select("course lesson watchedSeconds durationSeconds completedAt").lean(),
    Exam.find({ course: { $in: courseIds }, published: true }).select("course title maxAttempts passPercent").lean(),
    ExamAttempt.find({ user: id, course: { $in: courseIds } }).select("course exam score maxScore submittedAt").sort({ submittedAt: -1 }).lean()
  ]);
  const progressByLesson = new Map(progress.map(item => [String(item.lesson), item]));
  const attemptsByExam = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.exam);
    if (!attemptsByExam.has(key)) attemptsByExam.set(key, []);
    attemptsByExam.get(key).push({ score: attempt.score, maxScore: attempt.maxScore, percent: attempt.maxScore ? Math.round(attempt.score / attempt.maxScore * 100) : 0, submittedAt: attempt.submittedAt });
  }
  const courseDetails = enrollments.filter(row => row.course).map(row => {
    const courseLessons = lessons.filter(lesson => String(lesson.course) === String(row.course._id));
    const progressSummary = calculateCourseProgress(courseLessons, [...progressByLesson.values()]);
    const courseExams = exams.filter(exam => String(exam.course) === String(row.course._id)).map(exam => {
      const examAttempts = attemptsByExam.get(String(exam._id)) || [];
      return { ...exam, attempts: examAttempts, bestPercent: examAttempts.length ? Math.max(...examAttempts.map(attempt => attempt.percent)) : 0 };
    });
    return { course: row.course, enrollment: row, ...progressSummary, exams: courseExams };
  });
  const totalDurationSeconds = courseDetails.reduce((sum, row) => sum + row.durationSeconds, 0);
  const totalWatchedSeconds = courseDetails.reduce((sum, row) => sum + row.watchedSeconds, 0);
  const percent = calculateOverallCourseProgress(courseDetails);
  res.json({ student, progress: { percent, watchedSeconds: totalWatchedSeconds, durationSeconds: totalDurationSeconds }, courses: courseDetails });
}));
router.patch("/students/:id/status", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({ isActive: z.boolean() }), req.body);
  const student = await User.findOneAndUpdate({ _id: id, role: "student" }, { $set: { isActive: input.isActive }, $inc: { tokenVersion: 1 } }, { new: true }).select("displayName email isActive");
  if (!student) throw new HttpError(404, "حساب الطالب غير موجود.");
  await audit(req.user, input.isActive ? "student.activate" : "student.suspend", "User", id);
  res.json({ student });
}));
router.post("/students/:id/enrollments", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const input = validate(z.object({ course: objectId, expiresAt: z.coerce.date().optional() }), req.body);
  if (!await User.exists({ _id: id, role: "student" })) throw new HttpError(404, "حساب الطالب غير موجود.");
  if (!await Course.exists({ _id: input.course })) throw new HttpError(404, "الكورس غير موجود.");
  const enrollment = await Enrollment.findOneAndUpdate(
    { user: id, course: input.course },
    { $set: { status: "active", source: "admin", grantedBy: req.user._id, expiresAt: input.expiresAt || null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await audit(req.user, "enrollment.admin_grant", "Enrollment", enrollment._id, { studentId: id, courseId: input.course });
  res.status(201).json({ enrollment });
}));
router.delete("/students/:id/enrollments/:courseId", asyncRoute(async (req, res) => {
  const id = validate(objectId, req.params.id);
  const courseId = validate(objectId, req.params.courseId);
  const enrollment = await Enrollment.findOneAndUpdate({ user: id, course: courseId }, { $set: { status: "revoked" } }, { new: true });
  if (!enrollment) throw new HttpError(404, "الاشتراك غير موجود.");
  await audit(req.user, "enrollment.revoke", "Enrollment", enrollment._id, { studentId: id, courseId });
  res.json({ enrollment });
}));
router.post("/activation-codes", asyncRoute(async (req, res) => {
  const input = validate(z.object({ course: objectId }), req.body);
  const course = await Course.findById(input.course).select("title status");
  if (!course || course.status === "hidden") throw new HttpError(404, "الكورس غير موجود أو مخفي.");
  const code = crypto.randomBytes(9).toString("hex").toUpperCase();
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const activationCode = await ActivationCode.create({
    codeHash, course: course._id, createdBy: req.user._id
  });
  await audit(req.user, "activation_code.create", "ActivationCode", activationCode._id, { courseId: course._id });
  res.status(201).json({ code, course: { id: course.id, title: course.title } });
}));
router.get("/payments", asyncRoute(async (_req, res) => {
  const payments = await Payment.find().populate("user", "displayName email").populate("course", "title").select("-checkoutUrl").sort({ createdAt: -1 }).limit(200).lean();
  res.json({ payments });
}));
router.get("/audit-logs", asyncRoute(async (_req, res) => {
  const logs = await AuditLog.find().populate("actor", "displayName email").sort({ createdAt: -1 }).limit(200).lean();
  res.json({ logs });
}));

module.exports = { adminRoutes: router };
