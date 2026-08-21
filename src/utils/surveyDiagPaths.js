/** Diagnostic Save Log paths — never hardcode a developer home directory. */

export function surveyTestLogsDir(homeDir) {
  const home = String(homeDir || '').replace(/\/+$/, '');
  if (!home) return null;
  return `${home}/Desktop/Survey-BetaSafeS2/TestLogs`;
}

export function surveyGlobalLogPath(homeDir) {
  const home = String(homeDir || '').replace(/\/+$/, '');
  if (!home) return null;
  return `${home}/Desktop/Survey-BetaSafeS2/1.log`;
}

export async function resolveSurveyHomeDir() {
  try {
    const home = await window.electronAPI?.getHomeDir?.();
    return home || null;
  } catch {
    return null;
  }
}
