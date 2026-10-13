/**
 * surveyRailMorph.js - the Survey panel's shared-element morph (owner
 * 2026-10-02, after bf3888e: "a MORPH, not a fade"; reference for the feel:
 * morphicons.com - shapes continuously change into the new shape).
 *
 * When the panel's page changes - a template picked, another template picked
 * from the menu or the phone's list, the phone's template list opened or
 * closed again (Cancel) - each old ROW turns into a new one instead of the
 * page being swapped:
 *   - the header turns into the new header, the footer into the new footer;
 *   - the body's rows are paired in reading order: old row 1 turns into new
 *     row 1, and so on. A paired row moves and resizes from where it was to
 *     where its counterpart is, its corners turning into the new corners;
 *   - extra new rows grow out of the last paired row (height from 0, sliding
 *     to their places); surplus old rows collapse into the row above;
 *   - the words cross-dissolve INSIDE each row's box (old out, new in, the
 *     same box). There is no whole-panel fade.
 * 300ms, one ease-in-out curve, transforms and opacity only, nothing at all
 * under prefers-reduced-motion.
 *
 * HOW. capture() runs just before the state change and keeps, for every row
 * on screen, its box, its look (fill, hairlines, corners) and a still copy
 * of its contents. play() runs in the layout effect after React has drawn
 * the new page, takes the same of the new rows, and for the 300ms lays a
 * layer of boxes over the panel - one per pair, drawn at the new row's place
 * and size and moved/scaled back to the old one with `transform`, the copies
 * inside counter-scaled so words keep their size - while the real new rows
 * wait underneath at opacity 0. On the last frame each box is exactly its
 * real row, so the layer is lifted off with nothing to see. The two copies
 * in a box blend with `plus-lighter`, so a word that is the same before and
 * after never dips while it cross-dissolves.
 */

export const MORPH_DURATION_MS = 300;
const MORPH_SAMPLES = 24;

const HEAD_SELECTOR = '.survey-rail__head, .mobile-survey-head';
const FOOT_SELECTOR = '.survey-rail__foot, .mobile-survey-foot';
// Rows of every page the panel can show: the template list, the phone's
// "Find a template" field, the sync line, the module tabs, the Categories
// head line and the categories (a category with its open Survey Markers is
// one row).
const ROW_SELECTOR = [
  '.survey-rail__template-row',
  '.mobile-survey-template-row',
  '.mobile-survey-switch-search',
  '.mobile-survey-switch-empty',
  '.survey-rail__sync',
  '.survey-rail__tabs',
  '.mobile-survey-module-tabs',
  '.survey-rail__cats-head',
  '.mobile-survey-categories-heading',
  '.survey-marker-category-card',
].join(', ');
const ANY_SELECTOR = `${HEAD_SELECTOR}, ${FOOT_SELECTOR}, ${ROW_SELECTOR}`;
// Never copied into a still: an open popover belongs to the moment before.
const DROP_FROM_COPY = '.survey-rail__template-menu, [data-anchored-tooltip], [role="tooltip"]';

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const lerp = (a, b, e) => a + (b - a) * e;
const round = (n) => Math.round(n * 1000) / 1000;

