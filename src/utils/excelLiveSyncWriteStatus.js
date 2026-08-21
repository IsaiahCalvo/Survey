/**
 * Classify a Live-Sync / session sheet-write batch so a total failure
 * cannot report as a successful Push.
 */
export function excelLiveSyncWriteStatus({ okCount = 0, failCount = 0 } = {}) {
  const ok = Number(okCount) || 0;
  const fail = Number(failCount) || 0;
  if (fail > 0 && ok === 0) return 'all-failed';
  if (fail > 0) return 'partial';
  return 'ok';
}
