// Excel audit W5: "Push to Excel" rebuilds the whole linked workbook from the app,
// so anything typed in Excel since the last pull was overwritten (worst on a free
// OneDrive, which has no automatic pull). A push now pulls first; these decide
// whether the push may go ahead once that pull has run.

/** What the pull before a push ended with. */
export const PULL_BEFORE_PUSH = Object.freeze({
  DONE: 'done',       // imported (or nothing to import)
  MISSING: 'missing', // the linked file is not there: the push recreates it
  PAUSED: 'paused',   // waiting on the new-columns choice
  FAILED: 'failed',   // could not read the file
  FOREIGN: 'foreign', // the file belongs to another survey on the same template (W9)
});

/** The push may go ahead only after a finished pull, or when there is no file to lose. */
export function pullAllowsPush(status) {
  return status === PULL_BEFORE_PUSH.DONE || status === PULL_BEFORE_PUSH.MISSING;
}

/**
 * True when a row tied to a live marker is still waiting for a choice (changed on
 * both sides, pasted above its original, a duplicate...). Pushing then would
 * overwrite Excel's side of it, so the push waits for the answer. Rows the app
 * could not place at all (no marker, e.g. the row of a marker deleted in the app)
 * do not hold it: the push is what clears them.
 *
 * @param {Array|null} pendingImportReview
 * @param {object|null} markers  surveyMarkers by id
 */
export function hasRowWaitingOnChoice(pendingImportReview, markers) {
  return (pendingImportReview || []).some(
    (entry) => Boolean(entry?.markerId) && Boolean(markers?.[entry.markerId])
  );
}

/**
 * The linked workbook's version, read just before the pull: a OneDrive/SharePoint
 * file's eTag, or a local file's time and size. The push then writes only if the
 * file is still at this version, so an edit saved in Excel between the pull and the
 * write is not overwritten. null when it can't be read (the push goes ahead as before).
 *
 * @param {{ oneDriveFileId?: string|null, localPath?: string|null,
 *           getDriveItem?: (id: string) => Promise<{eTag?: string}|null>,
 *           getFileStats?: (path: string) => Promise<object|null> }} source
 */
export async function readWorkbookVersion({ oneDriveFileId, localPath, getDriveItem, getFileStats }) {
  try {
    if (oneDriveFileId && getDriveItem) {
      const item = await getDriveItem(oneDriveFileId);
      return item?.eTag ? `etag:${item.eTag}` : null;
    }
    if (localPath && getFileStats) {
      const stats = await getFileStats(localPath);
      const mtime = stats?.mtimeMs ?? stats?.mtime ?? null;
      if (!stats || stats.isFile === false || mtime == null) return null;
      return `file:${mtime}|${stats.size ?? ''}`;
    }
  } catch { /* unknown version */ }
  return null;
}

/** The eTag to send as If-Match with the upload, or null for a local file / no version. */
export function uploadIfMatch(version) {
  return typeof version === 'string' && version.startsWith('etag:') ? version.slice(5) : null;
}

/** True when the file moved on since the pull read it. No version read means no check. */
export function workbookChangedSincePull(pulledVersion, currentVersion) {
  return Boolean(pulledVersion) && pulledVersion !== currentVersion;
}

/** Microsoft's answer to an upload whose If-Match no longer matches the file. */
export function isVersionMismatch(error) {
  return error?.statusCode === 412 || error?.status === 412 || error?.code === 'preconditionFailed';
}
