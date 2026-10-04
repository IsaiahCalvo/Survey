// Page-anchored floating controls — one placement rule and one host for every
// small control that belongs to a mark on the page (the text / callout editor's
// tick and cross today; the Spaces area editor already lives in the page).
//
// Owner 2026-10-04: "When I pan around and scroll, that X and check mark don't
// move perfectly with the page ... they lag behind a little bit. This is not
// the first thing that happened like this. In Spaces, the plus and minus ...
// was also doing something similar."
//
// ROOT CAUSE (both cases). The control was a `position: fixed` layer in a
// <body> portal, OUTSIDE the PDF scroller, moved to the page's new screen spot
// from a scroll listener / requestAnimationFrame -> React state. The browser
// scrolls the page itself (on a Mac / iPhone on the compositor, without waiting
// for JavaScript) and draws it in the new place first; the scroll event, the
// measurement and the React re-render land a frame or more later, so the
// control trails every scroll, pan, rubber-band bounce and pinch. Measured on
// desktop Chromium: a wheel pan left the tick/cross 15px behind the box on
// every scroll step.
//
// THE RULE. A control that belongs to a mark lives INSIDE the page (in the
// page's own overlay, positioned in the page's CSS pixels), so the browser
// moves it with the page in the same frame — zero JavaScript per frame. Only
// WHICH side of the mark it sits on is computed in JavaScript, and that only
// changes when the mark nears the edge of what the user can see; a side change
// a frame late is invisible, a position a frame late is the lag.
//
// The second rule (owner, same day: "the X and checkmark ... are colliding
// with the text box"): the control sits OUTSIDE the mark's visible box with a
// fixed gap — below it, flipping above it near the bottom edge of the page or
// of the visible area, then to its sides — and never on a callout's leader.

/** Gap between the mark's ink and the control's tap targets, screen px. */
export const PAGE_CONTROL_GAP_PX = 4;
/** Keep-clear margin from the edge of the page / visible area, screen px. */
export const PAGE_CONTROL_EDGE_MARGIN_PX = 6;
/** Extra clearance kept around a callout leader line, screen px. */
export const PAGE_CONTROL_LEADER_CLEARANCE_PX = 4;

/** The descender strip renderText / renderCallout add under the stored box. */
export const TEXT_DESCENDER_RATIO = 0.35;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const rectOf = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height, width, height,
});

/**
 * The visible box of a text box / callout being edited, in host (page CSS)
 * pixels: the stored box, plus the descender strip the renderers draw under it,
 * plus its border ink, rotated like the renderer rotates it (about the stored
 * box's centre), as an axis-aligned rect.
 */
