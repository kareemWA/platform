function getCurrentWeekActivity(date = new Date()) {
  const today = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sunday = new Date(today);
  sunday.setUTCDate(today.getUTCDate() - today.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + index);
    return { dateKey: day.toISOString().slice(0, 10), watchedSeconds: 0, completedLessons: 0 };
  });
}

module.exports = { getCurrentWeekActivity };