export function prefersReducedMotion() {
  try {
    return Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The plan (pure; tests/surveyRailMorph.test.mjs).
// ---------------------------------------------------------------------------

const collapsedAt = (rect, y) => ({ x: rect.x, y, w: rect.w, h: 0 });
const bottom = (rect) => rect.y + rect.h;

/**
 * Pairs the rows of two pages. Each side is { head, foot, rows } with rows
 * in reading order; every item has a `vis` box ({ x, y, w, h }, panel
 * coordinates). Returns a list of moves { from, to, oldItem, newItem }:
 * a pair has both items; a grown row has only newItem and starts as a
 * 0-high box at the bottom of the last paired row (as it stood before); a
 * collapsing row has only oldItem and ends as a 0-high box at the bottom of
 * the row above (where that row ends up).
 */
export function planMorph(before, after) {
  const moves = [];
  const oldRows = [...(before.rows || [])];
  const newRows = [...(after.rows || [])];
  // A header with no counterpart is just the first row of its page.
  if (before.head && after.head) {
    moves.push({ from: before.head.vis, to: after.head.vis, oldItem: before.head, newItem: after.head });
  } else if (before.head) {
    oldRows.unshift(before.head);
  } else if (after.head) {
    newRows.unshift(after.head);
  }
  const pairs = Math.min(oldRows.length, newRows.length);
  for (let i = 0; i < pairs; i += 1) {
    moves.push({ from: oldRows[i].vis, to: newRows[i].vis, oldItem: oldRows[i], newItem: newRows[i] });
  }
  const lastOld = pairs ? oldRows[pairs - 1].vis : (before.head && after.head ? before.head.vis : null);
  const lastNew = pairs ? newRows[pairs - 1].vis : (before.head && after.head ? after.head.vis : null);
  for (let i = pairs; i < newRows.length; i += 1) {
    const to = newRows[i].vis;
    moves.push({ from: collapsedAt(to, lastOld ? bottom(lastOld) : to.y), to, oldItem: null, newItem: newRows[i] });
  }
  for (let i = pairs; i < oldRows.length; i += 1) {
    const from = oldRows[i].vis;
    moves.push({ from, to: collapsedAt(from, lastNew ? bottom(lastNew) : from.y), oldItem: oldRows[i], newItem: null });
  }
  // The footer grows up out of (or sinks into) the panel's bottom edge.
  if (before.foot && after.foot) {
    moves.push({ from: before.foot.vis, to: after.foot.vis, oldItem: before.foot, newItem: after.foot });
  } else if (after.foot) {
    moves.push({ from: collapsedAt(after.foot.vis, bottom(after.foot.vis)), to: after.foot.vis, oldItem: null, newItem: after.foot });
  } else if (before.foot) {
    moves.push({ from: before.foot.vis, to: collapsedAt(before.foot.vis, bottom(before.foot.vis)), oldItem: before.foot, newItem: null });
  }
  return moves;
}

// Where a row's words sit inside a box of height h that is not their own:
// centred when the heights are alike, top-aligned when one is much taller
// (a category open on its Survey Markers keeps its name line at the top,
// and a one-line row turning into it starts on that line).
export const alignIn = (h, contentH) => {
  const ratio = Math.max(h, contentH) / Math.max(Math.min(h, contentH), 1);
  return ratio <= 2 ? (h - contentH) / 2 : 0;
};

/**
 * One frame of one move at eased progress e: the box's transform (it is laid
 * out at `base`, the larger of the two ends), its corner radii and the
 * transforms of the old and new copies inside it.
 */
export function morphFrame(move, base, e) {
  const { from, to, oldItem, newItem } = move;
  const px = lerp(from.x, to.x, e);
  const py = lerp(from.y, to.y, e);
  const w = Math.max(lerp(from.w, to.w, e), 0.01);
  const h = Math.max(lerp(from.h, to.h, e), 0.01);
  const sx = w / base.w;
  const sy = h / base.h;
  const box = `translate(${round(px - base.x)}px, ${round(py - base.y)}px) scale(${round(sx)}, ${round(sy)})`;
  const radiiFrom = (oldItem || newItem).radii;
  const radiiTo = (newItem || oldItem).radii;
  const radii = radiiFrom.map((r, i) => lerp(r, radiiTo[i], e));
  const radius = radii.some((r) => r > 0)
    ? `${radii.map((r) => `${round(r / sx)}px`).join(' ')} / ${radii.map((r) => `${round(r / sy)}px`).join(' ')}`
    : '0px';
  const copy = (item, home) => {
    if (!item) return null;
    // At its own end the copy sits exactly where the row was drawn; at the
    // other end it is aligned in the other box.
    const homeX = item.rect.x - item.vis.x;
    const homeY = item.rect.y - item.vis.y;
    const other = home === 0 ? to : from;
    const awayX = 0;
    const awayY = alignIn(other.h, item.rect.h);
    const k = home === 0 ? e : 1 - e;
    const ox = lerp(homeX, awayX, k);
    const oy = lerp(homeY, awayY, k);
    return `scale(${round(1 / sx)}, ${round(1 / sy)}) translate(${round(ox)}px, ${round(oy)}px)`;
  };
  return { box, radius, oldCopy: copy(oldItem, 0), newCopy: copy(newItem, 1) };
}

// ---------------------------------------------------------------------------
// The DOM side.
// ---------------------------------------------------------------------------

const rectIn = (domRect, origin) => ({
  x: domRect.left - origin.x,
  y: domRect.top - origin.y,
  w: domRect.width,
  h: domRect.height,
});

const intersect = (a, b) => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
};

const panelOrigin = (root) => {
  const box = root.getBoundingClientRect();
  // Absolute children are placed from the padding box, which scrolls.
  return {
    x: box.left + root.clientLeft - root.scrollLeft,
    y: box.top + root.clientTop - root.scrollTop,
    clip: { x: box.left + root.clientLeft, y: box.top + root.clientTop, w: root.clientWidth, h: root.clientHeight },
  };
};

// The part of an element its scrolling lists and the panel let you see.
const visibleBox = (el, root, origin) => {
  let vis = rectIn(el.getBoundingClientRect(), origin);
  vis = intersect(vis, rectIn({ left: origin.clip.x, top: origin.clip.y, width: origin.clip.w, height: origin.clip.h }, origin));
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      vis = intersect(vis, rectIn({
        left: node.getBoundingClientRect().left + node.clientLeft,
        top: node.getBoundingClientRect().top + node.clientTop,
        width: node.clientWidth,
        height: node.clientHeight,
      }, origin));
    }
  }
  return vis;
};