export function textEditMarkRect({
  left = 0,
  top = 0,
  width = 0,
  height = 0,
  angle = 0,
  fontSize = 16,
  inkPad = 0,
  scaleX = 1,
  scaleY = 1,
}) {
  const w = Math.max(0, finite(width));
  const h = Math.max(0, finite(height));
  const pad = Math.max(0, finite(inkPad));
  const descender = Math.max(0, finite(fontSize, 16)) * TEXT_DESCENDER_RATIO;
  const cx = finite(left) + w / 2;
  const cy = finite(top) + h / 2;
  // Corners in page units, relative to the rotation centre.
  const x0 = -w / 2 - pad;
  const x1 = w / 2 + pad;
  const y0 = -h / 2 - pad;
  const y1 = h / 2 + descender + pad;
  const rad = (finite(angle) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    const px = cx + x * cos - y * sin;
    const py = cy + x * sin + y * cos;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const sx = finite(scaleX, 1);
  const sy = finite(scaleY, 1);
  return rectOf(minX * sx, minY * sy, (maxX - minX) * sx, (maxY - minY) * sy);
}

/** Liang-Barsky: does segment a->b touch rect r? */
export function segmentIntersectsRect(a, b, r) {
  if (!a || !b || !r) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges = [
    [-dx, a.x - r.left],
    [dx, r.right - a.x],
    [-dy, a.y - r.top],
    [dy, r.bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

const overlapArea = (a, b) => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

const inside = (r, area) => (
  r.left >= area.left - 0.5 && r.right <= area.right + 0.5
  && r.top >= area.top - 0.5 && r.bottom <= area.bottom + 0.5
);

/**
 * Where a control of `width` x `height` goes beside `mark`, all in host px.
 *
 *   area   — where it may sit: the part of the page the user can see, inset
 *            by the edge margin (null = anywhere).
 *   avoid  — segments it must not cover (a callout's leader), {a, b} pairs.
 *   keepSide — the side it is on now; kept while it still fits.
 *
 * Order: centred below the mark (the house spot), centred above it, then
 * below / above aligned to the mark's left or right edge (to step off a
 * leader or a page edge), then beside it on the right / left. The first spot
 * fully inside `area` and clear of `avoid` wins; failing that, a clear spot
 * that shows the most of itself; failing that, centred below. Every candidate
 * is outside the mark by `gap`, so the control never covers the mark.
 */
export function placeBesideMark({
  mark,
  width,
  height,
  gap = PAGE_CONTROL_GAP_PX,
  area = null,
  avoid = [],
  avoidClearance = PAGE_CONTROL_LEADER_CLEARANCE_PX,
  keepSide = null,
}) {
  const cx = (mark.left + mark.right) / 2;
  const cy = (mark.top + mark.bottom) / 2;
  const below = mark.bottom + gap;
  const above = mark.top - gap - height;
  const candidates = [
    { side: 'below', left: cx - width / 2, top: below },
    { side: 'above', left: cx - width / 2, top: above },
    { side: 'below-start', left: mark.left, top: below },
    { side: 'below-end', left: mark.right - width, top: below },
    { side: 'above-start', left: mark.left, top: above },
    { side: 'above-end', left: mark.right - width, top: above },
    { side: 'right', left: mark.right + gap, top: cy - height / 2 },
    { side: 'left', left: mark.left - gap - width, top: cy - height / 2 },
  ];
  if (area && area.right - area.left >= width) {
    // Last resort for a mark wider than what is on screen: below / above it,
    // slid sideways into view. The SLIDING is the browser's (CSS sticky across
    // the mark's width — see TextEditOverlay), so even this one rides a
    // sideways scroll with no JavaScript; `left` is where sticky puts it now.
    const slide = (x) => Math.max(area.left, Math.min(area.right - width, x));
    const span = { left: mark.left, width: Math.max(width, mark.right - mark.left) };
    candidates.push(
      { side: 'below-slid', left: slide(cx - width / 2), top: below, span },
      { side: 'above-slid', left: slide(cx - width / 2), top: above, span },
    );
  }
  for (const c of candidates) c.rect = rectOf(c.left, c.top, width, height);

  const clearOf = (c) => {
    const r = c.rect;
    const inflated = {
      left: r.left - avoidClearance,
      top: r.top - avoidClearance,
      right: r.right + avoidClearance,
      bottom: r.bottom + avoidClearance,
    };
    return !(avoid || []).some((s) => segmentIntersectsRect(s.a, s.b, inflated));
  };

  let best = null;
  if (area && area.right > area.left && area.bottom > area.top) {
    // Stay put while the current side still fits: no flip-flopping between
    // two sides as the page scrolls past an edge.
    const current = keepSide ? candidates.find((c) => c.side === keepSide) : null;
    if (current && inside(current.rect, area) && clearOf(current)) best = current;
    if (!best) best = candidates.find((c) => inside(c.rect, area) && clearOf(c));
    if (!best) {
      let bestShown = 0;
      for (const c of candidates) {
        if (!clearOf(c)) continue;
        const shown = overlapArea(c.rect, area);
        if (shown > bestShown + 0.5) { bestShown = shown; best = c; }
      }
    }
  } else {
    best = candidates.find(clearOf) || null;
  }
  const chosen = best || candidates[0];
  return { left: chosen.left, top: chosen.top, side: chosen.side, span: chosen.span || null };
}

/**
 * DOM helper: the part of `host` the user can actually see, in the host's own
 * (untransformed CSS px) coordinates — clipped by every scrolling / clipping
 * ancestor (the PDF scroller) and by the visual viewport (on a phone the
 * on-screen keyboard shrinks it), then intersected with the host itself (the
 * page) and inset by `margin`. Read at rest; the result only decides WHICH
 * side a control takes, never moves it per frame.
 */
export function visibleAreaInHost(host, margin = PAGE_CONTROL_EDGE_MARGIN_PX) {
  if (!host || typeof window === 'undefined') return null;
  const hostRect = host.getBoundingClientRect();
  const layoutW = host.offsetWidth || hostRect.width;
  const layoutH = host.offsetHeight || hostRect.height;
  if (!(layoutW > 0 && layoutH > 0 && hostRect.width > 0 && hostRect.height > 0)) return null;
  const vv = window.visualViewport;
  let clip = {
    left: vv?.offsetLeft ?? 0,
    top: vv?.offsetTop ?? 0,
    right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth),
    bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight),
  };
  for (let el = host.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = window.getComputedStyle(el);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = el.getBoundingClientRect();
    clip = {
      left: Math.max(clip.left, r.left),
      top: Math.max(clip.top, r.top),
      right: Math.min(clip.right, r.right),
      bottom: Math.min(clip.bottom, r.bottom),
    };
  }
  // Client px -> host px (a mid-pinch CSS scale makes these differ).
  const kx = layoutW / hostRect.width;
  const ky = layoutH / hostRect.height;
  const local = {
    left: (clip.left - hostRect.left) * kx,
    top: (clip.top - hostRect.top) * ky,
    right: (clip.right - hostRect.left) * kx,
    bottom: (clip.bottom - hostRect.top) * ky,
  };
  return {
    left: Math.max(local.left, 0) + margin,
    top: Math.max(local.top, 0) + margin,
    right: Math.min(local.right, layoutW) - margin,
    bottom: Math.min(local.bottom, layoutH) - margin,
  };
}
