const state = {
  user: null,
  courses: [],
  myCourses: [],
  myCoursesLoaded: false,
  grades: [],
  activeFilter: "الكل",
  activeCourseCategory: "mine",
  activeCourseId: null,
  lessonIds: [],
  csrf: null,
  toastTimer: null,
  examTimer: null,
  examQuestionSequence: 0,
  returnCourseId: null,
  paymentCourseId: null,
  hlsPlayer: null,
  lessonList: [],
  lessonProgress: [],
  completedLessonIds: [],
  flushLessonProgress: null,
  activationCode: null,
  signupStep: 1,
  weeklyActivityTimer: null
};

const toast = document.getElementById("toast");
const views = [...document.querySelectorAll(".view")];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const courseId = course => String(course?._id || course?.id || "");
function courseProgressPercent(lessons, progressRows) {
  const progressByLesson = new Map(progressRows.map(row => [String(row.lesson), row]));
  const percentages = lessons.map(lesson => {
    const progress = progressByLesson.get(String(lesson._id));
    const duration = Number(progress?.durationSeconds) || Number(lesson.durationMinutes || 0) * 60;
    const watched = Math.min(Number(progress?.watchedSeconds) || 0, duration || Number(progress?.watchedSeconds) || 0);
    return duration
      ? Math.round((progress?.completedAt ? duration : watched) / duration * 100)
      : progress?.completedAt ? 100 : 0;
  });
  return percentages.length ? Math.round(percentages.reduce((sum, percent) => sum + percent, 0) / percentages.length) : 0;
}
function updateCourseProgressDisplay(percent) {
  const progressLabel = document.querySelector(".lesson-playlist-progress strong");
  const progressTrack = document.querySelector(".lesson-course-progress-track i");
  if (progressLabel) progressLabel.textContent = `${percent.toLocaleString("ar-EG")}٪`;
  if (progressTrack) progressTrack.style.width = `${percent}%`;
}
function stopLessonStream() {
  const player = document.getElementById("lesson-video");
  if (player && !player.paused) player.pause();
  if (!state.hlsPlayer) return;
  state.hlsPlayer.destroy();
  state.hlsPlayer = null;
}

async function loadMyCourses() {
  if (state.myCoursesLoaded) {
    if (!state.myCourses.length) state.activeCourseCategory = "class";
    renderCourses();
    return;
  }
  try {
    const data = await api("/api/courses?mine=1");
    state.myCourses = data.courses;
    state.myCoursesLoaded = true;
    if (!state.myCourses.length) state.activeCourseCategory = "class";
    renderCourses();
  } catch (error) {
    notify(`تعذر تحميل كورساتك: ${error.message}`);
  }
}

function initializeHomepageReveal() {
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const items = [...document.querySelectorAll([
    "#view-home > .hero > *",
    "#view-home > .hero .hero-copy > *",
    "#view-home > .hero .hero-art > *",
    "#view-home > .stats-strip > *",
    "#view-home > .section-block > *",
    "#view-home .grade-grid > *",
    "#view-home .feature-grid > *",
    "#view-home > .teacher-preview > *",
    "#view-home .teacher-copy > *",
    "#view-home > .cta-section > *"
  ].join(", "))];
  document.body.classList.add("home-scroll-reveal");
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });
  items.forEach((item, index) => {
    item.classList.add("home-reveal-item");
    item.style.setProperty("--reveal-delay", `${index % 4 * 70}ms`);
    observer.observe(item);
  });
}

const priceText = course => course.isFree ? "مجاني" : new Intl.NumberFormat("ar-EG", {
  style: "currency", currency: course.currency || "EGP", maximumFractionDigits: 2
}).format((course.priceCents || 0) / 100);

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

async function getCsrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("تعذر تجهيز اتصال آمن بالخادم.");
  const data = await response.json();
  state.csrf = data.csrfToken;
}

async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!state.csrf) await getCsrf();
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(url, { ...options, method, headers, credentials: "same-origin" });
  if (response.status === 204) return null;
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("أعاد الخادم استجابة غير صالحة."); }
  if (!response.ok) {
    const error = new Error(payload.error || "تعذر إكمال الطلب.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showView(name, updateHash = true) {
  const view = document.getElementById(`view-${name}`);
  if (!view) return;
  if (name !== "lesson") stopLessonStream();
  views.forEach(item => item.classList.toggle("active", item === view));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.view === name));
  document.querySelector(".main-nav").classList.remove("open");
  document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
  document.title = `${view.dataset.title} | منصة بشمهندس إسماعيل أحمد`;
  if (updateHash && location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "courses") {
    renderCourses();
    if (state.user && state.user.role !== "admin" && state.activeCourseCategory === "mine") loadMyCourses();
  }
  if (name === "dashboard") renderDashboard();
  if (name === "exams") renderExams();
  if (name === "results") renderResults();
  if (name === "profile") renderProfile();
  if (name === "admin") renderAdmin();
}

function setFieldError(form, name, message = "") {
  const field = form.elements[name];
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (field?.setAttribute) field.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function validateSignupStep(form, step) {
  const phonePattern = /^\+?[0-9\s()-]{8,20}$/;
  let valid = true;
  const check = (name, condition, message) => { setFieldError(form, name, condition ? "" : message); valid = valid && condition; };
  if (step === 1) {
    const name = form.elements.displayName.value.trim();
    check("displayName", /^[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+){3}$/.test(name), "اكتب الاسم الرباعي باللغة العربية.");
    check("phoneNumber", phonePattern.test(form.elements.phoneNumber.value.trim()), "أدخل رقم هاتف صحيحًا.");
    check("parentPhoneNumber", phonePattern.test(form.elements.parentPhoneNumber.value.trim()), "أدخل رقم هاتف ولي الأمر صحيحًا.");
  } else if (step === 2) {
    check("grade", Boolean(form.elements.grade.value), "اختر الصف الدراسي.");
    check("studyType", Boolean(form.querySelector("input[name='studyType']:checked")), "اختر نوع الدراسة.");
  } else {
    const password = form.elements.password.value;
    check("password", password.length >= 10, "كلمة المرور يجب أن تكون 10 أحرف على الأقل.");
    check("confirmPassword", password === form.elements.confirmPassword.value && Boolean(password), "كلمتا المرور غير متطابقتين.");
  }
  return valid;
}

function setSignupStep(step) {
  const form = document.getElementById("signup-form");
  if (!form) return;
  state.signupStep = Math.max(1, Math.min(3, step));
  form.querySelectorAll("[data-signup-step]").forEach(fieldset => { fieldset.hidden = Number(fieldset.dataset.signupStep) !== state.signupStep; });
  form.querySelectorAll("[data-step-indicator]").forEach(indicator => indicator.classList.toggle("active", Number(indicator.dataset.stepIndicator) <= state.signupStep));
  document.getElementById("signup-step-label").textContent = `المرحلة ${state.signupStep} من 3`;
  form.querySelector("[data-signup-prev]").hidden = state.signupStep === 1;
  form.querySelector("[data-signup-next]").hidden = state.signupStep === 3;
  form.querySelector("[data-signup-submit]").hidden = state.signupStep !== 3;
}

function initializeSignupForm() {
  const select = document.querySelector("#signup-form select[name='grade']");
  if (!select) return;
  select.innerHTML = `<option value="">اختر الصف الدراسي</option>${state.grades.map(grade => `<option value="${escapeHtml(grade._id)}">${escapeHtml(grade.name)}</option>`).join("")}`;
  setSignupStep(1);
}

function restoreRoute(route) {
  if (route === "course" && state.activeCourseId) return openCourse(state.activeCourseId);
  if (route === "lesson" && state.lessonIds.length) return openLesson(state.lessonIds[0]);
  if (route === "payment-details") return showPaymentDetails(state.paymentCourseId || sessionStorage.getItem("pending-payment-course"), false);
  if (route === "payment-return") return renderPaymentReturn();
  if (document.getElementById(`view-${route}`)) showView(route, false);
}

function updateIdentity() {
  document.querySelectorAll(".auth-only").forEach(element => element.classList.toggle("hidden", !state.user));
  document.querySelectorAll(".admin-only").forEach(element => element.classList.toggle("hidden", state.user?.role !== "admin"));
  document.querySelectorAll("[data-action='login'],[data-action='signup']").forEach(element => element.classList.toggle("hidden", Boolean(state.user)));
  document.querySelectorAll("[data-action='logout']").forEach(element => element.classList.toggle("hidden", !state.user));
  if (state.user?.role === "admin") document.querySelectorAll(".auth-only").forEach(element => element.classList.remove("hidden"));
}

function courseCard(course, dashboardProgress = null) {
  const id = courseId(course);
  const grade = typeof course.grade === "object" ? course.grade?.name : "";
  const image = course.imageUrl ? `<img src="${escapeHtml(course.imageUrl)}" alt="" loading="lazy">` : `<span class="art-symbol">${escapeHtml(grade || "∑")}</span>`;
  const enrolled = state.user && course.enrolled;
  const percent = dashboardProgress ? Math.max(0, Math.min(100, Number(dashboardProgress.percent) || 0)) : 0;
  const progress = dashboardProgress ? `<div class="dashboard-course-progress-info"><div class="dashboard-course-progress-label"><span>${Number(dashboardProgress.completed)} من ${Number(dashboardProgress.total)} درس</span><strong>${percent.toLocaleString("ar-EG")}٪</strong></div><div class="dashboard-course-progress" role="progressbar" aria-label="التقدم في ${escapeHtml(course.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i><span class="dashboard-progress-arrow" style="right:${percent}%" aria-hidden="true">←</span></div></div>` : "";
  const action = dashboardProgress
    ? `<button class="button button-primary full-width" data-action="course-content" data-course="${escapeHtml(id)}">متابعة التعلم <span aria-hidden="true">←</span></button>`
    : `<button class="button button-outline full-width" data-course="${escapeHtml(id)}">${enrolled ? "متابعة التعلم" : "تفاصيل الكورس"} <span>←</span></button>`;
  return `<article class="course-card${dashboardProgress ? " dashboard-course-card" : ""}">
    <div class="course-art ${escapeHtml(course.artClass || "art-blue")}">${image}<span class="grade-tag">${escapeHtml(grade || course.instructor)}</span></div>
    <div class="course-info"><h3>${escapeHtml(course.title)}</h3>
    <p>${escapeHtml(course.description)}</p>
    ${dashboardProgress ? "" : enrolled ? `<div class="course-enrolled-note">أنت مشترك في هذا الكورس</div>` : `<div class="course-price-row"><strong>${priceText(course)}</strong><span>${course.isFree ? "كورس مجاني" : "شراء مرة واحدة"}</span></div>`}
    ${progress}${action}</div>
  </article>`;
}

function visibleCourses() {
  if (!state.user || state.user.role === "admin") return state.courses;
  return state.courses.filter(course =>
    String(course.grade?._id || course.grade || "") === String(state.user.grade || "")
  );
}

async function loadCourses() {
  try {
    const data = await api("/api/courses");
    state.courses = data.courses;
    state.myCoursesLoaded = false;
    renderCourses();
    renderHomeCourses();
    return true;
  } catch (error) {
    if (error.message.includes("رقم هاتفك")) {
      notify(error.message);
      showView("profile");
      return false;
    }
    notify(`تعذر تحميل الكورسات: ${error.message}`);
    return false;
  }
}

function renderHomeCourses() {
  const gradeGrid = document.getElementById("grade-grid");
  if (!gradeGrid) return;
  const grades = state.user && state.user.role !== "admin"
    ? state.grades.filter(grade => String(grade._id) === String(state.user.grade))
    : state.grades;
  gradeGrid.innerHTML = grades.map((grade, index) =>
  `<button class="grade-card grade-${["one", "two", "three"][index % 3]}" data-grade="${escapeHtml(grade.name)}"><span class="grade-number">${String(index + 1).padStart(2, "0")}</span><span class="grade-symbol">${["x²", "π", "∑"][index % 3]}</span><span class="grade-content"><small>المرحلة الثانوية</small><strong>${escapeHtml(grade.name)}</strong><span>كورسات الصف</span></span><span class="round-arrow">←</span></button>`
  ).join("");
}

function renderCourses() {
  const container = document.getElementById("course-grid");
  if (!container) return;
  const isStudent = state.user && state.user.role !== "admin";
  const studentGrade = state.grades.find(grade => String(grade._id) === String(state.user?.grade));
  document.querySelector(".course-categories").hidden = !isStudent;
  document.querySelectorAll(".filter-button").forEach(button => {
    if (button.hasAttribute("data-course-category")) {
      button.hidden = !isStudent;
      button.classList.toggle("selected", button.dataset.courseCategory === state.activeCourseCategory);
    } else {
      button.hidden = Boolean(isStudent);
      if (button.dataset.filter === "الكل") button.textContent = "كل الصفوف";
      button.classList.toggle("selected", button.dataset.filter === state.activeFilter);
    }
  });
  if (isStudent) state.activeFilter = "الكل";
  else state.activeCourseCategory = "class";
  const term = document.getElementById("course-search").value.trim().toLocaleLowerCase("ar");
  const categoryCourses = state.activeCourseCategory === "mine" ? state.myCourses : visibleCourses();
  const filtered = categoryCourses.filter(course => {
    const grade = typeof course.grade === "object" ? course.grade?.name : "";
    const matchesCategory = state.activeCourseCategory === "mine"
      ? course.enrolled
      : state.activeCourseCategory === "free"
        ? course.isFree
        : true;
    return matchesCategory && (state.activeFilter === "الكل" || grade === state.activeFilter) &&
      `${course.title} ${course.instructor} ${course.description} ${grade}`.toLocaleLowerCase("ar").includes(term);
  });
  container.innerHTML = filtered.map(course => courseCard(course)).join("");
  const emptyState = document.getElementById("course-empty");
  emptyState.classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    if (isStudent && !studentGrade) {
      emptyState.querySelector("strong").textContent = "اختر صفك الدراسي أولًا";
      emptyState.querySelector("p").textContent = "حدّث صفك من الملف الشخصي لعرض كورساته.";
    } else if (state.activeCourseCategory === "mine") {
      emptyState.querySelector("strong").textContent = "لا توجد كورسات في اشتراكك بعد";
      emptyState.querySelector("p").textContent = "تصفّح كورسات صفك واختر كورسًا للبدء.";
    } else if (state.activeCourseCategory === "free") {
      emptyState.querySelector("strong").textContent = "لا توجد كورسات مجانية حاليًا";
      emptyState.querySelector("p").textContent = "جرّب تصنيفًا آخر أو عد لاحقًا.";
    } else {
      emptyState.querySelector("strong").textContent = "لا توجد كورسات";
      emptyState.querySelector("p").textContent = "جرّب كلمة بحث أخرى.";
    }
  }
}

