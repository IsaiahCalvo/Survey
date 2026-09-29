/**
 * moveCommit.js — one rule for where a moved mark lands (w59, 2026-09-28).
 *
 * Owner bug: "When I Command-drag, I can drag it, but when I release it, it
 * just snaps back." The drag preview and the save used DIFFERENT rules:
 *   - the preview followed the pointer with no page clamp at all, while the
 *     save pushed each mark's box back inside the page with constrainToPage
 *     (so a mark dragged past the page edge, or one that already hung over
 *     it — common on imported / older marks — jumped on release);
 *   - a group drag clamped every member on its own (members slid apart) and
 *     did not clamp callouts at all;
 *   - the save looked the mark up by its drag-start list position, so a
 *     collaborator's add / delete during the drag made the save miss the mark
 *     (nothing saved, the preview cleared: a snap back);
 *   - the "moved at all?" test was 2 page units, which at high zoom is a real
 *     visible drag that then saved nothing.
 *
 * UX rule now (same as the arrow-key nudge, clampNudgeDelta): the selection
 * moves as ONE rigid piece; it can never be dragged further off the page, and
 * a mark that already hangs over an edge is never yanked back in. The preview
 * shows exactly the delta the save writes, so what you see when you let go is
 * where it stays. If nothing can be saved, the preview ends where the mark
 * really is and one [MoveDiag] line says why.
 *
 * Pure JS — the Node test runner imports this directly.
 */
import { clampNudgeDelta } from './annotationFamilyRules.js';

/** A page object's stable id (same convention as dragCommitMerge / markLock). */
export function markIdOf(object) {
  const id = object?.data?.id ?? object?.id ?? null;
  return id == null || id === '' ? null : String(id);
}

/**
 * Where the dragged mark is in the page list NOW. Found by id when it has
 * one (a collaborator may have added / removed marks during the drag); an
 * id-less legacy mark falls back to its drag-start index. -1 = gone.
 */
export function resolveMarkIndex(objects, startIndex, markId) {
  const list = Array.isArray(objects) ? objects : [];
  if (markId != null) {
    if (markIdOf(list[startIndex]) === markId) return startIndex;
    return list.findIndex((object) => markIdOf(object) === markId);
  }
  return list[startIndex] ? startIndex : -1;
}

/**
 * The delta a drag both previews and saves: the pointer's page delta, clamped
 * as one rigid piece against the page (boxes = the dragged marks' drag-start
 * boxes in page units). Non-finite input never moves anything.
 */
export function clampMoveDelta(boxes, dx, dy, pageWidth, pageHeight) {
  const rawDx = Number.isFinite(dx) ? dx : 0;
  const rawDy = Number.isFinite(dy) ? dy : 0;
  return clampNudgeDelta(boxes, rawDx, rawDy, pageWidth, pageHeight);
}

/**
 * Did the pointer travel far enough to count as a drag (not a click)? The old
 * rule was 2 page units, which is 16 px at 800 % zoom; this is 2 screen
 * pixels at high zoom and never more than 2 page units zoomed out.
 * `inverseScale` = page units per screen pixel.
 */
export function moveCommitThreshold(inverseScale) {
  const inv = Number(inverseScale);
  return Number.isFinite(inv) && inv > 0 ? Math.min(2, 2 * inv) : 2;
}

export function isBeyondMoveThreshold(dx, dy, inverseScale) {
  const threshold = moveCommitThreshold(inverseScale);
  return Math.abs(Number(dx) || 0) > threshold || Math.abs(Number(dy) || 0) > threshold;
}

/**
 * One diagnostic line when a real drag (past the click threshold) ends
 * without saving. Cheap, permanent, names the PDF (diagnostic-log rule).
 */
export function describeDroppedMove({
  reason, mode, type = null, id = null, dx = 0, dy = 0, pageNumber = null, pdfName = null,
} = {}) {
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
  return `[MoveDiag] drag ended without saving reason=${reason} pdf=${pdfName || 'unknown.pdf'} page=${pageNumber ?? '?'} mode=${mode} type=${type ?? '?'} id=${id ?? '?'} dx=${round(dx)} dy=${round(dy)}`;
}

export function reportDroppedMove(details) {
  try {
    const pdfName = typeof window !== 'undefined' ? window.__currentPdfName : null;
    console.warn(describeDroppedMove({ pdfName, ...details }));
  } catch (_) { /* diagnostics never break a drag */ }
}