const hairline = (width, style, color) => (parseFloat(width) > 0 && style !== 'none' && style !== 'hidden' ? { w: parseFloat(width), c: color } : null);

const stripIds = (node) => {
  node.removeAttribute?.('id');
  node.querySelectorAll?.('[id]').forEach((n) => n.removeAttribute('id'));
};

const LAYOUT_RESET = {
  display: 'block', position: 'static', margin: '0', padding: '0', border: '0', width: 'auto', height: 'auto',
  'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none', overflow: 'visible',
  background: 'transparent', 'box-shadow': 'none', transform: 'none', opacity: '1', 'mask-image': 'none',
  '-webkit-mask-image': 'none', animation: 'none', flex: 'none', gap: '0', filter: 'none', contain: 'none',
};
const setAll = (el, props) => Object.entries(props).forEach(([k, v]) => el.style.setProperty(k, v, 'important'));

// A still copy of a row that keeps its look: the row is copied whole, inside
// bare copies of the elements between it and the panel, so stylesheet rules
// written against those (".survey-rail__list .x", "> .y") still reach it.
function stillCopy(el, root, rect) {
  const chain = [];
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) chain.unshift(node);
  const holder = document.createElement('div');
  setAll(holder, { position: 'absolute', left: '0', top: '0', width: `${rect.w}px`, height: `${rect.h}px`, 'transform-origin': '0 0', 'mix-blend-mode': 'plus-lighter', 'pointer-events': 'none' });
  let parent = holder;
  chain.forEach((ancestor) => {
    const shell = ancestor.cloneNode(false);
    stripIds(shell);
    shell.removeAttribute('style');
    setAll(shell, LAYOUT_RESET);
    parent.appendChild(shell);
    parent = shell;
  });
  const copy = el.cloneNode(true);
  stripIds(copy);
  copy.querySelectorAll(DROP_FROM_COPY).forEach((n) => n.remove());
  const cs = getComputedStyle(el);
  setAll(copy, {
    position: cs.position === 'static' ? 'relative' : cs.position === 'sticky' ? 'relative' : cs.position,
    left: '0', top: '0', margin: '0', width: `${rect.w}px`, height: `${rect.h}px`, 'box-sizing': 'border-box',
    flex: 'none', 'max-width': 'none', 'min-width': '0',
    background: 'transparent', 'box-shadow': 'none', 'border-color': 'transparent', transform: 'none', opacity: '1',
  });
  parent.appendChild(copy);
  // A copy forgets where its lists were scrolled to.
  const sources = [el, ...el.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  const scrolls = [];
  if (sources.length === copies.length) {
    sources.forEach((node, i) => { if (node.scrollTop || node.scrollLeft) scrolls.push([copies[i], node.scrollTop, node.scrollLeft]); });
  }
  return { holder, scrolls };
}

