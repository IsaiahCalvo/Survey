function templateProjectionKey(template) {
  const linkedExcelPath = String(template?.linkedExcelPath || '').trim();
  if (!linkedExcelPath) return null;
  return String(
    template?.supabaseId
    ?? template?.id
    ?? linkedExcelPath,
  );
}

function workbookProjectionKey(template) {
  const linkedExcelPath = String(template?.linkedExcelPath || '').trim();
  if (!linkedExcelPath) return null;
  // Keep the exact linked destination in the durable projection even when the
  // template itself has a stable database id. A template can be relinked from
  // A.xlsx to B.xlsx; template id alone would replay A's pending deletion into B.
  return JSON.stringify({
    linkedExcelPath,
    isOneDrive: template?.isOneDrive === true,
    oneDriveFileId: String(template?.oneDriveFileId || ''),
    oneDriveApiPath: String(template?.oneDriveApiPath || ''),
    sharePointDriveId: String(template?.sharePointDriveId || ''),
  });
}

/**
 * Capture whether an erase must update a linked workbook while the template is
 * known. The durable outbox carries this context across reloads; a temporarily
 * unhydrated template must not make the effect look successfully completed.
 */
export function captureEraseExcelProjection(template) {
  const templateKey = templateProjectionKey(template);
  const workbookKey = workbookProjectionKey(template);
  return templateKey
    ? { required: true, templateKey, workbookKey }
    : { required: false, templateKey: null, workbookKey: null };
}

/**
 * Return false when this erase never required Excel. Throw while the linked
 * template is absent or different so the outbox remains pending and retries.
 */
export function requireEraseExcelProjectionReady(projection, template) {
  if (projection?.required !== true) return false;
  const currentTemplateKey = templateProjectionKey(template);
  const currentWorkbookKey = workbookProjectionKey(template);
  if (
    !currentTemplateKey
    || !currentWorkbookKey
    || currentTemplateKey !== String(projection.templateKey || '')
    || currentWorkbookKey !== String(projection.workbookKey || '')
  ) {
    throw new Error('erase Excel template context is not ready');
  }
  return true;
}