async function openCourse(id) {
  state.activeCourseId = id;
  try {
    const { course, lessons } = await api(`/api/courses/${encodeURIComponent(id)}`);
    const gradeName = typeof course.grade === "object" ? course.grade?.name : "";
    const canLearn = state.user && state.courses.some(item => courseId(item) === id && item.enrolled);
    document.getElementById("course-detail").innerHTML = `
      <div class="course-detail-head"><div><button class="back-link" data-view="courses">← رجوع للكورسات</button>
      <h1>${escapeHtml(course.title)}</h1><p class="section-intro">${escapeHtml(course.description)}</p></div><span class="page-hero-art">∑</span></div>
      <div class="course-detail-layout"><div class="course-overview"><h2>دروس الكورس</h2>
      ${lessons.length ? lessons.map((lesson, index) => `<div class="lesson-row"><span class="lesson-num">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(lesson.title)}</strong><small>${Number(lesson.durationMinutes || 0)} دقيقة</small></span></div>`).join("") : `<p>سيُضاف محتوى هذا الكورس قريبًا.</p>`}
      </div><aside class="course-side-card"><h3>${escapeHtml(course.title)}</h3><p>${escapeHtml(gradeName)} · ${Number(course.lessonCount || lessons.length)} درس · ${escapeHtml(course.instructor)}</p>
      ${canLearn ? `<div class="course-enrolled-note">أنت مشترك في هذا الكورس</div>` : `<div class="course-price-row"><strong>${priceText(course)}</strong><span>${course.isFree ? "مجاني" : "مدفوع"}</span></div>`}
      <button class="button button-primary full-width" data-action="${canLearn ? "course-content" : "enroll-course"}" data-course="${escapeHtml(id)}">${canLearn ? "متابعة التعلم" : course.isFree ? "الالتحاق بالكورس" : "اشترك الآن"} <span>←</span></button>
      ${state.user?.role === "student" && state.user.studyType === "center" && !canLearn ? `<form class="activation-code-form" id="redeem-code-form" data-course="${escapeHtml(id)}"><label for="activation-code-input">لديك كود اشتراك؟</label><small>أدخل الكود الذي استلمته من السنتر لتفعيل الكورس.</small><div><input id="activation-code-input" name="code" autocomplete="off" maxlength="40" required placeholder="مثال: A1B2C3D4"><button class="button button-primary" type="submit">تحقق</button></div></form>` : ""}</aside></div>`;
      
    showView("course");
  } catch (error) {
    notify(error.message);
  }
}

async function enrollCourse(id) {
  if (!state.user) {
    state.returnCourseId = id;
    initializeSignupForm();
    showView("signup");
    return;
  }

  const course = state.courses.find(item => courseId(item) === id);
  if (course && !course.isFree) {
    await showPaymentDetails(id);
    return;
  }
  await startCourseEnrollment(id);
}