function describe(el, root, origin) {
  const rect = rectIn(el.getBoundingClientRect(), origin);
  const vis = visibleBox(el, root, origin);
  if (vis.h < 0.5 || vis.w < 0.5) return null;
  const cs = getComputedStyle(el);
  return {
    el,
    rect,
    vis,
    fill: cs.backgroundColor,
    // A hairline is drawn only where the row's own edge is in view.
    top: Math.abs(vis.y - rect.y) < 0.5 ? hairline(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor) : null,
    bottom: Math.abs(bottom(vis) - bottom(rect)) < 0.5 ? hairline(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor) : null,
    radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((r) => parseFloat(r) || 0),
    still: stillCopy(el, root, rect),
  };
}

function readPage(root) {
  const origin = panelOrigin(root);
  const all = [...root.querySelectorAll(ANY_SELECTOR)].filter((el) => (
    !el.closest('[data-survey-morph-overlay]')
    // Outermost rows only: a row inside a row travels with it.
    && !el.parentElement?.closest(ANY_SELECTOR)
  ));
  const page = { head: null, foot: null, rows: [] };
  all.forEach((el) => {
    const item = describe(el, root, origin);
    if (!item) return;
    if (el.matches(HEAD_SELECTOR)) { if (!page.head) page.head = item; } else if (el.matches(FOOT_SELECTOR)) { if (!page.foot) page.foot = item; } else page.rows.push(item);
  });
  page.rows.sort((a, b) => a.vis.y - b.vis.y || a.vis.x - b.vis.x);
  return page;
}

const decorLayer = (item) => {
  const layer = document.createElement('div');
  const shadows = [];
  if (item.top) shadows.push(`inset 0 ${item.top.w}px 0 ${item.top.c}`);
  if (item.bottom) shadows.push(`inset 0 -${item.bottom.w}px 0 ${item.bottom.c}`);
  setAll(layer, {
    position: 'absolute', inset: '0', background: item.fill || 'transparent',
    'box-shadow': shadows.length ? shadows.join(', ') : 'none', 'mix-blend-mode': 'plus-lighter',
  });
  return layer;
};

const morphs = new WeakMap();

/** Ends a morph still running on this panel at once (its end state). */
export function finishMorph(root) {
  const running = root && morphs.get(root);
  if (running) running();
}

/**
 * Before the change: what the panel shows now. Returns null (no morph) when
 * motion is reduced or the panel cannot animate.
 */
