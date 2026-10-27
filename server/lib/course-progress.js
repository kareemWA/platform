function calculateCourseProgress(lessons, progressRows) {
  const progressByLesson = new Map(progressRows.map(row => [String(row.lesson), row]));
  let watchedSeconds = 0;
  let durationSeconds = 0;
  let completed = 0;
  let progressTotal = 0;

  const lessonRows = lessons.map(lesson => {
    const progress = progressByLesson.get(String(lesson._id));
    const duration = Number(progress?.durationSeconds) || Number(lesson.durationMinutes || 0) * 60;
    const isCompleted = Boolean(progress?.completedAt);
    const watched = isCompleted && duration
      ? duration
      : Math.min(Number(progress?.watchedSeconds) || 0, duration || Number(progress?.watchedSeconds) || 0);
    const percent = duration
      ? Math.round(watched / duration * 100)
      : isCompleted ? 100 : 0;

    durationSeconds += duration;
    watchedSeconds += watched;
    if (isCompleted) completed += 1;
    progressTotal += percent;

    return {
      ...lesson,
      watchedSeconds: watched,
      durationSeconds: duration,
      completed: isCompleted,
      percent
    };
  });

  return {
    lessons: lessonRows,
    completed,
    total: lessonRows.length,
    watchedSeconds,
    durationSeconds,
    percent: lessonRows.length ? Math.round(progressTotal / lessonRows.length) : 0
  };
}

function calculateOverallCourseProgress(courseRows) {
  const totalLessons = courseRows.reduce((sum, row) => sum + row.total, 0);
  if (!totalLessons) return 0;
  return Math.round(courseRows.reduce((sum, row) => sum + row.percent * row.total, 0) / totalLessons);
}

function mergeLessonProgress(previous, input) {
  return {
    watchedSeconds: input.watchedSeconds === undefined
      ? previous?.watchedSeconds
      : Math.max(input.watchedSeconds, Number(previous?.watchedSeconds) || 0),
    durationSeconds: input.durationSeconds === undefined
      ? previous?.durationSeconds
      : Math.max(input.durationSeconds, Number(previous?.durationSeconds) || 0)
  };
}

module.exports = { calculateCourseProgress, calculateOverallCourseProgress, mergeLessonProgress };
