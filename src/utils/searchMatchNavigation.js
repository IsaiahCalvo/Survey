/**
 * searchMatchNavigation.js — pure helpers behind text-search navigation.
 *
 * UX (owner 2026-09-23: "when I click, I should be directly brought to it,
 * zoomed in and centered on whatever it is that it found"):
 *   - a picked match lands in the middle of the part of the PDF you can
 *     actually see — not under the open side panel, not under the phone sheet;
 *   - the view zooms in to a comfortable reading size for that line of text,
 *     but never zooms OUT (if you are already closer than that, it just
 *     centers);
 *   - the result list shows a short line of text centered on the match.
 * Kept free of React/DOM so the rules are unit-tested (tests/searchMatchNavigation.test.mjs).
 */

// On-screen height we aim for a matched line of text, in CSS px. 18px reads
// like body text on a laptop; the phone uses a touch smaller target because
// its viewport is a third as wide and 18px there already fills a lot of it.
export const SEARCH_READABLE_TEXT_PX = 18;
export const SEARCH_READABLE_TEXT_PX_PHONE = 16;
// Never jump past this zoom for a search hit, however small the text is —
// deeper zooms are for a person to choose, not for a jump to surprise them.
export const SEARCH_MAX_AUTO_SCALE = 4;
// The match (plus a little context) must stay inside this share of the
// visible width, so a long phrase is never zoomed so far it runs off-screen.
export const SEARCH_MAX_MATCH_WIDTH_SHARE = 0.7;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * Pick the zoom a search jump should land at.
 * @param {object} input
 * @param {number} input.currentScale   viewer scale now (1 = 100%)
 * @param {number} input.lineHeight     height of the matched text line, PDF points
 * @param {number} input.matchWidth     width of the match bounds, PDF points
 * @param {number} input.visibleWidth   width of the unobstructed PDF area, CSS px
 * @param {number} [input.targetTextPx] desired on-screen line height
 * @param {number} [input.maxScale]     hard ceiling
 * @returns {number} the scale to use (>= currentScale)
 */
export function resolveReadableSearchScale({
  currentScale,
  lineHeight,
  matchWidth,
  visibleWidth,
  targetTextPx = SEARCH_READABLE_TEXT_PX,
  maxScale = SEARCH_MAX_AUTO_SCALE,
} = {}) {
  const current = Math.max(0.01, finite(currentScale, 1));
  const height = finite(lineHeight, 0);
  if (!(height > 0)) return current;

  let target = finite(targetTextPx, SEARCH_READABLE_TEXT_PX) / height;
  const width = finite(matchWidth, 0);
  const visible = finite(visibleWidth, 0);
  if (width > 0 && visible > 0) {
    target = Math.min(target, (visible * SEARCH_MAX_MATCH_WIDTH_SHARE) / width);
  }
  target = Math.min(target, Math.max(current, finite(maxScale, SEARCH_MAX_AUTO_SCALE)));
  // Never zoom out: a jump only ever brings the text closer.
  return Math.max(current, target);
}

/**
 * How much of the scroller each overlaying panel hides.
 * @param {{left:number,top:number,right:number,bottom:number}} containerRect
 * @param {Array<{left:number,top:number,right:number,bottom:number}>} occluderRects
 * @returns {{left:number,right:number,top:number,bottom:number}}
 */
export function resolveViewerOcclusionInsets(containerRect, occluderRects = []) {
  const insets = { left: 0, right: 0, top: 0, bottom: 0 };
  if (!containerRect) return insets;
  const cLeft = finite(containerRect.left);
  const cRight = finite(containerRect.right);
  const cTop = finite(containerRect.top);
  const cBottom = finite(containerRect.bottom);
  const cWidth = cRight - cLeft;
  const cHeight = cBottom - cTop;
  if (!(cWidth > 0) || !(cHeight > 0)) return insets;

  for (const rect of occluderRects) {
    if (!rect) continue;
    const left = Math.max(cLeft, finite(rect.left));
    const right = Math.min(cRight, finite(rect.right));
    const top = Math.max(cTop, finite(rect.top));
    const bottom = Math.min(cBottom, finite(rect.bottom));
    if (!(right - left > 1) || !(bottom - top > 1)) continue;

    const spansWidth = (right - left) >= cWidth * 0.6;
    const spansHeight = (bottom - top) >= cHeight * 0.6;
    if (spansWidth && !spansHeight) {
      // A sheet across the bottom (phone) or a bar across the top.
      if (bottom >= cBottom - 1) insets.bottom = Math.max(insets.bottom, cBottom - top);
      else if (top <= cTop + 1) insets.top = Math.max(insets.top, bottom - cTop);
    } else if (spansHeight && !spansWidth) {
      // A side panel.
      if (left <= cLeft + 1) insets.left = Math.max(insets.left, right - cLeft);
      else if (right >= cRight - 1) insets.right = Math.max(insets.right, cRight - left);
    }
  }

  // Always leave a usable window, however much is covered.
  const minVisible = 80;
  if (cWidth - insets.left - insets.right < minVisible) {
    insets.left = 0;
    insets.right = 0;
  }
  if (cHeight - insets.top - insets.bottom < minVisible) {
    insets.top = 0;
    insets.bottom = 0;
  }
  return insets;
}

