const mongoose = require("mongoose");

const { Schema, model } = mongoose;

const userSchema = new Schema({
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
  phoneNumber: { type: String, default: "", trim: true, maxlength: 20 },
  parentPhoneNumber: { type: String, default: "", trim: true, maxlength: 20 },
  studyType: { type: String, enum: ["online", "center"], default: "online" },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["student", "admin"], default: "student", index: true },
  grade: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
  isActive: { type: Boolean, default: true },
  tokenVersion: { type: Number, default: 0 }
}, { timestamps: true });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } });
userSchema.index({ phoneNumber: 1 }, { unique: true, partialFilterExpression: { phoneNumber: { $type: "string", $gt: "" } } });

const gradeSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const courseSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, maxlength: 5000 },
  imageUrl: { type: String, default: "", maxlength: 1000 },
  instructor: { type: String, required: true, trim: true, maxlength: 120 },
  grade: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
  priceCents: { type: Number, required: true, min: 0 },
  isFree: { type: Boolean, default: false },
  currency: { type: String, default: "EGP", enum: ["EGP"] },
  status: { type: String, enum: ["draft", "published", "hidden"], default: "draft", index: true },
  featured: { type: Boolean, default: false },
  position: { type: Number, default: 0 },
  durationMinutes: { type: Number, default: 0, min: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

const resourceSchema = new Schema({
  name: { type: String, required: true },
  storageName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true }
}, { _id: true });

const videoFileSchema = new Schema({
  name: { type: String, required: true },
  storageName: { type: String, required: true },
  mimeType: { type: String, required: true, enum: ["video/mp4", "video/webm", "video/ogg"] },
  size: { type: Number, required: true }
}, { _id: false });

const lessonSchema = new Schema({
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, default: "", maxlength: 10000 },
  videoUrl: { type: String, default: "", maxlength: 1000 },
  videoFile: { type: videoFileSchema, default: null },
  resources: { type: [resourceSchema], default: [] },
  published: { type: Boolean, default: false },
  position: { type: Number, default: 0 },
  durationMinutes: { type: Number, default: 0, min: 0 }
}, { timestamps: true });
lessonSchema.index({ course: 1, position: 1 });

const questionSchema = new Schema({
  prompt: { type: String, required: true, maxlength: 5000 },
  type: { type: String, required: true, enum: ["multiple_choice", "true_false"] },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, required: true },
  explanation: { type: String, default: "", maxlength: 5000 },
  points: { type: Number, required: true, min: 1, max: 100 }
}, { _id: true });

const examSchema = new Schema({
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  lesson: { type: Schema.Types.ObjectId, ref: "Lesson", default: null, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  questions: { type: [questionSchema], default: [] },
  durationSeconds: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 0, min: 0, max: 100 },
  passPercent: { type: Number, default: 50, min: 0, max: 100 },
  revealAnswers: { type: Boolean, default: false },
  published: { type: Boolean, default: false }
}, { timestamps: true });

const enrollmentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  status: { type: String, enum: ["active", "revoked"], default: "active", index: true },
  source: { type: String, enum: ["free", "payment", "admin"], required: true },
  grantedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

const activationCodeSchema = new Schema({
  codeHash: { type: String, required: true, unique: true, select: false },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  redeemedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  redeemedAt: { type: Date, default: null }
}, { timestamps: true });
activationCodeSchema.index({ redeemedAt: 1 });

const paymentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  amountCents: { type: Number, required: true },
  currency: { type: String, default: "EGP", enum: ["EGP"] },
  status: { type: String, enum: ["pending", "paid", "failed"], default: "pending", index: true },
  provider: { type: String, enum: ["paymob", "kashier"], default: "kashier" },
  merchantOrderId: { type: String, required: true, unique: true },
  providerOrderId: { type: String, default: "" },
  providerTransactionId: { type: String, default: "" },
  checkoutUrl: { type: String, default: "" },
  paidAt: { type: Date, default: null }
}, { timestamps: true });
paymentSchema.index({ providerTransactionId: 1 }, { unique: true, sparse: true });

const announcementSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, maxlength: 5000 },
  imageUrl: { type: String, default: "", maxlength: 1000 },
  linkUrl: { type: String, default: "", maxlength: 1000 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  active: { type: Boolean, default: true },
  audience: { type: String, enum: ["all", "subscribers", "grade"], default: "subscribers" },
  grade: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
announcementSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

const progressSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  lesson: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
  watchedSeconds: { type: Number, default: 0, min: 0 },
  durationSeconds: { type: Number, default: 0, min: 0 },
  completedAt: { type: Date, default: null }
}, { timestamps: true });
progressSchema.index({ user: 1, lesson: 1 }, { unique: true });

const studentActivitySchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  watchedSeconds: { type: Number, default: 0, min: 0 },
  completedLessons: { type: Number, default: 0, min: 0 }
});
studentActivitySchema.index({ user: 1, dateKey: 1 }, { unique: true });

const attemptSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
  session: { type: Schema.Types.ObjectId, ref: "ExamSession" },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  answers: [{ question: Schema.Types.ObjectId, answer: String }],
  score: { type: Number, required: true },
  maxScore: { type: Number, required: true },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });
attemptSchema.index({ user: 1, exam: 1, submittedAt: -1 });
attemptSchema.index({ session: 1 }, { unique: true, partialFilterExpression: { session: { $type: "objectId" } } });
attemptSchema.set("autoIndex", false);

const examSessionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null }
}, { timestamps: true });
examSessionSchema.index({ user: 1, exam: 1 }, {
  unique: true,
  partialFilterExpression: { submittedAt: null }
});
examSessionSchema.set("autoIndex", false);

const auditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 100 },
  targetType: { type: String, required: true, maxlength: 80 },
  targetId: { type: Schema.Types.ObjectId, default: null },
  details: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = {
  User: model("User", userSchema),
  Grade: model("Grade", gradeSchema),
  Course: model("Course", courseSchema),
  Lesson: model("Lesson", lessonSchema),
  Exam: model("Exam", examSchema),
  Enrollment: model("Enrollment", enrollmentSchema),
  ActivationCode: model("ActivationCode", activationCodeSchema),
  Payment: model("Payment", paymentSchema),
  Announcement: model("Announcement", announcementSchema),
  Progress: model("Progress", progressSchema),
  StudentActivity: model("StudentActivity", studentActivitySchema),
  ExamAttempt: model("ExamAttempt", attemptSchema),
  ExamSession: model("ExamSession", examSessionSchema),
  AuditLog: model("AuditLog", auditSchema)
};
