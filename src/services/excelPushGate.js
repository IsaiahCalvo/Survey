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