async function redeemActivationCode(form) {
  const button = form.querySelector("[type='submit']");
  button.disabled = true;
  try {
    await api("/api/activation-codes/redeem", {
      method: "POST",
      body: JSON.stringify({ code: form.elements.code.value.trim() })
    });
    notify("تم تفعيل اشتراكك في الكورس.");
    if (await loadCourses()) await openCourse(form.dataset.course);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

async function showPaymentDetails(id, updateHash = true) {
  if (!id) {
    showView("courses", updateHash);
    return;
  }
  if (!state.user) {
    state.returnCourseId = id;
    showView("login", updateHash);
    return;
  }
  try {
    let course = state.courses.find(item => courseId(item) === id);
    if (!course) {
      const result = await api(`/api/courses/${encodeURIComponent(id)}`);
      course = result.course;
    }
    if (course.isFree) {
      await startCourseEnrollment(id);
      return;
    }
    state.paymentCourseId = id;
    sessionStorage.setItem("pending-payment-course", id);
    document.getElementById("payment-details-content").innerHTML = `
      <div class="payment-details-card">
        <button class="back-link" data-view="courses">← رجوع للكورسات</button>
        <span class="section-kicker">مراجعة الطلب</span>
        <h1 class="page-title">تفاصيل الدفع</h1>
        <p class="section-intro">راجع بيانات الكورس والمبلغ قبل الانتقال إلى بوابة الدفع الآمنة.</p>
        <div class="payment-summary">
          <div><span>الكورس</span><strong>${escapeHtml(course.title)}</strong></div>
          <div><span>الصف الدراسي</span><strong>${escapeHtml(typeof course.grade === "object" ? course.grade?.name : course.grade || "—")}</strong></div>
          <div><span>اسم الطالب</span><strong>${escapeHtml(state.user?.displayName || "—")}</strong></div>
          <div><span>رقم الهاتف</span><strong>${escapeHtml(state.user?.phoneNumber || "غير مضاف")}</strong></div>
          <div class="payment-total"><span>إجمالي المبلغ</span><strong>${escapeHtml(priceText(course))}</strong></div>
        </div>
        <div class="notice-box payment-notice"><span class="notice-icon">ⓘ</span><div><strong>الدفع الإلكتروني الآمن</strong><p>سيتم تحويلك إلى بوابة الدفع لإتمام العملية. لن يُفتح الكورس إلا بعد تأكيد الدفع.</p></div></div>
        <div class="payment-actions"><button class="button button-outline" data-view="courses">إلغاء</button><button class="button button-primary" data-action="confirm-payment">المتابعة إلى الدفع <span>←</span></button></div>
      </div>`;
    showView("payment-details", updateHash);
  } catch (error) {
    notify(error.message);
    showView("courses");
  }
}

async function startCourseEnrollment(id = state.paymentCourseId || sessionStorage.getItem("pending-payment-course")) {
  if (!id) {
    notify("تعذر تحديد الكورس المطلوب للدفع.");
    showView("courses");
    return;
  }
  try {
    const result = await api(`/api/checkout/${encodeURIComponent(id)}`, { method: "POST", body: "{}" });
    if (result.checkoutUrl) {
      sessionStorage.setItem("pending-merchant-order", result.merchantOrderId);
      location.assign(result.checkoutUrl);
      return;
    }
    sessionStorage.removeItem("pending-payment-course");
    state.paymentCourseId = null;
    await loadCourses();
    notify("تم الالتحاق بالكورس.");
    await openCourseContent(id);
  } catch (error) {
    if (error.status === 401) showView("login");
    else notify(error.message);
  }
}

async function openCourseContent(id) {
  if (!state.user) return showView("login");
  try {
    stopLessonStream();
    if (state.flushLessonProgress) await state.flushLessonProgress();
    const { course, lessons, progress } = await api(`/api/courses/${encodeURIComponent(id)}/content`);
    state.activeCourseId = id;
    state.lessonIds = lessons.map(lesson => String(lesson._id));
    state.lessonList = lessons;
    state.lessonProgress = progress;
    state.completedLessonIds = progress.filter(row => row.completedAt).map(row => String(row.lesson));
    const completed = new Set(state.completedLessonIds);
    document.getElementById("course-detail").innerHTML = `
      <div class="course-detail-head"><div><button class="back-link" data-view="dashboard">← العودة للوحة الطالب</button><div class="section-kicker">محتوى مشترك به</div><h1>${escapeHtml(course.title)}</h1></div></div>
      <div class="course-overview"><h2>الدروس</h2>${lessons.length ? lessons.map((lesson, index) => `<div class="lesson-row"><span class="lesson-num">${completed.has(String(lesson._id)) ? "✓" : String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(lesson.title)}</strong><small>${Number(lesson.durationMinutes || 0)} دقيقة</small></span><button data-lesson="${escapeHtml(lesson._id)}">فتح الدرس</button></div>`).join("") : "<p>لا توجد دروس منشورة بعد.</p>"}</div>`;
    showView("course");
  } catch (error) {
    notify(error.message);
    if (error.status === 401) showView("login");
  }
}

async function openLesson(id) {
  try {
    stopLessonStream();
    if (state.flushLessonProgress) await state.flushLessonProgress();
    const { lesson, exams, progress } = await api(`/api/lessons/${encodeURIComponent(id)}`);
    if (String(lesson.course) !== String(state.activeCourseId)) {
      state.activeCourseId = String(lesson.course);
      state.lessonList = [];
      state.completedLessonIds = [];
      state.lessonIds = [];
    }
    const index = state.lessonIds.indexOf(id);
    const existingProgress = state.lessonProgress.find(row => String(row.lesson) === String(id));
    if (existingProgress) Object.assign(existingProgress, progress || {});
    else if (progress) state.lessonProgress.push({ ...progress, lesson: id });
    const coursePercent = courseProgressPercent(state.lessonList, state.lessonProgress);
    const files = lesson.resources.map(resource => `<a class="lesson-file-link" href="/api/files/${encodeURIComponent(id)}/${encodeURIComponent(resource._id)}" target="_blank" rel="noopener noreferrer"><span class="lesson-file-icon" aria-hidden="true">PDF</span><span class="lesson-file-name"><strong>${escapeHtml(resource.name)}</strong></span><span class="lesson-file-open">عرض الملف <span aria-hidden="true">↗</span></span></a>`).join("");
    const video = lesson.videoUrl
      ? `<video class="lesson-video" id="lesson-video" controls playsinline preload="metadata" src="${escapeHtml(lesson.videoUrl)}">المتصفح لا يدعم تشغيل الفيديو.</video><button class="lesson-play-overlay" id="lesson-play-overlay" type="button" aria-label="تشغيل الفيديو"><span class="lesson-play-overlay-icon" aria-hidden="true">▶</span></button></span>`
      : `<div class="lesson-player-empty"><strong>الفيديو قريبًا</strong><span>لم يُضف فيديو لهذا الدرس بعد.</span></div>`;
    const lessonOutline = state.lessonList.length
      ? state.lessonList.map((item, itemIndex) => {
        const itemId = String(item._id);
        const isCompleted = state.completedLessonIds.includes(itemId);
        return `<button class="lesson-playlist-item${itemId === String(id) ? " is-current" : ""}" data-lesson="${escapeHtml(itemId)}" ${itemId === String(id) ? 'aria-current="step"' : ""}><span class="lesson-playlist-number">${isCompleted ? "✓" : String(itemIndex + 1).padStart(2, "0")}</span><span class="lesson-playlist-copy"><strong>${escapeHtml(item.title)}</strong><small>${Number(item.durationMinutes || 0)} دقيقة</small></span><span class="lesson-playlist-state">${itemId === String(id) ? "تشاهد الآن" : isCompleted ? "مكتمل" : "مشاهدة"}</span></button>`;
      }).join("")
      : `<div class="lesson-playlist-item is-current" aria-current="step"><span class="lesson-playlist-number">01</span><span class="lesson-playlist-copy"><strong>${escapeHtml(lesson.title)}</strong><small>${Number(lesson.durationMinutes || 0)} دقيقة</small></span><span class="lesson-playlist-state">تشاهد الآن</span></div>`;
    document.getElementById("lesson-detail").innerHTML = `
      <div class="lesson-watch-page">
        <div class="lesson-watch-toolbar"><button class="lesson-back-button" data-course-content="${escapeHtml(String(lesson.course))}"><span aria-hidden="true">→</span> العودة للكورس</button><span aria-hidden="true"></span> الدرس ${index >= 0 ? String(index + 1).padStart(2, "0") : "01"}</span></div>
        <header class="lesson-watch-heading"><div><span class="lesson-watch-eyebrow"><span><h1>${escapeHtml(lesson.title)}</h1></div></header>
        <div class="lesson-layout lesson-watch-layout">
          <main class="lesson-main lesson-watch-main">
            <section class="lesson-player-card" aria-label="مشغل الفيديو">
              <div class="lesson-player-topbar"><span class="lesson-player-format">جودة المصدر الأصلية</span></div>
              <div class="lesson-player-screen">${video}<p class="video-progress" id="video-progress" role="status" aria-live="polite"></p></div>
              <div class="lesson-player-footer"><span class="lesson-player-footer-icon">▶</span><span class="lesson-player-progress-chip">${progress?.completedAt ? "مكتمل ✓" : progress?.watchedSeconds ? "استكمال المشاهدة" : "ابدأ المشاهدة"}</span></div>
            </section>
            <section class="lesson-description-card"><span class="lesson-section-kicker">عن الدرس</span><h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(lesson.description || "شاهد الفيديو وسجّل أهم النقاط لمراجعتها بعد انتهاء الدرس.")}</p></section>
            <div class="lesson-material-grid">
              <section class="lesson-material-card"><div class="lesson-material-heading"><span class="lesson-material-icon">▤</span><div><strong>ملفات الدرس</strong></div></div><div class="lesson-material-content">${files || "<p>لا توجد ملفات مرفقة بهذا الدرس بعد.</p>"}</div></section>
              <section class="lesson-material-card"><div class="lesson-material-heading"><span class="lesson-material-icon lesson-exam-icon">✓</span><div><strong>تدريب سريع</strong></div></div><div class="lesson-material-content">${exams.length ? exams.map(exam => `<button class="lesson-exam-link" data-exam="${escapeHtml(exam._id)}">${escapeHtml(exam.title)} <span>ابدأ التدريب ←</span></button>`).join("") : "<p>لا يوجد تدريب مرتبط بهذا الدرس بعد.</p>"}</div></section>
            </div>
            <nav class="lesson-nav lesson-watch-nav" aria-label="التنقل بين الدروس"><button class="button button-outline" data-action="lesson-prev" data-index="${index - 1}" ${index <= 0 ? "disabled" : ""}>← الدرس السابق</button><button class="button button-primary" data-action="complete-lesson" data-lesson="${escapeHtml(id)}">${progress?.completedAt ? "الدرس مكتمل ✓" : "تحديد الدرس كمكتمل"}</button><button class="button button-outline" data-action="lesson-next" data-index="${index + 1}" ${index < 0 || index >= state.lessonIds.length - 1 ? "disabled" : ""}>الدرس التالي ←</button></nav>
          </main>
          <aside class="lesson-sidebar lesson-playlist"><div class="lesson-playlist-heading"><div><h2>محتوى الكورس</h2></div></div><div class="lesson-playlist-progress"><div><span>تقدمك في الكورس</span><strong>${coursePercent}٪</strong></div><span class="lesson-course-progress-track"><i style="width:${coursePercent}%"></i></span></div><div class="lesson-playlist-items">${lessonOutline}</div></aside>
        </div>
      </div>`;
    const player = document.getElementById("lesson-video");
    if (player) {
      const progressMessage = document.getElementById("video-progress");
      const screen = player.closest(".lesson-player-screen");
      const playButton = document.getElementById("lesson-play-overlay");
      const durationValue = document.querySelector("#lesson-duration-pill > span");
      const formatDuration = seconds => {
        if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
        const wholeSeconds = Math.floor(seconds);
        const hours = Math.floor(wholeSeconds / 3600);
        const minutes = Math.floor((wholeSeconds % 3600) / 60);
        const remainder = wholeSeconds % 60;
        return [hours, minutes, remainder].map(value => String(value).padStart(2, "0")).slice(hours ? 0 : 1).join(":");
      };
      let lastSavedAt = 0;
      let saving = false;
      let savePending = false;
      let completionPending = false;
      let saveErrorShown = false;
      let lastProgressPercent = -1;
      let saveTask = Promise.resolve();
      const lessonUserId = String(state.user?._id || state.user?.id || "");
      const saveProgress = (completed = false, force = false) => {
        if (completed) completionPending = true;
        if (!force && Date.now() - lastSavedAt < 10000) return saveTask;
        savePending = true;
        if (saving) return saveTask;
        saving = true;
        saveTask = (async () => {
          try {
            while (savePending) {
              savePending = false;
              const markCompleted = completionPending;
              completionPending = false;
              await api(`/api/lessons/${encodeURIComponent(id)}/progress`, {
                method: "POST",
                body: JSON.stringify({
                  watchedSeconds: Math.floor(player.currentTime),
                  durationSeconds: Number.isFinite(player.duration) ? Math.floor(player.duration) : 0,
                  completed: markCompleted
                })
              });
              lastSavedAt = Date.now();
              let savedProgress = state.lessonProgress.find(row => String(row.lesson) === String(id));
              if (!savedProgress) {
                savedProgress = { lesson: id };
                state.lessonProgress.push(savedProgress);
              }
              savedProgress.watchedSeconds = Math.max(Number(savedProgress.watchedSeconds) || 0, Math.floor(player.currentTime));
              savedProgress.durationSeconds = Number.isFinite(player.duration)
                ? Math.max(Number(savedProgress.durationSeconds) || 0, Math.floor(player.duration))
                : savedProgress.durationSeconds || 0;
              if (markCompleted) {
                savedProgress.completedAt = new Date().toISOString();
                progressMessage.textContent = "اكتمل الدرس وتم حفظ تقدمك.";
                if (!state.completedLessonIds.includes(String(id))) state.completedLessonIds.push(String(id));
                const percent = courseProgressPercent(state.lessonList, state.lessonProgress);
                updateCourseProgressDisplay(percent);
                const lessonStatus = document.querySelector(".lesson-playlist-item.is-current .lesson-playlist-state");
                if (lessonStatus) lessonStatus.textContent = "مكتمل";
                const progressChip = document.querySelector(".lesson-player-progress-chip");
                if (progressChip) progressChip.textContent = "مكتمل ✓";
                const completeButton = document.querySelector("[data-action='complete-lesson']");
                if (completeButton) completeButton.textContent = "الدرس مكتمل ✓";
              }
            }
          } catch (error) {
            savePending = false;
            if (!saveErrorShown) {
              notify(`تعذر حفظ تقدم مشاهدة الفيديو: ${error.message}`);
              saveErrorShown = true;
            }
          } finally {
            saving = false;
          }
        })();
        return saveTask;
      };
      state.flushLessonProgress = () => String(state.user?._id || state.user?.id || "") === lessonUserId
        ? saveProgress(false, true)
        : Promise.resolve();
      player.addEventListener("loadedmetadata", () => {
        durationValue.textContent = formatDuration(player.duration);
        const savedTime = Number(progress?.watchedSeconds) || 0;
        if (savedTime > 0 && !progress?.completedAt) {
          player.currentTime = Math.min(savedTime, Math.max(0, player.duration - 1));
          progressMessage.textContent = "استُعيد موضع المشاهدة السابق.";
        } else if (progress?.completedAt) {
          progressMessage.textContent = "أكملت هذا الدرس من قبل.";
        }
      }, { once: true });
      player.addEventListener("timeupdate", () => {
        if (Number.isFinite(player.duration) && player.duration > 0) {
          const percent = Math.min(100, Math.floor(player.currentTime / player.duration * 100));
          if (percent !== lastProgressPercent) {
            progressMessage.textContent = `تقدمت في مشاهدة الدرس ${percent.toLocaleString("ar-EG")}٪. يُحفظ موضعك تلقائيًا.`;
            lastProgressPercent = percent;
          }
          const currentProgress = state.lessonProgress.find(row => String(row.lesson) === String(id));
          if (currentProgress) {
            currentProgress.watchedSeconds = Math.max(Number(currentProgress.watchedSeconds) || 0, Math.floor(player.currentTime));
            currentProgress.durationSeconds = Math.max(Number(currentProgress.durationSeconds) || 0, Math.floor(player.duration));
          } else {
            state.lessonProgress.push({ lesson: id, watchedSeconds: Math.floor(player.currentTime), durationSeconds: Math.floor(player.duration) });
          }
          updateCourseProgressDisplay(courseProgressPercent(state.lessonList, state.lessonProgress));
        }
        void saveProgress();
      });
      player.addEventListener("playing", () => {
        screen.classList.add("is-playing");
        playButton.setAttribute("aria-label", "إيقاف الفيديو مؤقتًا");
        playButton.querySelector(".lesson-play-overlay-icon").textContent = "Ⅱ";
      });
      player.addEventListener("pause", () => {
        screen.classList.remove("is-playing");
        playButton.setAttribute("aria-label", "استكمال الفيديو");
        playButton.querySelector(".lesson-play-overlay-icon").textContent = "▶";
        if (player.currentTime > 0) void saveProgress(false, true);
      });
      player.addEventListener("ended", () => { void saveProgress(true, true); });
      playButton.addEventListener("click", () => {
        if (player.paused) {
          player.play().catch(() => notify("تعذر تشغيل الفيديو. جرّب الضغط على زر التشغيل مرة أخرى."));
        } else {
          player.pause();
        }
      });
      player.addEventListener("error", () => notify("تعذر تشغيل الفيديو. تأكد من أن الرابط مباشر لملف MP4 أو WebM أو بث HLS صالح."));
      if (new URL(lesson.videoUrl, location.href).pathname.toLowerCase().endsWith(".m3u8") &&
          !player.canPlayType("application/vnd.apple.mpegurl")) {
        if (!window.Hls?.isSupported()) {
          notify("هذا المتصفح لا يدعم تشغيل HLS. استخدم رابط MP4 أو WebM.");
        } else {
          state.hlsPlayer = new window.Hls();
          state.hlsPlayer.loadSource(lesson.videoUrl);
          state.hlsPlayer.attachMedia(player);
          state.hlsPlayer.on(window.Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              notify("تعذر تحميل بث الفيديو. تحقق من الرابط وإعدادات CORS لدى مستضيف الفيديو.");
              stopLessonStream();
            }
          });
        }
      }
    }
    showView("lesson");
  } catch (error) {
    notify(error.message);
  }
}

