// The part of a plan page on screen now, in PDF points from the page's
// top-left (like item bounds), for "cloud this area". Measured from the page
// element itself, not page size times zoom, since the app's own zoom can
// differ from what the viewer reports.
export function visiblePageBox(page, pageSize, { doc = globalThis.document, win = globalThis.window } = {}) {
  if (!doc?.querySelector || !win || !(pageSize?.width > 0) || !(pageSize?.height > 0)) return null;
  const el = doc.querySelector(`.survey-pdfjs-page-div[data-page-number="${Number(page)}"]`)
    || doc.querySelector(`[data-page-number="${Number(page)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  // A turned page (90 or 270 degrees) would need its corners swapped; leave it.
  if (Math.abs(r.width / r.height - pageSize.width / pageSize.height) > 0.05) return null;
  let view = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = win.getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const b = p.getBoundingClientRect();
      view = { left: Math.max(view.left, b.left), top: Math.max(view.top, b.top), right: Math.min(view.right, b.right), bottom: Math.min(view.bottom, b.bottom) };
      break;
    }
  }
  const left = Math.max(r.left, view.left);
  const top = Math.max(r.top, view.top);
  const right = Math.min(r.right, view.right);
  const bottom = Math.min(r.bottom, view.bottom);
  if (right - left < 4 || bottom - top < 4) return null;
  const scale = pageSize.width / r.width;
  return { x: (left - r.left) * scale, y: (top - r.top) * scale, width: (right - left) * scale, height: (bottom - top) * scale };
}

/**
 * Where to draw a mark around `box` on a page of `size`: a little room
 * around it, more for a circle so the box's corners stay inside. `inset`
 * instead shrinks the box (for what is on screen, so the cloud is visible).
 */
export function markBox(box, size, { shape = 'box', inset = false } = {}) {
  let { x, y, width: w, height: h } = box;
  if (inset) {
    const dx = w * 0.12;
    const dy = h * 0.12;
    x += dx; y += dy; w -= 2 * dx; h -= 2 * dy;
  } else {
    const pad = Math.max(6, 0.1 * Math.max(w, h));
    x -= pad; y -= pad; w += 2 * pad; h += 2 * pad;
    if (shape === 'circle') {
      const gx = (w * (Math.SQRT2 - 1)) / 2;
      const gy = (h * (Math.SQRT2 - 1)) / 2;
      x -= gx; y -= gy; w += 2 * gx; h += 2 * gy;
    }
  }
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(size.width, x + w);
  const bottom = Math.min(size.height, y + h);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