export function captureMorph(root) {
  if (!root || typeof root.animate !== 'function' || prefersReducedMotion()) return null;
  finishMorph(root);
  try {
    const page = readPage(root);
    if (!page.head && !page.rows.length && !page.foot) return null;
    return { root, page, at: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
  } catch {
    return null;
  }
}

/** After React has drawn the new page: plays the morph from `before`. */
export function playMorph(before, { duration = MORPH_DURATION_MS } = {}) {
  if (!before) return false;
  const { root } = before;
  if (!root?.isConnected) return false;
  let after;
  try {
    after = readPage(root);
  } catch {
    return false;
  }
  const moves = planMorph(before.page, after);
  if (!moves.length) return false;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-survey-morph-overlay', '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('inert', '');
  setAll(overlay, {
    position: 'absolute', left: '0', top: '0', width: `${root.scrollWidth}px`, height: `${root.scrollHeight}px`,
    // Over the rows, under the portalled zoom / page footer (z 2).
    'z-index': '1', 'pointer-events': 'none', overflow: 'hidden', contain: 'layout style',
  });

  const animations = [];
  const timing = { duration, easing: 'linear', fill: 'forwards' };
  const samples = Array.from({ length: MORPH_SAMPLES + 1 }, (_, i) => i / MORPH_SAMPLES);

  moves.forEach((move) => {
    const base = move.to.h >= move.from.h ? move.to : move.from;
    if (base.h < 0.5 || base.w < 0.5) return;
    const box = document.createElement('div');
    box.setAttribute('data-survey-morph-box', '');
    setAll(box, {
      position: 'absolute', left: `${base.x}px`, top: `${base.y}px`, width: `${base.w}px`, height: `${base.h}px`,
      'transform-origin': '0 0', overflow: 'hidden', 'will-change': 'transform',
    });
    const decor = document.createElement('div');
    setAll(decor, { position: 'absolute', inset: '0', isolation: 'isolate' });
    const words = document.createElement('div');
    setAll(words, { position: 'absolute', inset: '0', isolation: 'isolate' });
    box.append(decor, words);
    const oldDecor = move.oldItem ? decorLayer(move.oldItem) : null;
    const newDecor = move.newItem ? decorLayer(move.newItem) : null;
    [oldDecor, newDecor].forEach((layer) => layer && decor.appendChild(layer));
    const oldCopy = move.oldItem?.still.holder || null;
    const newCopy = move.newItem?.still.holder || null;
    [oldCopy, newCopy].forEach((layer) => layer && words.appendChild(layer));
    overlay.appendChild(box);

    const frames = samples.map((t) => ({ t, e: easeInOutCubic(t), f: morphFrame(move, base, easeInOutCubic(t)) }));
    const both = Boolean(move.oldItem && move.newItem);
    animations.push(box.animate(frames.map(({ t, f }) => ({ offset: t, transform: f.box, borderRadius: f.radius })), timing));
    if (oldCopy) animations.push(oldCopy.animate(frames.map(({ t, e, f }) => ({ offset: t, transform: f.oldCopy, opacity: round(1 - e) })), timing));
    if (newCopy) animations.push(newCopy.animate(frames.map(({ t, e, f }) => ({ offset: t, transform: f.newCopy, opacity: round(e) })), timing));
    // The row's own fill and hairlines turn into the new ones; a row that
    // grows or collapses keeps its own the whole way.
    if (both && oldDecor) animations.push(oldDecor.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' }));
    if (both && newDecor) animations.push(newDecor.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' }));
  });

  root.appendChild(overlay);
  moves.forEach(({ oldItem, newItem }) => {
    [oldItem, newItem].forEach((item) => item?.still.scrolls.forEach(([node, top, left]) => { node.scrollTop = top; node.scrollLeft = left; }));
  });

  // The real new rows wait underneath until the boxes have become them.
  const hidden = [after.head, after.foot, ...after.rows].filter(Boolean).map((item) => (
    item.el.animate([{ opacity: 0 }, { opacity: 0 }], { duration, fill: 'none' })
  ));
  const clock = hidden[0] || animations[0];

  let done = false;
  let safety = 0;
  const end = () => {
    if (done) return;
    done = true;
    window.clearTimeout(safety);
    if (morphs.get(root) === end) morphs.delete(root);
    animations.forEach((a) => { try { a.cancel(); } catch { /* gone */ } });
    hidden.forEach((a) => { try { a.cancel(); } catch { /* gone */ } });
    overlay.remove();
  };
  morphs.set(root, end);
  if (clock) {
    clock.onfinish = end;
    clock.oncancel = end;
  }
  // A morph never outlives its moment, even if the page stops animating.
  safety = window.setTimeout(end, duration * 40 + 1000);
  return true;
}