/**
 * Where a match center sits relative to the visible-area center (CSS px).
 * Used by the diagnostics and the end-to-end measurements.
 */
export function measureCenterOffset(matchRect, containerRect, insets = {}) {
  if (!matchRect || !containerRect) return null;
  const visLeft = finite(containerRect.left) + finite(insets.left);
  const visRight = finite(containerRect.right) - finite(insets.right);
  const visTop = finite(containerRect.top) + finite(insets.top);
  const visBottom = finite(containerRect.bottom) - finite(insets.bottom);
  const cx = finite(matchRect.left) + finite(matchRect.width) / 2;
  const cy = finite(matchRect.top) + finite(matchRect.height) / 2;
  return {
    dx: Math.round(cx - (visLeft + visRight) / 2),
    dy: Math.round(cy - (visTop + visBottom) / 2),
  };
}

const SNIPPET_WHITESPACE = /\s+/g;

/**
 * A short, single-line piece of the page text with the match in the middle.
 * Cuts on word boundaries where it can and marks cut ends with an ellipsis.
 * @returns {{ snippet: string, matchIndex: number, matchLength: number }}
 */
export function buildSearchSnippet(text, start, end, radius = 34) {
  if (typeof text !== 'string' || !text || !(end > start)) {
    return { snippet: '', matchIndex: -1, matchLength: 0 };
  }
  const clean = (value) => value.replace(SNIPPET_WHITESPACE, ' ');
  let from = Math.max(0, start - radius);
  let to = Math.min(text.length, end + radius);
  // Pull the cut points to the nearest word boundary inside the window so the
  // row never starts or ends mid-word (unless the word is the whole window).
  if (from > 0) {
    const space = text.slice(from, start).search(/\s/);
    if (space >= 0 && from + space + 1 < start) from = from + space + 1;
  }
  if (to < text.length) {
    const tail = text.slice(end, to);
    const lastSpace = tail.search(/\s[^\s]*$/);
    if (lastSpace > 0) to = end + lastSpace;
  }
  const before = clean(text.slice(from, start)).replace(/^\s+/, '');
  const match = clean(text.slice(start, end));
  const after = clean(text.slice(end, to)).replace(/\s+$/, '');
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  const snippet = `${prefix}${before}${match}${after}${suffix}`;
  return {
    snippet,
    matchIndex: prefix.length + before.length,
    matchLength: match.length,
  };
}

/**
 * Should a separator go between two consecutive pdf.js text items? Drawings
 * place labels as separate items with no space between them, so gluing them
 * straight together made rows like "Card ReaderDoor Contact" and stopped a
 * search for "reader door" from matching.
 */
export function needsTextItemSeparator(previous, next) {
  if (!previous || !next) return false;
  const prevStr = typeof previous.str === 'string' ? previous.str : '';
  const nextStr = typeof next.str === 'string' ? next.str : '';
  if (!prevStr || !nextStr) return false;
  if (/\s$/.test(prevStr) || /^\s/.test(nextStr)) return false;
  if (previous.hasEOL) return true;
  const pt = previous.transform;
  const nt = next.transform;
  if (!Array.isArray(pt) || !Array.isArray(nt)) return false;
  const fontHeight = Math.max(1, Math.abs(finite(previous.height, 0)) || Math.hypot(finite(pt[2]), finite(pt[3])) || 1);
  // Different baseline → a different line.
  if (Math.abs(finite(nt[5]) - finite(pt[5])) > fontHeight * 0.5) return true;
  // Same line: a visible gap after the previous item's end means a new word.
  const prevEnd = finite(pt[4]) + finite(previous.width);
  const gap = finite(nt[4]) - prevEnd;
  return gap > fontHeight * 0.2 || gap < -fontHeight * 0.5;
}
