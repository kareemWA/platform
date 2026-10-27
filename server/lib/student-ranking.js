function calculateStudentRanking({ studentIds, currentStudentId, enrollments, lessons, progress, exams, attempts }) {
  const enrolledCourses = new Map(studentIds.map(id => [String(id), new Set()]));
  enrollments.forEach(row => enrolledCourses.get(String(row.user))?.add(String(row.course)));

  const lessonsByCourse = new Map();
  lessons.forEach(lesson => {
    const courseId = String(lesson.course);
    if (!lessonsByCourse.has(courseId)) lessonsByCourse.set(courseId, []);
    lessonsByCourse.get(courseId).push(lesson);
  });
  const progressByStudentLesson = new Map(progress.map(row => [`${row.user}:${row.lesson}`, row]));
  const examsByCourse = new Map();
  exams.forEach(exam => {
    const courseId = String(exam.course);
    if (!examsByCourse.has(courseId)) examsByCourse.set(courseId, []);
    examsByCourse.get(courseId).push(exam);
  });
  const bestAttemptByStudentExam = new Map();
  attempts.forEach(attempt => {
    const key = `${attempt.user}:${attempt.exam}`;
    const percent = Number(attempt.maxScore) > 0
      ? Math.max(0, Math.min(100, Number(attempt.score) / Number(attempt.maxScore) * 100))
      : 0;
    if (percent > (bestAttemptByStudentExam.get(key) ?? 0)) bestAttemptByStudentExam.set(key, percent);
  });

  const scores = studentIds.map(studentId => {
    const courses = enrolledCourses.get(String(studentId)) || new Set();
    const studentLessons = [...courses].flatMap(courseId => lessonsByCourse.get(courseId) || []);
    let durationSeconds = 0;
    let watchedSeconds = 0;
    let completedLessons = 0;
    for (const lesson of studentLessons) {
      const row = progressByStudentLesson.get(`${studentId}:${lesson._id}`);
      const duration = Number(row?.durationSeconds) || Number(lesson.durationMinutes || 0) * 60;
      const watched = Math.min(Number(row?.watchedSeconds) || 0, duration || Number(row?.watchedSeconds) || 0);
      durationSeconds += duration;
      watchedSeconds += row?.completedAt && duration ? duration : watched;
      if (row?.completedAt) completedLessons += 1;
    }
    const lessonScore = durationSeconds
      ? watchedSeconds / durationSeconds * 100
      : studentLessons.length ? completedLessons / studentLessons.length * 100 : null;

    const studentExams = [...courses].flatMap(courseId => examsByCourse.get(courseId) || []);
    const examScore = studentExams.length
      ? studentExams.reduce((sum, exam) => sum + (bestAttemptByStudentExam.get(`${studentId}:${exam._id}`) || 0), 0) / studentExams.length
      : null;
    const availableScores = [lessonScore, examScore].filter(score => score !== null);
    return {
      studentId: String(studentId),
      score: availableScores.length
        ? Math.round(availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length * 100) / 100
        : 0
    };
  });

  const current = scores.find(row => row.studentId === String(currentStudentId));
  if (!current) return null;
  return {
    rank: 1 + scores.filter(row => row.score > current.score).length,
    total: scores.length
  };
}

module.exports = { calculateStudentRanking };
