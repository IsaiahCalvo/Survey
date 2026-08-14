export function createAnalyticsRateLimiter({
  maxEventsPerMinute = 30,
  maxEventsPerSession = 300,
  now = () => Date.now(),
} = {}) {
  let sessionCount = 0;
  let recent = [];

  return {
    allow() {
      const timestamp = now();
      recent = recent.filter((entry) => timestamp - entry < 60_000);
      if (sessionCount >= maxEventsPerSession || recent.length >= maxEventsPerMinute) {
        return false;
      }
      sessionCount += 1;
      recent.push(timestamp);
      return true;
    },
    snapshot() {
      return { recentCount: recent.length, sessionCount };
    },
  };
}
