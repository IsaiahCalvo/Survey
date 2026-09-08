// Web Locks cover every tab/worker in this origin. A process-local promise
// queue is not a safe substitute for the shared pending-attempt record.
export async function withExcelSyncLock({ documentId, templateId, workbookId }, task, {
  locks = globalThis.navigator?.locks,
} = {}) {
  if (!documentId || !templateId || !workbookId) throw new Error('Excel sync lock requires the complete workbook scope');
  if (typeof locks?.request !== 'function') {
    const error = new Error('This app environment cannot safely coordinate Excel sync across tabs. Open Survey in an updated browser to sync this workbook.');
    error.code = 'EXCEL_SYNC_LOCK_UNAVAILABLE';
    throw error;
  }
  const name = `survey:excel-sync:${JSON.stringify([documentId, templateId, workbookId])}`;
  return locks.request(name, { mode: 'exclusive' }, task);
}