function modalClose() {
  const modal = document.getElementById("modal-backdrop");
  modal.querySelector(".modal-card").classList.remove("modal-card-wide");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function formatProgressTime(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} س ${minutes % 60} د` : `${minutes} د`;
}

async function showStudentDetails(id) {
  try {
    const details = await api(`/api/admin/students/${encodeURIComponent(id)}/details`);
    const modal = document.getElementById("modal-backdrop");
    const body = document.getElementById("modal-body");
    const { student, progress, courses } = details;
    body.innerHTML = `<div class="modal-brand">◎</div><h2 id="modal-title">تفاصيل الطالب</h2><div class="student-detail-head"><div><strong>${escapeHtml(student.displayName)}</strong><span>${escapeHtml(student.email)}</span><span>${escapeHtml(student.phoneNumber || "لا يوجد رقم هاتف")}</span></div><span class="admin-tag">${student.isActive ? "نشط" : "موقوف"}</span></div><div class="student-detail-summary"><div><span>التقدم العام</span><strong>${Number(progress.percent) || 0}٪</strong><div class="progress-track"><i style="width:${Math.min(100, Number(progress.percent) || 0)}%"></i></div></div><div><span>زمن المشاهدة</span><strong>${formatProgressTime(progress.watchedSeconds)} / ${formatProgressTime(progress.durationSeconds)}</strong></div><div><span>الكورسات المشتركة</span><strong>${courses.length}</strong></div></div><div class="student-course-details">${courses.map(row => `<article class="student-course-detail"><div class="student-course-detail-heading"><div><strong>${escapeHtml(row.course.title)}</strong><small>${Number(row.lessons.length)} درس · ${Number(row.percent) || 0}٪</small></div><span>${Number(row.percent) || 0}٪</span></div><div class="progress-track"><i style="width:${Math.min(100, Number(row.percent) || 0)}%"></i></div><div class="student-lesson-details">${row.lessons.map(lesson => `<div class="student-lesson-detail"><div><strong>${escapeHtml(lesson.title)}</strong><small>${lesson.completed ? "مكتمل" : `${formatProgressTime(lesson.watchedSeconds)} من ${formatProgressTime(lesson.durationSeconds)}`}</small></div><span>${Number(lesson.percent) || 0}٪</span><div class="progress-track"><i style="width:${Math.min(100, Number(lesson.percent) || 0)}%"></i></div></div>`).join("") || "<p>لا توجد دروس منشورة.</p>"}</div></article>`).join("") || "<p>لا توجد كورسات نشطة لهذا الطالب.</p>"}</div>`;
    const studentHead = body.querySelector(".student-detail-head>div");
    if (student.email?.endsWith("@students.local") && studentHead?.querySelector("span")) studentHead.querySelector("span").textContent = "البريد الإلكتروني: غير مسجل";
    studentHead?.insertAdjacentHTML("beforeend", `<span>هاتف ولي الأمر: ${escapeHtml(student.parentPhoneNumber || "غير مسجل")}</span><span>نوع الدراسة: ${student.studyType === "center" ? "طالب سنتر" : "طالب أونلاين"}</span>`);
    body.insertAdjacentHTML("afterbegin", `<div class="student-detail-actions"><button class="button button-small button-outline" data-action="student-status" data-id="${escapeHtml(student._id)}" data-active="${!student.isActive}">${student.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}</button></div>`);
    body.querySelectorAll(".student-course-detail").forEach((courseElement, index) => {
      const course = courses[index];
      const examMarkup = course.exams?.length ? `<div class="student-exam-details"><strong>امتحانات الكورس</strong>${course.exams.map(exam => `<div class="student-exam-detail"><div><span>${escapeHtml(exam.title)}</span><small>${exam.attempts.length ? `${exam.attempts.length} محاولات · أفضل نتيجة ${exam.bestPercent}٪` : "لم يبدأ الامتحان"}</small></div><b>${exam.attempts.length ? `${exam.bestPercent}٪` : "—"}</b></div>`).join("")}</div>` : "";
      courseElement.insertAdjacentHTML("beforeend", examMarkup);
      courseElement.insertAdjacentHTML("afterbegin", `<button class="button button-small button-outline student-course-revoke" data-action="revoke-enrollment" data-id="${escapeHtml(student._id)}" data-course="${escapeHtml(course.course._id)}">سحب الكورس</button>`);
    });
    modal.querySelector(".modal-card").classList.add("modal-card-wide");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  } catch (error) {
    notify(error.message);
  }
}

function showModal(mode) {
  const modal = document.getElementById("modal-backdrop");
  const body = document.getElementById("modal-body");
  const gradeOptions = state.grades.map(grade => `<option value="${escapeHtml(grade._id)}">${escapeHtml(grade.name)}</option>`).join("");
  if (mode === "login" || mode === "signup") {
    const signup = mode === "signup";
    body.innerHTML = `<div class="modal-brand">∑</div><h2 id="modal-title">${signup ? "إنشاء حساب طالب" : "تسجيل الدخول"}</h2>
      <p>${signup ? "اختر صفك لعرض كورساته." : "تابع كورساتك."}</p>
      <form class="modal-form" id="auth-form" data-mode="${signup ? "signup" : "login"}">
      ${signup ? `<label>الاسم<input name="displayName" required minlength="2" maxlength="100"></label><label>الصف الدراسي<select name="grade" required><option value="">اختر صفك</option>${gradeOptions}</select></label><label>رقم الهاتف<input name="phoneNumber" inputmode="tel" placeholder="+20..." pattern="\\+?[0-9\\s()-]{8,20}"></label>` : ""}
      <label>البريد الإلكتروني<input type="email" name="email" required autocomplete="email"></label>
      <label>كلمة المرور<input type="password" name="password" required minlength="${signup ? 10 : 1}" maxlength="128" autocomplete="${signup ? "new-password" : "current-password"}"></label>
      <button class="button button-primary full-width" type="submit">${signup ? "إنشاء الحساب" : "دخول"}</button></form>
      <p class="modal-footnote">كلمات المرور تُخزّن مجزأة في الخادم، والجلسة داخل ملف ارتباط محمي.</p>
      <button class="text-link" data-action="${signup ? "login" : "signup"}">${signup ? "لديك حساب؟ تسجيل الدخول" : "إنشاء حساب جديد"}</button>`;
  } else {
    body.innerHTML = `<div class="modal-brand">ⓘ</div><h2 id="modal-title">معلومة عن الدفع</h2><p>لن يتم منح صلاحية المحتوى المدفوع إلا بعد تحقق الخادم من إشعار الدفع الموقّع من Kashier. لا تُدخل بيانات بطاقتك في هذه الصفحة.</p><button class="button button-outline full-width" data-view="courses">تصفح الكورسات</button>`;
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function updateThemeButton() {
  const button = document.getElementById("theme-toggle");
  const dark = document.body.classList.contains("dark");
  button.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.7 8.7 0 1 0 20.2 15.1Z"/></svg>';
  button.setAttribute("aria-label", dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن");
}

async function renderDashboard() {
  if (!state.user) return showView("login");
  const content = document.getElementById("dashboard-content");
  content.innerHTML = '<div class="dashboard-loading" role="status">جارٍ تحميل لوحة الطالب...</div>';
  try {
    if (state.flushLessonProgress) await state.flushLessonProgress();
    const dashboard = await api("/api/dashboard");
    const { courses, overall, attempts, announcements, weeklyActivity = [], ranking } = dashboard;
    const studyDays = weeklyActivity.filter(day => Number(day.watchedSeconds) > 0).length;
    const peakStudySeconds = Math.max(0, ...weeklyActivity.map(day => Number(day.watchedSeconds) || 0));
    content.innerHTML = ` ${announcements.length ? `<div class="notice-box"><div><strong>إعلانات المنصة</strong>${announcements.map(item => `<h3>${escapeHtml(item.title)} — ${escapeHtml(item.body)}</h3>`).join("")}</div></div>` : ""}<span class="section-kicker">انت هنا </span><h1 class="page-title">أهلًا، ${escapeHtml(state.user.displayName)}</h1>
      <p class="section-intro">شوف من هنا كورساتك وتقدمك</p><div class="dashboard-grid">
      <div class="dashboard-card dashboard-course-count"><strong>${courses.length}</strong><span>كورس مشترك فيه</span></div>
      <div class="dashboard-card dashboard-overall-progress"><strong>${Number(overall?.percent) || 0}٪</strong><span>التقدم الكلي</span><div class="progress-track"><i style="width:${Math.min(100, Number(overall?.percent) || 0)}%"></i></div></div>
      <div class="dashboard-card dashboard-exam-attempt-count"><strong>${attempts.length}</strong><span>محاولة امتحان</span></div></div>
      <div class="dashboard-activity-row dashboard-ranking-activity-row">
      <div class="dashboard-card dashboard-student-ranking"><strong>${ranking ? `${Number(ranking.rank).toLocaleString("ar-EG")} / ${Number(ranking.total).toLocaleString("ar-EG")}` : "—"}</strong><span>${ranking ? "ترتيبك بين طلاب صفك" : "جارٍ تحميل ترتيبك"}</span></div>
      <section class="dashboard-card dashboard-activity" aria-label="مخطط أيام المذاكرة من الأحد إلى السبت">
        <header><div><h2>مخطط أيام المذاكرة</h2><p>ذاكرت ${studyDays.toLocaleString("ar-EG")} من 7 أيام هذا الأسبوع</p></div><strong>${studyDays.toLocaleString("ar-EG")} / ٧</strong></header>
        <div class="weekly-activity-chart" role="list">
          ${weeklyActivity.map(day => {
            const seconds = Number(day.watchedSeconds) || 0;
            const date = new Date(`${day.dateKey}T00:00:00.000Z`);
            const weekday = new Intl.DateTimeFormat("ar-EG", { weekday: "short", timeZone: "UTC" }).format(date);
            const studied = seconds > 0;
            const barHeight = studied ? Math.max(12, Math.round(seconds / peakStudySeconds * 100)) : 0;
            const minutes = Math.round(seconds / 60);
            return `<div class="weekly-activity-day${studied ? " studied" : ""}" role="listitem" aria-label="${escapeHtml(weekday)}: ${studied ? `ذاكر ${minutes.toLocaleString("ar-EG")} دقيقة` : "لم يذاكر"}"><div class="weekly-activity-track" title="${studied ? `${minutes.toLocaleString("ar-EG")} دقيقة` : "لم يذاكر"}"><i style="height:${barHeight}%"></i></div><span>${escapeHtml(weekday)}</span></div>`;
          }).join("")}
        </div>
      </section>
      </div>
      <section class="dashboard-my-courses"><h3>كورساتي</h3>${courses.length ? `<div class="dashboard-courses">${courses.map(row => courseCard({ ...row.course, enrolled: true }, row)).join("")}</div>` : `<p>مشتركتش في اي كورس</p><button class="button button-outline" data-view="courses">تصفح الكورسات</button>`}</section>
      <div class="hero-actions"><button class="button button-outline" data-view="exams">الامتحانات</button><button class="button button-outline" data-view="results">نتائج الامتحانات</button><button class="button button-outline" data-view="profile">الملف الشخصي</button></div>`;
    showAnnouncements(announcements);
    if (ranking !== undefined) {
      const card = content.querySelector(".dashboard-student-ranking");
      card.querySelector("span").textContent = ranking ? "ترتيبك بين طلاب صفك" : "أكمل بيانات صفك لعرض ترتيبك";
    } else {
      api("/api/dashboard/ranking").then(({ ranking: loadedRanking }) => {
        const card = content.querySelector(".dashboard-student-ranking");
        if (!card) return;
        card.querySelector("strong").textContent = loadedRanking
          ? `${Number(loadedRanking.rank).toLocaleString("ar-EG")} / ${Number(loadedRanking.total).toLocaleString("ar-EG")}`
          : "—";
        card.querySelector("span").textContent = loadedRanking ? "ترتيبك بين طلاب صفك" : "أكمل بيانات صفك لعرض ترتيبك";
      }).catch(error => notify(`تعذر تحميل ترتيبك: ${error.message}`));
    }
    clearTimeout(state.weeklyActivityTimer);
    const now = new Date();
    const daysUntilSunday = 7 - now.getUTCDay();
    const nextSunday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday);
    state.weeklyActivityTimer = setTimeout(() => {
      if (document.getElementById("view-dashboard").classList.contains("active")) void renderDashboard();
    }, nextSunday - now.getTime() + 1000);
  } catch (error) {
    notify(error.message);
  }
}

function showAnnouncements(items = []) {
  const slot = document.getElementById("announcement-slot");
  const key = `dismissed-announcements-${state.user?.id || "visitor"}`;
  const dismissed = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  const next = items.find(item => !dismissed.has(String(item._id)));
  if (!next || !slot) return;
  slot.innerHTML = `<aside class="announcement-card"><div><span class="section-kicker">إعلان للطلاب</span><h3>${escapeHtml(next.title)}</h3><h5>${escapeHtml(next.body)}</h5>${next.linkUrl ? `<a class="text-link" href="${escapeHtml(next.linkUrl)}" target="_blank" rel="noopener noreferrer">التفاصيل ←</a>` : ""}</div><button class="icon-button" data-action="dismiss-announcement" data-id="${escapeHtml(next._id)}" aria-label="إغلاق الإعلان">×</button></aside>`;
}

async function renderExams() {
  if (!state.user) return showView("login");
  try {
    const { exams } = await api("/api/my-exams");
    document.getElementById("exams-content").innerHTML = `<span class="section-kicker">تدرب وراجع</span><h1 class="page-title">الامتحانات</h1>
      <div class="course-grid">${exams.map(exam => {
        const canRetry = exam.attemptsRemaining === null || exam.attemptsRemaining > 0;
        const buttonText = exam.hasActiveSession ? "استكمل الامتحان" : exam.attemptCount ? "امتحن تاني" : "ابدأ";
        const score = exam.latestAttempt ? Number(exam.latestAttempt.score) || 0 : 0;
        const maxScore = exam.latestAttempt ? Number(exam.latestAttempt.maxScore) || 0 : 0;
        const latestAttempt = exam.latestAttempt
          ? `<div class="exam-card-result"><span>درجتك في آخر محاولة</span><strong>${score} من ${maxScore}</strong>${maxScore ? `<b>${Math.round(score / maxScore * 100)}٪</b>` : ""}</div>`
          : "";
        const button = exam.hasActiveSession || canRetry
          ? `<button class="button button-primary full-width" data-exam="${escapeHtml(exam._id)}">${buttonText}</button>`
          : `<p class="exam-attempts-ended">استنفدت محاولات هذا الامتحان.</p>`;
        return `<article class="course-card"><div class="course-info"><span class="section-kicker">${escapeHtml(exam.course?.title || "")}</span><h3>${escapeHtml(exam.title)}</h3><p>${exam.durationSeconds ? `${Math.ceil(exam.durationSeconds / 60)} دقيقة` : "بلا توقيت"} · ${exam.questions.length} سؤال</p>${latestAttempt}${button}</div></article>`;
      }).join("") || "<p>لا توجد امتحانات.</p>"}</div>`;
  } catch (error) {
    notify(error.message);
  }
}

async function startExam(id) {
  try {
    const { sessionId, expiresAt, exam } = await api(`/api/exams/${encodeURIComponent(id)}/start`, { method: "POST", body: "{}" });
    const time = exam.durationSeconds ? `<span class="exam-time" data-expiry="${escapeHtml(expiresAt)}"></span>` : `<span class="exam-time">بلا توقيت</span>`;
    document.getElementById("exams-content").innerHTML = `<span class="section-kicker">اختبار موقّت من الخادم</span><h1 class="page-title">${escapeHtml(exam.title)}</h1>
      <form class="exam-card" id="attempt-form" data-exam="${escapeHtml(exam._id)}" data-session="${escapeHtml(sessionId)}"><div class="exam-heading"><h2>أجب عن الأسئلة ثم أرسل المحاولة</h2>${time}</div>
      ${exam.questions.map((question, index) => {
        const options = question.type === "true_false" ? [["true", "صح"], ["false", "خطأ"]] : question.options.map(option => [option, option]);
        return `<fieldset><legend>${index + 1}. ${escapeHtml(question.prompt)} (${Number(question.points)} درجة)</legend>${options.map(([value, label]) => `<label><input type="radio" name="${escapeHtml(question._id)}" value="${escapeHtml(value)}"> ${escapeHtml(label)}</label>`).join("")}</fieldset>`;
      }).join("")}<button class="button button-primary" type="submit">تسليم الإجابات</button><p class="exam-feedback" role="status"></p></form>`;
    if (exam.durationSeconds) {
      clearInterval(state.examTimer);
      state.examTimer = setInterval(() => {
        const remaining = new Date(expiresAt).getTime() - Date.now();
        const timer = document.querySelector("[data-expiry]");
        if (!timer) return clearInterval(state.examTimer);
        if (remaining <= 0) {
          timer.textContent = "انتهى الوقت";
          clearInterval(state.examTimer);
          document.querySelector("#attempt-form button[type=submit]").click();
        } else timer.textContent = `الوقت المتبقي ${Math.ceil(remaining / 1000)} ثانية`;
      }, 1000);
    }
  } catch (error) {
    notify(error.message);
  }
}

async function submitExam(form) {
  clearInterval(state.examTimer);
  const answers = [...new FormData(form).entries()].filter(([key]) => key !== "unused").map(([questionId, answer]) => ({ questionId, answer }));
  try {
    const result = await api(`/api/exams/${encodeURIComponent(form.dataset.exam)}/attempts`, {
      method: "POST", body: JSON.stringify({ sessionId: form.dataset.session, answers })
    });
    document.querySelector(".exam-feedback").textContent = `النتيجة: ${result.attempt.score} من ${result.attempt.maxScore}${result.attempt.passed ? " — اجتزت الامتحان" : ""}`;
    form.querySelectorAll("input,button").forEach(element => element.disabled = true);
    if (result.review) document.querySelector(".exam-feedback").insertAdjacentHTML("afterend", `<div class="resource-box">${result.review.map((row, index) => `<p>الإجابة الصحيحة للسؤال ${index + 1}: ${escapeHtml(row.correctAnswer)} ${escapeHtml(row.explanation)}</p>`).join("")}</div>`);
    form.insertAdjacentHTML("afterend", '<button class="button button-outline" data-view="exams">العودة للامتحانات وعرض الدرجة</button>');
  } catch (error) {
    document.querySelector(".exam-feedback").textContent = error.message;
  }
}

async function renderResults() {
  if (!state.user) return showView("login");
  try {
    const { attempts } = await api("/api/results");
    document.getElementById("results-content").innerHTML = `<h1 class="page-title">نتائج الامتحانات</h1>
      <div class="dashboard-card">${attempts.length ? attempts.map(attempt => `<div class="list-link">${escapeHtml(attempt.exam?.title || "امتحان")} — ${escapeHtml(attempt.course?.title || "")}<span>${Number(attempt.score)} / ${Number(attempt.maxScore)}</span><small>${new Date(attempt.submittedAt).toLocaleDateString("ar-EG")}</small></div>`).join("") : "<p>لا توجد محاولات امتحان بعد.</p>"}</div>`;
  } catch (error) { notify(error.message); }
}

async function renderProfile() {
  if (!state.user) return showView("login");
  try {
    const { user } = await api("/api/auth/profile");
    const grades = await api("/api/grades");
    state.grades = grades.grades;
    const grade = state.grades.find(item => String(item._id) === String(user.grade));
    const studyType = user.studyType === "center" ? "طالب سنتر" : "طالب أونلاين";
    document.getElementById("profile-content").innerHTML = `<h1 class="page-title">الملف الشخصي</h1><div class="profile-layout">
      <div class="profile-card"><span class="profile-avatar">${escapeHtml(user.displayName.slice(0, 1))}</span><h2>${escapeHtml(user.displayName)}</h2><span class="admin-tag">${user.role === "admin" ? "مدير" : "طالب"}</span></div>
      <div class="dashboard-card profile-details" aria-label="بيانات الحساب">
        <div class="profile-detail"><span>رقم هاتف الطالب</span><strong>${escapeHtml(user.phoneNumber || "غير مسجل")}</strong></div>
        <div class="profile-detail"><span>رقم هاتف ولي الأمر</span><strong>${escapeHtml(user.parentPhoneNumber || "_____")}</strong></div>
        <div class="profile-detail"><span>نوع الدراسة</span><strong>${user.role === "admin" ? "—" : studyType}</strong></div>
        <div class="profile-detail"><span>الصف الدراسي</span><strong>${escapeHtml(grade?.name || (user.role === "admin" ? "—" : "غير محدد"))}</strong></div>
      </div></div>`;
  } catch (error) { notify(error.message); }
}

function createExamQuestionCard() {
  const id = ++state.examQuestionSequence;
  const options = [0, 1, 2, 3].map(index => `<div class="exam-option-row" data-exam-option><label><input type="radio" name="exam-correct-${id}" value="${index}" data-correct-option aria-label="الإجابة الصحيحة للاختيار ${index + 1}"><span>${index + 1}</span></label><input type="text" data-answer-option required maxlength="500" placeholder="الاختيار ${index + 1}"><button class="button button-small button-outline" type="button" data-action="remove-exam-option" aria-label="حذف الاختيار">حذف</button></div>`).join("");
  return `<article class="exam-question-editor" data-exam-question data-question-id="${id}">
    <div class="exam-question-editor-heading"><strong data-question-number></strong><button class="button button-small button-outline" type="button" data-action="remove-exam-question">حذف السؤال</button></div>
    <label>السؤال<textarea data-question-prompt required maxlength="5000" rows="3" placeholder="اكتب نص السؤال"></textarea></label>
    <div class="exam-question-settings"><label>نوع السؤال<select data-question-type><option value="multiple_choice">اختيار من متعدد</option><option value="true_false">صح أو خطأ</option></select></label><label>الدرجة<input data-question-points type="number" min="1" max="100" value="1" required></label></div>
    <div data-question-options><div class="exam-option-heading"><strong>الاختيارات</strong><small>حدد الدائرة بجوار الإجابة الصحيحة</small></div><div data-exam-option-list>${options}</div><button class="button button-small button-outline" type="button" data-action="add-exam-option">إضافة اختيار</button></div>
    <fieldset class="exam-boolean-options" data-boolean-options hidden><legend>الإجابة الصحيحة</legend><label><input type="radio" name="exam-boolean-${id}" value="true" data-correct-boolean> صح</label><label><input type="radio" name="exam-boolean-${id}" value="false" data-correct-boolean> خطأ</label></fieldset>
    <label>توضيح الإجابة (اختياري)<textarea data-question-explanation maxlength="5000" rows="2" placeholder="اكتب شرحًا مختصرًا للإجابة"></textarea></label>
  </article>`;
}

function updateExamQuestionEditor(form) {
  const cards = [...form.querySelectorAll("[data-exam-question]")];
  cards.forEach((card, index) => {
    card.querySelector("[data-question-number]").textContent = `السؤال ${index + 1}`;
    const isMultipleChoice = card.querySelector("[data-question-type]").value === "multiple_choice";
    card.querySelector("[data-question-options]").hidden = !isMultipleChoice;
    card.querySelector("[data-boolean-options]").hidden = isMultipleChoice;
    card.querySelectorAll("[data-answer-option], [data-correct-option], [data-action='add-exam-option']").forEach(input => {
      input.disabled = !isMultipleChoice;
    });
    card.querySelectorAll("[data-answer-option]").forEach(input => { input.required = isMultipleChoice; });
  });
}

function collectExamQuestions(form) {
  const cards = [...form.querySelectorAll("[data-exam-question]")];
  if (!cards.length) throw new Error("أضف سؤالًا واحدًا على الأقل.");
  return cards.map((card, index) => {
    const type = card.querySelector("[data-question-type]").value;
    const prompt = card.querySelector("[data-question-prompt]").value.trim();
    const question = {
      prompt,
      type,
      points: Number(card.querySelector("[data-question-points]").value),
      explanation: card.querySelector("[data-question-explanation]").value.trim()
    };
    if (!prompt) throw new Error(`اكتب نص السؤال ${index + 1}.`);
    if (!Number.isInteger(question.points) || question.points < 1 || question.points > 100) {
      throw new Error(`درجة السؤال ${index + 1} يجب أن تكون من 1 إلى 100.`);
    }
    if (type === "true_false") {
      const answer = card.querySelector("[data-correct-boolean]:checked");
      if (!answer) throw new Error(`حدد الإجابة الصحيحة للسؤال ${index + 1}.`);
      question.correctAnswer = answer.value;
      question.options = [];
      return question;
    }
    const optionInputs = [...card.querySelectorAll("[data-answer-option]")];
    const options = optionInputs.map(input => input.value.trim());
    if (options.length < 2 || options.length > 10 || options.some(option => !option)) {
      throw new Error(`أكمل اختيارين على الأقل للسؤال ${index + 1} (بحد أقصى 10 اختيارات).`);
    }
    const correctOption = card.querySelector("[data-correct-option]:checked");
    if (!correctOption) throw new Error(`حدد الإجابة الصحيحة للسؤال ${index + 1}.`);
    question.options = options;
    question.correctAnswer = options[Number(correctOption.value)];
    return question;
  });
}

async function renderAdmin() {
  if (state.user?.role !== "admin") {
    notify("هذه الصفحة متاحة لحساب إداري فقط.");
    return showView("home");
  }
  try {
    const dashboard = await api("/api/admin/dashboard");
    state.grades = dashboard.grades;
    const courses = dashboard.courses;
    const students = dashboard.students;
    const gradeOptions = state.grades.map(grade => `<option value="${escapeHtml(grade._id)}">${escapeHtml(grade.name)}</option>`).join("");
    const courseOptions = courses.map(course => `<option value="${escapeHtml(course._id)}">${escapeHtml(course.title)}</option>`).join("");
    const studentOptions = students.map(student => `<option value="${escapeHtml(student._id)}">${escapeHtml(student.displayName)} — ${escapeHtml(student.email)}</option>`).join("");
    const lessons = dashboard.lessons;
    const lessonOptions = `<option value="">—</option>${lessons.map(lesson => `<option value="${escapeHtml(lesson._id)}">${escapeHtml(lesson.course?.title || "")} — ${escapeHtml(lesson.title)}</option>`).join("")}`;
    document.getElementById("admin-content").innerHTML = `<span class="section-kicker">الإدارة</span><h1 class="page-title">لوحة الإدارة</h1>
      <div class="dashboard-grid">${Object.entries(dashboard.overview).map(([key, value]) => `<div class="dashboard-card"><strong>${Number(value)}</strong><span>${escapeHtml(({students:"الطلاب",courses:"الكورسات",enrollments:"الاشتراكات",paidPayments:"مدفوعات مؤكدة",pendingPayments:"مدفوعات معلقة",examAttempts:"محاولات امتحان"})[key] || key)}</span></div>`).join("")}</div>
      <div class="admin-grid">
      <section class="admin-panel"><h3>إضافة صف دراسي</h3><form id="grade-form" class="admin-form"><label>الاسم<input name="name" required></label><label>معرّف إنجليزي<input name="slug" pattern="[a-z0-9-]+" required></label><button class="button button-primary">إضافة الصف</button></form><div>${state.grades.map(grade => `<div class="list-link">${escapeHtml(grade.name)} <span>${grade.active ? "نشط" : "مخفي"}</span></div>`).join("")}</div></section>
      <section class="admin-panel"><h3>إنشاء أو تعديل كورس</h3><form id="course-form" class="admin-form"><input type="hidden" name="id"><label>الاسم<input name="title" required></label><label>الوصف<textarea name="description" required></textarea></label><label>المدرس<input name="instructor" value="${escapeHtml(state.user.displayName)}" required></label><label>الصف<select name="grade"><option value="">بدون صف</option>${gradeOptions}</select></label><label>السعر بالجنيه المصري<input name="price" type="number" min="0" step="0.01" value="0" required></label><label><input type="checkbox" name="isFree" checked> مجاني</label><label>رابط صورة HTTPS<input name="imageUrl" type="url"></label><label>الحالة (المسودة لا تظهر للطلاب)<select name="status"><option value="draft">مسودة</option><option value="published">منشور</option><option value="hidden">مخفي</option></select></label><button class="button button-primary" type="button" data-action="save-course">حفظ الكورس</button></form></section>
      <section class="admin-panel"><h3>الدروس والملفات والفيديوهات</h3><form id="lesson-form" class="admin-form"><input type="hidden" name="id"><label>الكورس<select name="course" required>${courseOptions}</select></label><label>عنوان الدرس<input name="title" required></label><label>الوصف<textarea name="description"></textarea></label><label>رابط فيديو خارجي HTTPS (اختياري)<input name="videoUrl" type="url"></label><label>أو اختر فيديو من جهازك (MP4 أو WebM أو OGG)<input name="video" type="file" accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.ogg"></label><label>الترتيب<input name="position" type="number" min="0" value="0"></label><label><input type="checkbox" name="published"> نشر الدرس</label><button class="button button-primary">إضافة الدرس</button></form>
      <form id="upload-form" class="admin-form"><label>الدرس<select name="lessonId" required>${lessonOptions}</select></label><label>مرفقات PDF<input type="file" name="files" accept="application/pdf,.pdf" multiple required></label><button class="button button-outline">رفع ملفات PDF إلى قاعدة البيانات</button></form>
      <form id="video-upload-form" class="admin-form"><label>الدرس<select name="lessonId" required>${lessonOptions}</select></label><label>ملف الفيديو (MP4 أو WebM أو OGG)<input type="file" name="video" accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.ogg" required></label><button class="button button-outline">رفع الفيديو إلى قاعدة البيانات</button></form>
      <div class="admin-list">${lessons.map(lesson => `<article class="admin-course-row"><div><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.course?.title || "")} · ${lesson.published ? "منشور" : "مسودة"}${lesson.videoFile ? " · فيديو محفوظ في قاعدة البيانات" : lesson.videoUrl ? " · رابط فيديو خارجي" : ""}</small></div><div class="admin-actions"><button class="button button-small button-outline" data-action="edit-lesson" data-id="${escapeHtml(lesson._id)}">تعديل</button><button class="button button-small button-outline" data-action="delete-lesson" data-id="${escapeHtml(lesson._id)}">حذف</button></div></article>`).join("")}</div></section>
      <section class="admin-panel exam-management-panel" id="exam-management"><h3>إدارة الامتحانات</h3><p class="section-intro">أنشئ امتحانًا وأضف أسئلته واختياراته وحدد الإجابة الصحيحة مباشرة.</p><form id="exam-form" class="admin-form"><label>الكورس<select name="course" required>${courseOptions}</select></label><label>الدرس (اختياري)<select name="lesson">${lessonOptions}</select></label><label>عنوان الامتحان<input name="title" required minlength="2" maxlength="180"></label><div class="exam-question-list" id="exam-question-list">${createExamQuestionCard()}</div><button class="button button-outline" type="button" data-action="add-exam-question">إضافة سؤال</button><div class="exam-question-settings"><label>المدة بالدقائق (0 بلا حد)<input name="durationMinutes" type="number" min="0" max="1440" value="0"></label><label>أقصى المحاولات (0 بلا حد)<input name="maxAttempts" type="number" min="0" max="100" value="0"></label><label>درجة النجاح %<input name="passPercent" type="number" min="0" max="100" value="50"></label></div><label class="exam-checkbox"><input type="checkbox" name="published"> نشر الامتحان</label><label class="exam-checkbox"><input type="checkbox" name="revealAnswers"> إظهار الحل بعد التسليم</label><button class="button button-primary" type="submit">إنشاء الامتحان</button></form></section>
      <section class="admin-panel"><h3>إنشاء إعلان</h3><form id="announcement-form" class="admin-form"><label>العنوان<input name="title" required></label><label>النص<textarea name="body" required></textarea></label><label>رابط اختياري HTTPS<input name="linkUrl" type="url"></label><label>يبدأ<input name="startsAt" type="datetime-local" required></label><label>ينتهي<input name="endsAt" type="datetime-local" required></label><label>الجمهور<select name="audience"><option value="all">الجميع</option><option value="subscribers">المشتركون</option><option value="grade">صف دراسي</option></select></label><label>الصف<select name="grade"><option value="">—</option>${gradeOptions}</select></label><button class="button button-primary">نشر الإعلان</button></form></section>
      <section class="admin-panel"><h3>الطلاب والاشتراكات</h3><form id="student-search" class="admin-form"><label>بحث بالاسم أو البريد<input name="q"></label><button class="button button-outline">بحث</button></form><form id="grant-form" class="admin-form"><label>الطالب<select name="student" required>${studentOptions}</select></label><label>الكورس<select name="course" required>${courseOptions}</select></label><button class="button button-outline">منح صلاحية يدويًا</button></form><div id="students-list">${students.map(student => `<article class="admin-student"><strong>${escapeHtml(student.displayName)}</strong><small>${escapeHtml(student.email)} · ${student.isActive ? "نشط" : "موقوف"} · ${student.enrollments.length} اشتراكات</small><div class="admin-actions"><button class="button button-small button-outline" data-action="student-status" data-id="${escapeHtml(student._id)}" data-active="${!student.isActive}">${student.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}</button>${student.enrollments.filter(row => row.status === "active").map(row => `<button class="button button-small button-outline" data-action="revoke-enrollment" data-id="${escapeHtml(student._id)}" data-course="${escapeHtml(courseId(row.course))}">سحب ${escapeHtml(row.course?.title || "كورس")}</button>`).join("")}</div></article>`).join("")}</div></section>
      <section class="admin-panel"><h3>أكواد اشتراك السنتر</h3><p>أنشئ كودًا لكورس. يُستخدم مرة واحدة فقط، وشاركه مع طالب السنتر المقصود.</p><form id="activation-code-form" class="admin-form"><label>الكورس<select name="course" required>${courseOptions}</select></label><button class="button button-primary">إنشاء كود</button></form>${state.activationCode ? `<div class="activation-code-result"><label for="generated-activation-code">الكود — انسخه وشاركه مع الطالب</label><div><input id="generated-activation-code" value="${escapeHtml(state.activationCode.code)}" readonly><button class="button button-outline" type="button" data-action="copy-activation-code">نسخ</button></div><small>الكورس: ${escapeHtml(state.activationCode.course.title)} · لا يمكن عرض هذا الكود مرة أخرى بعد مغادرة لوحة الإدارة.</small></div>` : ""}</section>
      <section class="admin-panel"><h3>نتائج الامتحانات والمدفوعات</h3><p>المحاولات: ${dashboard.attemptsCount}</p><div class="admin-list">${dashboard.payments.map(payment => `<div class="list-link">${escapeHtml(payment.user?.displayName || "")} — ${escapeHtml(payment.course?.title || "")}<span>${escapeHtml(payment.status)} · ${new Intl.NumberFormat("ar-EG").format(payment.amountCents / 100)} ج.م</span></div>`).join("") || "<p>لا توجد عمليات دفع بعد.</p>"}</div><h3>سجل الإدارة</h3><div class="admin-list">${dashboard.logs.map(log => `<div class="list-link">${escapeHtml(log.action)} — ${escapeHtml(log.actor?.displayName || "")}<span>${new Date(log.createdAt).toLocaleDateString("ar-EG")}</span></div>`).join("")}</div></section>
      </div><section class="admin-panel admin-table"><h3>الكورسات</h3>${courses.map(course => `<div class="admin-course-row"><div><strong>${escapeHtml(course.title)}</strong><small>${escapeHtml(course.instructor)} · ${priceText(course)} · ${escapeHtml(course.status)}</small></div><div class="admin-actions"><button class="button button-small button-outline" data-action="edit-course" data-id="${escapeHtml(course._id)}">تعديل</button><button class="button button-small button-outline" data-action="delete-course" data-id="${escapeHtml(course._id)}">${course.status === "hidden" ? "إخفاء" : "حذف/إخفاء"}</button></div></div>`).join("") || "<p>لا توجد كورسات بعد.</p>"}</section>`;
    students.forEach(student => {
      const statusButton = [...document.querySelectorAll("[data-action='student-status']")].find(button => button.dataset.id === String(student._id));
      const studentRow = statusButton?.closest(".admin-student");
      if (!studentRow) return;
      const percent = Math.min(100, Number(student.progress?.percent) || 0);
      studentRow.querySelector("small")?.insertAdjacentHTML("afterend", `<div class="student-progress"><span>التقدم الكلي: ${percent.toLocaleString("ar-EG")}٪ (${Number(student.progress?.completed) || 0} من ${Number(student.progress?.total) || 0} درس)</span><div class="progress-track"><i style="width:${percent}%"></i></div></div>`);
      studentRow.querySelector(".admin-actions")?.insertAdjacentHTML("afterbegin", `<button class="button button-small button-primary" data-action="student-details" data-id="${escapeHtml(student._id)}">التفاصيل</button>`);
      studentRow.querySelectorAll("[data-action='student-status'],[data-action='revoke-enrollment']").forEach(button => button.remove());
    });
    bindAdminFormSubmissions();
    state.adminCourses = courses;
    state.adminLessons = lessons;
    showAdminAnnouncements(dashboard.announcements);
    return true;
  } catch (error) {
    notify(error.message);
    return false;
  }
}

function showAdminAnnouncements(items) {
  const form = document.getElementById("announcement-form");
  if (!form || !items.length) return;
  form.insertAdjacentHTML("afterend", `<div class="admin-list">${items.map(item => `<article class="admin-course-row"><strong>${escapeHtml(item.title)}</strong><button class="button button-small button-outline" data-action="toggle-announcement" data-id="${escapeHtml(item._id)}" data-active="${!item.active}">${item.active ? "إيقاف" : "تفعيل"}</button></article>`).join("")}</div>`);
}

async function renderPaymentReturn() {
  const orderId = new URLSearchParams(location.search).get("merchantOrderId") || sessionStorage.getItem("pending-merchant-order");
  let message = "حالة الدفع لا تُستنتج من صفحة العودة. ينتظر الخادم إشعار Kashier الموقّع.";
  if (orderId && state.user) {
    try {
      const { payment } = await api(`/api/payments/${encodeURIComponent(orderId)}`);
      message = payment.status === "paid" ? "تم تأكيد الدفع من الخادم. أصبح الكورس متاحًا في لوحة الطالب." :
        payment.status === "pending" ? "الدفع قيد التحقق. لن يُفتح الكورس قبل تأكيد Kashier." : "لم يكتمل الدفع.";
      if (payment.status !== "pending") {
        sessionStorage.removeItem("pending-merchant-order");
        sessionStorage.removeItem("pending-payment-course");
        state.paymentCourseId = null;
      }
    } catch (error) { message = error.message; }
  }
  document.getElementById("payment-return-content").innerHTML = `<div class="dashboard-card"><span class="section-kicker">حالة الدفع</span><h1 class="page-title">تأكيد الطلب</h1><p>${escapeHtml(message)}</p><button class="button button-primary" data-view="dashboard">لوحة الطالب</button></div>`;
  showView("payment-return", false);
}

function applyBootstrap(bootstrap) {
  state.user = bootstrap.user;
  state.grades = bootstrap.grades;
  state.courses = bootstrap.courses;
  updateIdentity();
  renderCourses();
  renderHomeCourses();
  showAnnouncements(bootstrap.announcements);
}

async function handleAdminSubmit(form) {
  const data = new FormData(form);
  const value = Object.fromEntries(data.entries());
  const formId = form.getAttribute("id");
  let savedCourse = null;
  let uploadedLessonVideo = false;
  if (formId === "grade-form") {
    await api("/api/admin/grades", { method: "POST", body: JSON.stringify({ name: value.name, slug: value.slug, sortOrder: 0 }) });
  } else if (formId === "course-form") {
    const courseData = {
      title: value.title, description: value.description, instructor: value.instructor, grade: value.grade || "",
      priceCents: Math.round(Number(value.price) * 100), isFree: data.has("isFree"),
      ...(value.imageUrl ? { imageUrl: value.imageUrl } : {}),
      status: value.status, featured: false, position: 0, durationMinutes: 0
    };
    const id = value.id;
    const result = await api(id ? `/api/admin/courses/${encodeURIComponent(id)}` : "/api/admin/courses", { method: id ? "PATCH" : "POST", body: JSON.stringify(courseData) });
    if (!result?.course?._id) throw new Error("لم يؤكد الخادم حفظ الكورس. حاول مرة أخرى.");
    savedCourse = result.course;
  } else if (formId === "lesson-form") {
    const videoFile = form.elements.video.files[0];
    const lessonData = {
      title: value.title, description: value.description, videoUrl: videoFile ? "" : (value.videoUrl || ""),
      position: Number(value.position), published: data.has("published"), durationMinutes: 0
    };
    const lessonResponse = await api(value.id ? `/api/admin/lessons/${encodeURIComponent(value.id)}` : `/api/admin/courses/${encodeURIComponent(value.course)}/lessons`, {
      method: value.id ? "PATCH" : "POST", body: JSON.stringify(lessonData)
    });
    const lessonId = value.id || lessonResponse?.lesson?._id;
    if (!lessonId) throw new Error("تم حفظ الدرس دون إرجاع معرّفه، لذلك لم يمكن ربط الفيديو به.");
    if (videoFile) {
      const videoData = new FormData();
      videoData.append("video", videoFile);
      try {
        await api(`/api/admin/lessons/${encodeURIComponent(lessonId)}/video`, { method: "POST", body: videoData });
        uploadedLessonVideo = true;
      } catch (error) {
        throw new Error(`تم حفظ الدرس، لكن تعذر رفع الفيديو من الجهاز: ${error.message}`);
      }
    }
  } else if (formId === "upload-form") {
    const fileData = new FormData(form);
    await api(`/api/admin/lessons/${encodeURIComponent(value.lessonId)}/resources`, { method: "POST", body: fileData });
  } else if (formId === "video-upload-form") {
    const fileData = new FormData(form);
    await api(`/api/admin/lessons/${encodeURIComponent(value.lessonId)}/video`, { method: "POST", body: fileData });
  } else if (formId === "exam-form") {
    const questions = collectExamQuestions(form);
    await api("/api/admin/exams", { method: "POST", body: JSON.stringify({
      course: value.course, lesson: value.lesson || undefined, title: value.title, questions,
      durationSeconds: Number(value.durationMinutes) * 60, maxAttempts: Number(value.maxAttempts), passPercent: Number(value.passPercent),
      published: data.has("published"), revealAnswers: data.has("revealAnswers")
    }) });
  } else if (formId === "announcement-form") {
    await api("/api/admin/announcements", { method: "POST", body: JSON.stringify({
      title: value.title, body: value.body, linkUrl: value.linkUrl || "",
      startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(),
      audience: value.audience, grade: value.grade || undefined, active: true
    }) });
  } else if (formId === "grant-form") {
    await api(`/api/admin/students/${encodeURIComponent(value.student)}/enrollments`, { method: "POST", body: JSON.stringify({ course: value.course }) });
  } else if (formId === "activation-code-form") {
    state.activationCode = await api("/api/admin/activation-codes", {
      method: "POST", body: JSON.stringify({ course: value.course })
    });
  } else if (formId === "student-search") {
    const result = await api(`/api/admin/students?q=${encodeURIComponent(value.q || "")}&summary=1`);
    const list = document.getElementById("students-list");
    list.innerHTML = result.students.map(student => `<article class="admin-student"><strong>${escapeHtml(student.displayName)}</strong><small>${escapeHtml(student.email)} · ${student.isActive ? "نشط" : "موقوف"} · ${student.enrollments.length} اشتراكات</small><div class="admin-actions"><button class="button button-small button-outline" data-action="student-status" data-id="${escapeHtml(student._id)}" data-active="${!student.isActive}">${student.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}</button></div></article>`).join("") || "<p>لا توجد نتائج.</p>";
    result.students.forEach(student => {
      const row = [...list.querySelectorAll(".admin-student")].find(item => item.querySelector(`[data-action='student-status'][data-id='${student._id}']`));
      row?.querySelectorAll("[data-action='student-status'],[data-action='revoke-enrollment']").forEach(button => button.remove());
      row?.querySelector(".admin-actions")?.insertAdjacentHTML("afterbegin", `<button class="button button-small button-primary" data-action="student-details" data-id="${escapeHtml(student._id)}">التفاصيل</button>`);
    });
    return;
  }
  const refreshed = await renderAdmin();
  if (!refreshed) {
    notify(savedCourse ? "تم إرسال الكورس للخادم، لكن تعذر تحديث القائمة. أعد تحميل لوحة الإدارة للتحقق." : "تم تنفيذ الطلب، لكن تعذر تحديث لوحة الإدارة.");
    return;
  }
  if (savedCourse) {
    const courseIsListed = state.adminCourses.some(course => String(course._id) === String(savedCourse._id));
    if (!courseIsListed) {
      notify("استجاب الخادم للحفظ، لكن الكورس لم يظهر في القائمة. أعد تحميل لوحة الإدارة وتحقق من الاتصال بقاعدة البيانات.");
      return;
    }
    if (!await loadCourses()) {
      notify("تم حفظ الكورس، لكن تعذر تحديث قائمة الكورسات المعروضة. أعد تحميل الصفحة للتحقق.");
      return;
    }
    notify(savedCourse.status === "published"
      ? "تم حفظ الكورس ونشره. سيظهر للطلاب."
      : "تم حفظ الكورس كمسودة. غيّر الحالة إلى «منشور» ليظهر للطلاب.");
    return;
  }
  notify(uploadedLessonVideo
    ? "تم حفظ الدرس ورفع الفيديو من الجهاز إلى قاعدة البيانات."
    : "تم حفظ التغيير وتحديث لوحة الإدارة.");
}

function bindAdminFormSubmissions() {
  const formIds = new Set(["grade-form", "course-form", "lesson-form", "upload-form", "video-upload-form", "exam-form", "announcement-form", "grant-form", "activation-code-form", "student-search"]);
  document.querySelectorAll("#admin-content form").forEach(form => {
    if (!formIds.has(form.getAttribute("id"))) return;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try { await handleAdminSubmit(form); }
      catch (error) { notify(error.message); }
    });
  });
}

document.addEventListener("click", async event => {
  const target = event.target.closest("button,a");
  if (!target) return;
  if (target.matches("[data-action='admin-exams-page']")) {
    document.getElementById("exam-management").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (target.matches("[data-action='add-exam-question']")) {
    const form = document.getElementById("exam-form");
    const list = document.getElementById("exam-question-list");
    if (list.children.length >= 200) { notify("الحد الأقصى هو 200 سؤال للامتحان."); return; }
    list.insertAdjacentHTML("beforeend", createExamQuestionCard());
    updateExamQuestionEditor(form);
    list.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (target.matches("[data-action='add-exam-option']")) {
    const card = target.closest("[data-exam-question]");
    const list = card.querySelector("[data-exam-option-list]");
    const index = list.children.length;
    if (index >= 10) { notify("لا يمكن إضافة أكثر من 10 اختيارات للسؤال."); return; }
    const id = card.dataset.questionId;
    list.insertAdjacentHTML("beforeend", `<div class="exam-option-row" data-exam-option><label><input type="radio" name="exam-correct-${id}" value="${index}" data-correct-option aria-label="الإجابة الصحيحة للاختيار ${index + 1}"><span>${index + 1}</span></label><input type="text" data-answer-option required maxlength="500" placeholder="الاختيار ${index + 1}"><button class="button button-small button-outline" type="button" data-action="remove-exam-option" aria-label="حذف الاختيار">حذف</button></div>`);
    updateExamQuestionEditor(document.getElementById("exam-form"));
    return;
  }
  if (target.matches("[data-action='remove-exam-option']")) {
    const card = target.closest("[data-exam-question]");
    const list = card.querySelector("[data-exam-option-list]");
    if (list.children.length <= 2) { notify("يجب أن يحتوي سؤال الاختيار من متعدد على اختيارين على الأقل."); return; }
    target.closest("[data-exam-option]").remove();
    [...list.children].forEach((row, index) => {
      row.querySelector("[data-correct-option]").value = String(index);
      row.querySelector("[data-answer-option]").placeholder = `الاختيار ${index + 1}`;
      row.querySelector("[data-correct-option]+span").textContent = String(index + 1);
    });
    return;
  }
  if (target.matches("[data-action='remove-exam-question']")) {
    const list = document.getElementById("exam-question-list");
    if (list.children.length <= 1) { notify("يجب أن يحتوي الامتحان على سؤال واحد على الأقل."); return; }
    target.closest("[data-exam-question]").remove();
    updateExamQuestionEditor(document.getElementById("exam-form"));
    return;
  }
  if (target.matches("[data-action='save-course']")) {
    event.preventDefault();
    const form = document.getElementById("course-form");
    if (!form || !form.reportValidity()) return;
    target.disabled = true;
    try { await handleAdminSubmit(form); }
    catch (error) { notify(error.message); target.disabled = false; }
    return;
  }
  if (target.matches(".modal-close") || target.id === "modal-backdrop") { modalClose(); return; }
  if (target.matches("[data-view]")) { event.preventDefault(); showView(target.dataset.view); return; }
  if (target instanceof HTMLAnchorElement && target.hash && document.getElementById(`view-${target.hash.slice(1)}`)) {
    event.preventDefault(); showView(target.hash.slice(1)); return;
  }
  if (target.matches("[data-course]") && !target.dataset.action) { event.preventDefault(); await openCourse(target.dataset.course); return; }
  if (target.matches("[data-grade]")) {
    state.activeFilter = target.dataset.grade;
    document.querySelectorAll(".filter-button").forEach(button => button.classList.toggle("selected", button.dataset.filter === state.activeFilter));
    showView("courses"); return;
  }
  if (target.matches("[data-filter]")) {
    state.activeFilter = target.dataset.filter;
    document.querySelectorAll(".filter-button").forEach(button => button.classList.toggle("selected", button === target));
    renderCourses(); return;
  }
  if (target.matches("[data-course-category]")) {
    state.activeCourseCategory = target.dataset.courseCategory;
    state.activeFilter = "الكل";
    document.querySelectorAll("[data-course-category]").forEach(button => button.classList.toggle("selected", button === target));
    if (state.activeCourseCategory === "mine") await loadMyCourses();
    else renderCourses();
    return;
  }
  if (target.matches("[data-action='login'],[data-action='signup']")) { event.preventDefault(); if (target.dataset.action === "signup") initializeSignupForm(); showView(target.dataset.action); return; }
  if (target.matches("[data-signup-next]")) {
    const form = document.getElementById("signup-form");
    if (validateSignupStep(form, state.signupStep)) setSignupStep(state.signupStep + 1);
    return;
  }
  if (target.matches("[data-signup-prev]")) { setSignupStep(state.signupStep - 1); return; }
  if (target.matches("[data-password-toggle]")) {
    const input = target.closest(".password-field").querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
    target.textContent = input.type === "password" ? "إظهار" : "إخفاء";
    return;
  }
  if (target.matches("[data-action='logout']")) {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); state.user = null; updateIdentity(); notify("تم تسجيل الخروج."); showView("home"); }
    catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-action='copy-activation-code']")) {
    try {
      await navigator.clipboard.writeText(state.activationCode.code);
      notify("تم نسخ كود الاشتراك.");
    } catch (error) { notify("تعذر النسخ تلقائيًا. حدّد الكود وانسخه يدويًا."); }
    return;
  }
  if (target.matches("[data-action='enroll-course']")) { await enrollCourse(target.dataset.course); return; }
  if (target.matches("[data-action='confirm-payment']")) { await startCourseEnrollment(); return; }
  if (target.matches("[data-action='course-content']")) { await openCourseContent(target.dataset.course); return; }
  if (target.matches("[data-lesson]")) { await openLesson(target.dataset.lesson); return; }
  if (target.matches("[data-course-content]")) { await openCourseContent(target.dataset.courseContent); return; }
  if (target.matches("[data-action='lesson-prev'],[data-action='lesson-next']")) {
    const id = state.lessonIds[Number(target.dataset.index)];
    if (id) await openLesson(id);
    return;
  }
  if (target.matches("[data-action='complete-lesson']")) {
    try {
      await api(`/api/lessons/${encodeURIComponent(target.dataset.lesson)}/progress`, { method: "POST", body: JSON.stringify({ completed: true }) });
      notify("تم حفظ تقدمك.");
      await openCourseContent(state.activeCourseId);
    }
    catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-exam]")) {
    if (target.closest("#exam-form")) return;
    if (target.dataset.exam) { showView("exams"); await startExam(target.dataset.exam); }
    return;
  }
  if (target.matches("[data-action='dismiss-announcement']")) {
    const key = `dismissed-announcements-${state.user?.id || "visitor"}`;
    const dismissed = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    dismissed.add(target.dataset.id);
    localStorage.setItem(key, JSON.stringify([...dismissed]));
    document.getElementById("announcement-slot").innerHTML = "";
    return;
  }
  if (target.matches("[data-action='student-status']")) {
    try { await api(`/api/admin/students/${encodeURIComponent(target.dataset.id)}/status`, { method: "PATCH", body: JSON.stringify({ isActive: target.dataset.active === "true" }) }); modalClose(); await renderAdmin(); }
    catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-action='student-details']")) {
    await showStudentDetails(target.dataset.id);
    return;
  }
  if (target.matches("[data-action='revoke-enrollment']")) {
    try { await api(`/api/admin/students/${encodeURIComponent(target.dataset.id)}/enrollments/${encodeURIComponent(target.dataset.course)}`, { method: "DELETE" }); modalClose(); notify("تم سحب صلاحية الكورس."); await renderAdmin(); }
    catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-action='delete-course']")) {
    if (!confirm("حذف الكورس أو إخفاؤه؟ إذا كان له سجل اشتراك فسيُخفى بدل حذف السجل.")) return;
    try { await api(`/api/admin/courses/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" }); await renderAdmin(); notify("تم تحديث الكورس."); }
    catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-action='edit-course']")) {
    const course = state.adminCourses.find(item => String(item._id) === target.dataset.id);
    if (!course) return;
    const form = document.getElementById("course-form");
    form.elements.id.value = course._id;
    for (const key of ["title", "description", "instructor", "imageUrl", "status"]) form.elements[key].value = course[key] || "";
    form.elements.grade.value = course.grade?._id || course.grade || "";
    form.elements.price.value = ((course.priceCents || 0) / 100).toFixed(2);
    form.elements.isFree.checked = course.isFree;
    form.elements.price.min = course.isFree ? "0" : "0.01";
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (target.matches("[data-action='edit-lesson']")) {
    const lesson = state.adminLessons.find(item => String(item._id) === target.dataset.id);
    if (!lesson) return;
    const form = document.getElementById("lesson-form");
    form.elements.id.value = lesson._id;
    form.elements.course.value = lesson.course?._id || lesson.course || "";
    form.elements.title.value = lesson.title;
    form.elements.description.value = lesson.description || "";
    form.elements.videoUrl.value = lesson.videoUrl || "";
    form.elements.position.value = lesson.position || 0;
    form.elements.published.checked = Boolean(lesson.published);
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (target.matches("[data-action='delete-lesson']")) {
    if (!confirm("حذف الدرس والامتحانات المرتبطة به؟")) return;
    try {
      await api(`/api/admin/lessons/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE" });
      await renderAdmin();
      notify("تم حذف الدرس.");
    } catch (error) { notify(error.message); }
    return;
  }
  if (target.matches("[data-action='toggle-announcement']")) {
    try {
      await api(`/api/admin/announcements/${encodeURIComponent(target.dataset.id)}`, {
        method: "PATCH", body: JSON.stringify({ active: target.dataset.active === "true" })
      });
      await renderAdmin();
    } catch (error) { notify(error.message); }
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  const formId = form.getAttribute("id");
  if (formId === "redeem-code-form") {
    event.preventDefault();
    await redeemActivationCode(form);
    return;
  }
  if (formId === "login-form" || formId === "signup-form") {
    event.preventDefault();
    const signup = formId === "signup-form";
    if (signup && !validateSignupStep(form, 3)) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (signup) delete data.confirmPassword;
    const submitButton = form.querySelector("[type='submit']:not([hidden])");
    const errorElement = document.getElementById(signup ? "signup-error" : "login-error");
    if (submitButton) submitButton.disabled = true;
    if (errorElement) errorElement.textContent = "";
    try {
      const response = await api(`/api/auth/${signup ? "register" : "login"}`, { method: "POST", body: JSON.stringify(data) });
      state.user = response.user;
      updateIdentity();
      notify(signup ? "تم إنشاء الحساب." : "تم تسجيل الدخول.");
      const coursesLoaded = await loadCourses();
      const returnId = state.returnCourseId;
      state.returnCourseId = null;
      if (returnId && coursesLoaded && !state.courses.some(course => courseId(course) === returnId)) {
        notify("هذا الكورس من صف آخر. اختر كورسًا من صفك.");
        showView("courses");
      } else if (returnId) await enrollCourse(returnId);
      else showView(state.user.role === "admin" ? "admin" : "dashboard");
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message || "تعذر إكمال العملية.";
      else notify(error.message);
      if (submitButton) submitButton.disabled = false;
    }
    return;
  }
  if (formId === "attempt-form") { event.preventDefault(); await submitExam(form); return; }
  if (formId === "contact-form") {
    event.preventDefault();
    document.getElementById("contact-feedback").textContent = "لم يتم إعداد خدمة استقبال الرسائل بعد.";
    return;
  }
});

document.addEventListener("change", event => {
  const input = event.target;
  if (input instanceof HTMLSelectElement && input.matches("[data-question-type]")) {
    updateExamQuestionEditor(document.getElementById("exam-form"));
    return;
  }
  if (!(input instanceof HTMLInputElement) || input.form?.getAttribute("id") !== "course-form" || input.name !== "isFree") return;
  const price = input.form.elements.price;
  price.min = input.checked ? "0" : "0.01";
  if (input.checked) price.value = "0";
  else if (Number(price.value) <= 0) price.value = "1.00";
});

document.addEventListener("input", event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.form?.getAttribute("id") !== "course-form" || input.name !== "price") return;
  if (Number(input.value) > 0) {
    input.form.elements.isFree.checked = false;
    input.min = "0.01";
  }
});

document.addEventListener("invalid", event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) ||
      input.form?.getAttribute("id") !== "course-form") return;
  notify(input.name === "price"
    ? "أدخل سعرًا موجبًا للكورس المدفوع، أو اختر «مجاني»."
    : "أكمل الحقول المطلوبة قبل حفظ الكورس.");
}, true);

document.getElementById("course-search").addEventListener("input", renderCourses);
document.querySelector(".menu-toggle").addEventListener("click", event => {
  const nav = document.querySelector(".main-nav");
  const opened = nav.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(opened));
});
document.getElementById("theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("math-platform-dark", String(document.body.classList.contains("dark")));
  updateThemeButton();
});
window.addEventListener("popstate", () => restoreRoute(location.hash.slice(1)));

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  initializeHomepageReveal();
  const savedTheme = localStorage.getItem("math-platform-dark");
  document.body.classList.toggle("dark", savedTheme === null ? matchMedia("(prefers-color-scheme: dark)").matches : savedTheme === "true");
  updateThemeButton();
  try {
    const [, bootstrap] = await Promise.all([getCsrf(), api("/api/bootstrap")]);
    applyBootstrap(bootstrap);
    initializeSignupForm();
    const route = location.hash.slice(1);
    const isPaymentReturn = new URLSearchParams(location.search).has("merchantOrderId");
    if (state.user && location.pathname === "/" && !route && !isPaymentReturn) showView("dashboard");
    else if (route) restoreRoute(route);
    if (isPaymentReturn) renderPaymentReturn();
  } catch (error) {
    notify(`تعذر الاتصال بالخادم: ${error.message}`);
  } finally {
    document.body.classList.remove("app-loading");
    document.getElementById("app-loading")?.remove();
  }
}

init();
