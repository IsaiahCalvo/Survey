import { queryFrontTab } from './tabBehind.js';
import { selectionItemSelector } from './selectionQuickBar.js';

export const SELECTION_CONTROLS = '.svg-selection-overlay, [data-callout-handle-overlay], [data-resize-handle], [data-curve-handle], [data-handle], [data-handle-hit-pad], [data-add-vertex], [data-rotation-handle], [data-counter-rotate-grabber], [data-caption-turn-grabber]';

/** Include the mark itself: a callout's leader can lie well outside its text frame. */
function menuObstacles(ctx) {
  const svg = queryFrontTab('[data-svg-annotation-layer="' + ctx.pageNumber + '"]');
  if (!svg) return [];
  const nodes = new Set(svg.querySelectorAll(SELECTION_CONTROLS));
  const protect = (selector) => {
    const el = svg.querySelector(selector);
    if (el) nodes.add(el);
  };
  if (ctx.calloutId != null) protect(selectionItemSelector({ typeKey: 'callout', id: ctx.calloutId }));
  for (const id of [ctx.surveyMarkerId, ...(ctx.groupMarkerIds || [])]) {
    if (id != null) protect(selectionItemSelector({ typeKey: 'surveyMarker', id }));
  }
  for (const index of [ctx.annotationIndex, ...(ctx.groupIndices || [])]) {
    if (Number.isInteger(index)) protect(`[data-annotation-index="${index}"],[data-stack-index="${index}"]`);
  }
  const viewport = queryFrontTab('[data-testid="pdf-container"]')?.getBoundingClientRect();
  return [...nodes].map(el => el.getBoundingClientRect()).filter(r => r.width || r.height)
    .map(r => viewport ? { left: Math.max(viewport.left, r.left), top: Math.max(viewport.top, r.top),
      right: Math.min(viewport.right, r.right), bottom: Math.min(viewport.bottom, r.bottom) } : r)
    .filter(r => r.left <= r.right && r.top <= r.bottom);
}

export function clearMarkMenu(el, ctx, bounds, extra = []) {
  if (!ctx || ctx.kind === 'page') return;
  const avoid = menuObstacles(ctx).concat(extra);
  if (!avoid.length) return;
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  const desired = { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
  const clear = clearPosition(bounds, size, desired, avoid, true);
  el.style.visibility = clear ? 'visible' : 'hidden';
  if (!clear) return;
  el.style.left = clear.left + 'px';
  el.style.top = clear.top + 'px';
  if (clear.height < size.height) {
    el.style.maxHeight = clear.height + 'px';
    el.style.overflowY = 'auto';
  }
}

/** The closest clear position lies on a viewport or obstacle edge, or at the requested point. */
export function clearPosition(bounds, size, desired, obstacles, scrollable = false) {
  const edge = 8, gap = 4;
  const minX = Math.ceil(bounds.left + edge), maxX = Math.floor(bounds.right - edge - size.width);
  const topEdge = Math.ceil(bounds.top + edge), bottomEdge = Math.floor(bounds.bottom - edge);
  if (maxX < minX || bottomEdge <= topEdge) return null;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));
  const xs = new Set([clamp(desired.left, minX, maxX), minX, maxX]);
  for (const box of obstacles) {
    xs.add(clamp(Math.floor(box.left - gap - size.width), minX, maxX));
    xs.add(clamp(Math.ceil(box.right + gap), minX, maxX));
  }
  let best = null;
  let distance = Infinity;
  for (const left of xs) {
    const blocked = obstacles.filter(b => left < b.right + gap && left + size.width > b.left - gap)
      .sort((a, b) => a.top - b.top);
    let start = topEdge;
    const consider = (end) => {
      const height = Math.min(size.height, end - start);
      if (height <= 0 || (height < size.height && (!scrollable || height < Math.min(size.height, 36)))) return;
      const top = clamp(desired.top, start, end - height);
      const score = (desired.left - left) ** 2 + (desired.top - top) ** 2;
      if (!best || height > best.height || (height === best.height && score < distance)) {
        best = { left, top, height };
        distance = score;
      }
    };
    for (const box of blocked) {
      consider(Math.min(bottomEdge, Math.floor(box.top - gap)));
      start = Math.max(start, Math.ceil(box.bottom + gap));
    }
    consider(bottomEdge);
  }
  return best;
}
