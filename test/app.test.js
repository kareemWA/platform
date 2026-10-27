process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/math-learning-platform-test";
process.env.JWT_SECRET = "local-test-secret-that-is-at-least-thirty-two-characters";
process.env.WEB_ORIGIN = "http://localhost:3000";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const env = require("../server/config");
const { createApp } = require("../server/app");
const { ExamAttempt, ExamSession, ActivationCode, StudentActivity } = require("../server/models");
const { Payment } = require("../server/models");
const { publicUser } = require("../server/routes/auth");
const { calculateStudentRanking } = require("../server/lib/student-ranking");
const { getCurrentWeekActivity } = require("../server/lib/student-activity");
const { calculateCourseProgress, calculateOverallCourseProgress, mergeLessonProgress } = require("../server/lib/course-progress");

test("HTTP app serves only public frontend assets and protects API entry points", async () => {
  const server = createServer(createApp(env));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /dir="rtl"/);
    assert.match(homeHtml, /class="app-loading"/);
    assert.match(homeHtml, /جارٍ تجهيز المنصة/);
    assert.match(homeHtml, /src="\/teacher-portrait\.png"/);
    assert.match(homeHtml, /رقم الهاتف أو البريد الإلكتروني/);
    assert.match(homeHtml, /name="phoneNumber" type="text" inputmode="text" autocomplete="username" required/);
    const loginStart = homeHtml.indexOf('id="login-form"');
    const loginEnd = homeHtml.indexOf("</form>", loginStart);
    assert.notEqual(loginStart, -1);
    const loginForm = homeHtml.slice(loginStart, loginEnd);
    assert.doesNotMatch(loginForm, /pattern=/);
    assert.doesNotMatch(homeHtml, /data-view="plans"|id="view-plans"|الباقات/);
    assert.match(homeHtml, /data-course-category="class">كل الكورسات/);
    assert.match(homeHtml, /data-course-category="free">كورسات مجانية/);
    assert.match(homeHtml, /class="filter-button selected" data-course-category="mine">كورساتي/);
    assert.match(homeHtml, /id="view-payment-details"/);
    assert.equal(home.headers.get("content-security-policy") !== null, true);
    assert.match(home.headers.get("content-security-policy"), /connect-src[^;]*https:/);
    assert.match(home.headers.get("content-security-policy"), /frame-src[^;]*payments\.kashier\.io/);

    const watchStyles = await fetch(`${baseUrl}/watch.css`);
    const watchCss = await watchStyles.text();
    assert.equal(watchStyles.status, 200);
    assert.match(watchCss, /\.lesson-watch-layout/);
    assert.match(watchCss, /\.lesson-play-overlay/);

    const styles = await fetch(`${baseUrl}/styles.css?v=11`);
    const css = await styles.text();
    assert.equal(styles.status, 200);
    assert.match(css, /@media\(max-width:760px\)\{[^}]*\.header-actions \.button-primary\{display:inline-flex\}/);
    assert.match(css, /\.profile-layout\{grid-template-columns:minmax\(0,1fr\);gap:12px\}/);
    assert.match(css, /\.activation-code-form/);
    assert.match(css, /\.home-scroll-reveal #view-home \.home-reveal-item/);
    assert.match(css, /\.home-reveal-item\.is-visible/);
    assert.match(css, /@media\(max-width:760px\)\{#view-dashboard \.section-block/);
    assert.match(css, /\.dashboard-courses\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(css, /grid-template-areas:"course-count exam-count" "overall overall"/);
    assert.match(css, /\.dashboard-course-card \.course-art\{height:82px\}/);
    assert.match(css, /\.dashboard-courses\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(190px,230px\)\);justify-content:start/);

    const examStyles = await fetch(`${baseUrl}/exam-admin.css?v=1`);
    assert.equal(examStyles.status, 200);
    assert.match(await examStyles.text(), /\.exam-question-editor/);

    const teacherPortrait = await fetch(`${baseUrl}/teacher-portrait.png`);
    assert.equal(teacherPortrait.status, 200);
    assert.match(teacherPortrait.headers.get("content-type"), /image\/png/);

    const appBundle = await fetch(`${baseUrl}/app.js`);
    const appSource = await appBundle.text();
    assert.equal(appBundle.status, 200);
    assert.match(appSource, /lesson-duration-pill/);
    assert.match(appSource, /عرض الملف/);
    assert.doesNotMatch(appSource, /تنزيل PDF/);
    assert.match(appSource, /collectExamQuestions\(form\)/);
    assert.match(appSource, /data-answer-option/);
    assert.match(appSource, /data-action="confirm-payment"/);
    assert.match(appSource, /رقم هاتف ولي الأمر/);
    assert.match(appSource, /طالب سنتر/);
    assert.match(appSource, /state\.user\.studyType === "center" && !canLearn/);
    assert.match(appSource, /مخطط أيام المذاكرة/);
    assert.match(appSource, /const studyDays = weeklyActivity\.filter/);
    assert.match(appSource, /weeklyActivity/);
    assert.match(appSource, /dashboard-ranking-activity-row/);
    assert.match(appSource, /dashboard-courses/);
    assert.match(appSource, /dashboard-progress-arrow/);
    assert.match(appSource, /courses\.map\(row => courseCard\(\{ \.\.\.row\.course, enrolled: true \}, row\)\)/);
    assert.match(appSource, /<section class="dashboard-my-courses">/);
    assert.doesNotMatch(appSource, /class="dashboard-card dashboard-my-courses"/);
    assert.match(appSource, /dashboard-course-card/);
    assert.match(appSource, /\$\{progress\}\$\{action\}<\/div>/);
    assert.match(appSource, /aria-valuenow="\$\{percent\}"/);
    assert.match(appSource, /filtered\.map\(course => courseCard\(course\)\)/);
    assert.doesNotMatch(appSource, /filtered\.map\(courseCard\)/);
    assert.doesNotMatch(appSource, /عملية دفع مكتملة/);
    assert.match(appSource, /ترتيبك بين طلاب صفك/);
    assert.match(appSource, /أكمل بيانات صفك لعرض ترتيبك/);
    assert.match(appSource, /dashboard-loading/);
    assert.match(appSource, /ranking !== undefined/);
    assert.match(appSource, /api\("\/api\/dashboard\/ranking"\)/);
    assert.match(appSource, /async function renderDashboard\(\)[\s\S]*?if \(state\.flushLessonProgress\) await state\.flushLessonProgress\(\);[\s\S]*?api\("\/api\/dashboard"\)/);
    assert.match(appSource, /if \(state\.flushLessonProgress\) await state\.flushLessonProgress\(\);/);
    assert.match(appSource, /امتحن تاني/);
    assert.match(appSource, /exam\.latestAttempt\.score/);
    assert.match(appSource, /درجتك في آخر محاولة/);
    assert.match(appSource, /العودة للامتحانات وعرض الدرجة/);
    assert.match(appSource, /استنفدت محاولات هذا الامتحان/);
    assert.match(appSource, /attemptsRemaining/);
    assert.match(appSource, /new IntersectionObserver/);
    assert.match(appSource, /\.feature-grid > \*/);
    assert.match(appSource, /item\.classList\.add\("home-reveal-item"\)/);
    assert.match(appSource, /prefers-reduced-motion: reduce/);
    assert.match(appSource, /state\.activeCourseCategory === "mine"\s*\?\s*course\.enrolled/);
    assert.match(appSource, /state\.activeCourseCategory === "free"\s*\?\s*course\.isFree/);
    assert.match(appSource, /activeCourseCategory: "mine"/);
    assert.match(appSource, /if \(state\.myCoursesLoaded\)\s*\{\s*if \(!state\.myCourses\.length\) state\.activeCourseCategory = "class";\s*renderCourses\(\);\s*return;\s*\}/);
    assert.match(appSource, /state\.myCoursesLoaded = true/);
    assert.match(appSource, /state\.myCoursesLoaded = false/);
    assert.match(appSource, /if \(!state\.myCourses\.length\) state\.activeCourseCategory = "class"/);
    assert.match(appSource, /if \(state\.user && state\.user\.role !== "admin" && state\.activeCourseCategory === "mine"\) loadMyCourses\(\)/);
    assert.match(appSource, /String\(course\.grade\?\._id \|\| course\.grade \|\| ""\) === String\(state\.user\.grade \|\| ""\)/);
    assert.match(appSource, /api\("\/api\/courses\?mine=1"\)/);
    assert.match(appSource, /if \(state\.activeCourseCategory === "mine"\) await loadMyCourses\(\)/);
    assert.match(appSource, /تحقق/);
    assert.match(appSource, /\/api\/activation-codes\/redeem/);
    assert.match(appSource, /\/api\/admin\/activation-codes/);
    assert.match(appSource, /إشعار الدفع الموقّع من Kashier/);
    assert.match(appSource, /video-upload-form/);
    assert.match(appSource, /رفع الفيديو إلى قاعدة البيانات/);
    assert.match(appSource, /name="video" type="file" accept="video\/mp4,video\/webm,video\/ogg/);
    assert.match(appSource, /تم حفظ الدرس ورفع الفيديو من الجهاز إلى قاعدة البيانات/);
    assert.match(appSource, /api\("\/api\/admin\/dashboard"\)/);
    assert.doesNotMatch(appSource, /api\("\/api\/admin\/overview"\)/);
    assert.match(appSource, /summary=1/);
    assert.match(appSource, /api\("\/api\/bootstrap"\)/);
    assert.match(appSource, /Promise\.all\(\[getCsrf\(\), api\("\/api\/bootstrap"\)\]\)/);
    assert.match(appSource, /classList\.remove\("app-loading"\)/);
    assert.doesNotMatch(appSource, /Paymob/);
    assert.match(appSource, /async function redeemActivationCode\(form\)/);
    assert.match(appSource, /<button class="button button-primary" type="submit">تحقق<\/button>/);
    assert.match(appSource, /\$\{dashboardProgress \? "" : enrolled \? `<div class="course-enrolled-note">أنت مشترك في هذا الكورس<\/div>`/);
    assert.match(appSource, /\$\{canLearn \? `<div class="course-enrolled-note">أنت مشترك في هذا الكورس<\/div>` : `<div class="course-price-row">/);
    assert.doesNotMatch(appSource, /id="profile-form"|name="displayName".*profile/);
    assert.doesNotMatch(appSource, /الأسئلة بصيغة JSON/);

    const sourceLeak = await fetch(`${baseUrl}/server/app.js`);
    assert.equal(sourceLeak.status, 404);
    const packageLeak = await fetch(`${baseUrl}/package.json`);
    assert.equal(packageLeak.status, 404);
    const hlsPlayer = await fetch(`${baseUrl}/hls.min.js`);
    assert.equal(hlsPlayer.status, 200);
    assert.match(hlsPlayer.headers.get("content-type"), /javascript/);

    const unauthenticatedAdmin = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauthenticatedAdmin.status, 401);
    assert.equal(unauthenticatedAdmin.headers.get("cache-control"), "no-store");
    const unauthenticatedAdminDashboard = await fetch(`${baseUrl}/api/admin/dashboard`);
    assert.equal(unauthenticatedAdminDashboard.status, 401);
    const unauthenticatedStudentRanking = await fetch(`${baseUrl}/api/dashboard/ranking`);
    assert.equal(unauthenticatedStudentRanking.status, 401);
    const unauthenticatedMyExams = await fetch(`${baseUrl}/api/my-exams`);
    assert.equal(unauthenticatedMyExams.status, 401);

    const csrf = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrf.status, 200);
    assert.match(csrf.headers.get("set-cookie"), /platform_csrf=/);
    const mutationWithoutCsrf = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(mutationWithoutCsrf.status, 403);

    const disabledWebhook = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });

    assert.equal(disabledWebhook.status, 503);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("exam sessions and attempts have unique database guards", () => {
  const hasUniqueIndex = (model, key, partialField) => model.schema.indexes().some(([keys, options]) =>
    options.unique && keys[key] === 1 && options.partialFilterExpression?.[partialField] === null
  );
  assert.equal(hasUniqueIndex(ExamSession, "user", "submittedAt"), true);
  assert.equal(
    ExamAttempt.schema.indexes().some(([keys, options]) =>
      options.unique && keys.session === 1 && options.partialFilterExpression?.session?.$type === "objectId"
    ),
    true
  );
});

test("student weekly activity has one aggregate per user and day", () => {
  assert.equal(
    StudentActivity.schema.indexes().some(([keys, options]) =>
      options.unique && keys.user === 1 && keys.dateKey === 1
    ),
    true
  );
});

test("weekly activity always spans Sunday through Saturday and rolls over on Sunday", () => {
  const saturday = getCurrentWeekActivity(new Date("2026-10-31T12:00:00.000Z"));
  assert.equal(saturday.length, 7);
  assert.equal(saturday[0].dateKey, "2026-10-25");
  assert.equal(saturday[6].dateKey, "2026-10-31");
  const sunday = getCurrentWeekActivity(new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(sunday[0].dateKey, "2026-11-01");
  assert.equal(sunday[6].dateKey, "2026-11-07");
  assert.ok(sunday.every(day => day.watchedSeconds === 0));
});

test("student ranking combines lesson progress and best exam scores without exposing peers", () => {
  const ranking = calculateStudentRanking({
    studentIds: ["student-a", "student-b", "student-c"],
    currentStudentId: "student-a",
    enrollments: ["student-a", "student-b", "student-c"].map(user => ({ user, course: "course-a" })),
    lessons: [{ _id: "lesson-a", course: "course-a", durationMinutes: 1 }],
    progress: [
      { user: "student-a", lesson: "lesson-a", watchedSeconds: 48 },
      { user: "student-b", lesson: "lesson-a", watchedSeconds: 30 },
      { user: "student-c", lesson: "lesson-a", watchedSeconds: 30 }
    ],
    exams: [{ _id: "exam-a", course: "course-a" }],
    attempts: [
      { user: "student-a", exam: "exam-a", score: 20, maxScore: 100 },
      { user: "student-b", exam: "exam-a", score: 100, maxScore: 100 },
      { user: "student-c", exam: "exam-a", score: 100, maxScore: 100 }
    ]
  });

  assert.deepEqual(ranking, { rank: 3, total: 3 });
});

test("course progress averages each lesson and overall progress includes every course lesson", () => {
  const firstCourse = calculateCourseProgress([
    { _id: "long-lesson", durationMinutes: 10 },
    { _id: "short-lesson", durationMinutes: 1 }
  ], [
    { lesson: "long-lesson", watchedSeconds: 300, durationSeconds: 600 },
    { lesson: "short-lesson", watchedSeconds: 0, durationSeconds: 60 }
  ]);
  const secondCourse = calculateCourseProgress([
    { _id: "completed-lesson", durationMinutes: 5 }
  ], [{ lesson: "completed-lesson", watchedSeconds: 60, durationSeconds: 300, completedAt: new Date() }]);

  assert.equal(firstCourse.percent, 25);
  assert.equal(firstCourse.total, 2);
  assert.equal(firstCourse.completed, 0);
  assert.equal(secondCourse.percent, 100);
  assert.equal(calculateOverallCourseProgress([firstCourse, secondCourse]), 50);
  assert.equal(calculateOverallCourseProgress([]), 0);
});

test("saved lesson progress does not move backwards when playback position resets", () => {
  assert.deepEqual(
    mergeLessonProgress({ watchedSeconds: 52, durationSeconds: 100 }, { watchedSeconds: 0, durationSeconds: 0 }),
    { watchedSeconds: 52, durationSeconds: 100 }
  );
});

test("activation codes are hashed and cannot collide", () => {
  const codeHashPath = ActivationCode.schema.path("codeHash");
  assert.equal(codeHashPath.options.select, false);
  assert.equal(codeHashPath.options.unique, true);
  assert.equal(ActivationCode.schema.path("redeemedAt").options.default, null);
});

test("new payments default to Kashier while legacy Paymob records remain readable", () => {
  const provider = Payment.schema.path("provider");
  assert.equal(provider.options.default, "kashier");
  assert.deepEqual(provider.enumValues, ["paymob", "kashier"]);
});

test("MongoDB DNS resolver override is empty unless explicitly configured", () => {
  assert.deepEqual(env.MONGODB_DNS_SERVERS, []);
});

test("public profile includes the guardian phone and study type", () => {
  const user = publicUser({
    id: "student-id",
    displayName: "طالب",
    email: "student@example.test",
    role: "student",
    grade: "grade-id",
    phoneNumber: "+20123456789",
    parentPhoneNumber: "+20987654321",
    studyType: "center"
  });
  assert.equal(user.parentPhoneNumber, "+20987654321");
  assert.equal(user.studyType, "center");
});
