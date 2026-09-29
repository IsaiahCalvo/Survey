/**
 * historyPageOverlay.js — RULED 2026-09-28 owner: History option A.
 * RULED 2026-09-29 owner: cleaner History ("the blue outline doesn't fully
 * encompass it; the floating Restore / Deleted tags don't look proper; on the
 * page just have it highlighted").
 *
 * What the History panel draws ON the page, in one fixed-position layer that
 * follows the page as it scrolls and zooms (it re-reads the page's annotation
 * layer rectangle every frame while something is shown, and stops when
 * nothing is):
 *
 *   highlight  the mark you picked: a soft blue wash plus one thin even
 *              outline, padded the same few pixels on every side of what you
 *              actually SEE (stroke width, cloud crowns, callout leader and
 *              arrow, rotated marks, several marks at once). It fades in fast
 *              (150 ms), stays while the line is selected, and fades out when
 *              cleared. No draw-on, no pulse. Always the selection blue
 *              #4a90e2 (never gold, owner ruling 2026-09-17) — the status
 *              colors belong to the panel, the page has one rule.
 *   hover      the same shape, quieter, while you point at a row.
 *   scene      what stays while a row is open:
 *                - a deleted mark: a faint ghost of its own shape (thin dashed
 *                  grey line), with ONE small "Restore" (glyph + word) fixed
 *                  to the highlight's top-right corner — no black pill, no
 *                  shadow, no separate "Deleted" tag;
 *                - a move / resize / rotate / erase: a faint ghost of where or
 *                  how it was, with a dotted trail for a move. Peeking at
 *                  "Before" moves the highlight onto the old shape and fades
 *                  the mark as it is now, so there is only ever one outline.
 *
 * Bounds are measured from the rendered geometry — each visible shape's own
 * box grown by half its stroke, then taken through its transform — because
 * getBoundingClientRect() on SVG leaves out the stroke (a 40 px pen line
 * measures 0 px tall), which is why the old outline stopped short.
 * Everything is kept in page units (the annotation layer's viewBox), so it
 * stays on the mark at any zoom. Nothing here changes a mark: looking is free,
 * only Restore changes the document.
 */
import { buildHistoryShapeNode } from '../../utils/historyGeometry.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'document-history-overlay-style';
const ROOT_ID = 'document-history-overlay';
export const HISTORY_HIGHLIGHT_BLUE = '#4a90e2';
// Screen pixels between what you see and the outline, the same on every side.
export const HISTORY_HIGHLIGHT_PAD_PX = 6;
export const HISTORY_HIGHLIGHT_FADE_MS = 150;
const GHOST_GREY = '#8c93a0';

// z-index 5100: above the viewer's own stack (5000) so the ghost's Restore
// can be clicked, below the app chrome (top 5500, side rails 5600).
function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 5100; }
    #${ROOT_ID} svg { position: fixed; overflow: visible; pointer-events: none; }
    #${ROOT_ID} .dh-fade { opacity: 0; transition: opacity ${HISTORY_HIGHLIGHT_FADE_MS}ms ease-out; }
    #${ROOT_ID} .dh-fade.in { opacity: 1; }
    #${ROOT_ID} .dh-wash { fill: ${HISTORY_HIGHLIGHT_BLUE}; fill-opacity: .10; stroke: none; }
    #${ROOT_ID} .dh-line { fill: none; stroke: ${HISTORY_HIGHLIGHT_BLUE}; stroke-width: 1.5px; }
    #${ROOT_ID} [data-history-layer="hover"] .dh-wash { fill-opacity: .05; }
    #${ROOT_ID} [data-history-layer="hover"] .dh-line { stroke-opacity: .5; stroke-width: 1px; }
    #${ROOT_ID} .dh-ghost { fill: none; stroke-width: 1.25px; stroke-dasharray: 4 3; opacity: .6; }
    #${ROOT_ID} .dh-ghost-solid { fill: none; stroke-width: 2px; opacity: .9; }
    #${ROOT_ID} .dh-trail { fill: none; stroke: ${GHOST_GREY}; stroke-opacity: .8; stroke-width: 1.25px; stroke-dasharray: 2 3; }
    #${ROOT_ID} .dh-restore-pin { position: fixed; pointer-events: auto; display: inline-flex; align-items: center; gap: 4px;
      margin: 0; border: 0; padding: 2px 3px; background: none; color: #245fae;
      font: 600 12px/1.35 var(--font-primary, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif);
      white-space: nowrap; cursor: pointer; }
    #${ROOT_ID} .dh-restore-pin:hover { color: #173f78; }
    #${ROOT_ID} .dh-restore-pin svg { position: static; width: 13px; height: 13px; transition: transform .08s; }
    #${ROOT_ID} .dh-restore-pin:active svg { transform: scale(.86); }
    @media (prefers-reduced-motion: reduce) { #${ROOT_ID} .dh-fade { transition: none; } }
  `;
  doc.head.appendChild(style);
}

const RESTORE_GLYPH = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 9.5a5.8 5.8 0 111.8 4.6"/><path d="M4 5.2v4.3h4.3"/></svg>';

/** The annotation layer of a page: its screen rect + viewBox size. */
function pageHost(doc, pageNumber) {
  const page = Number(pageNumber);
  if (!Number.isFinite(page) || page < 1) return null;
  const svg = doc.querySelector(`svg[data-svg-annotation-layer="${page}"]`);
  const vb = svg?.viewBox?.baseVal;
  if (!svg || !vb || !(vb.width > 0) || !(vb.height > 0)) return null;
  const rect = svg.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { svg, rect, vbW: vb.width, vbH: vb.height };
}

/** The scroll area the page lives in (to clip the overlay to it). */
function findScrollElement(doc, svg) {
  const win = doc.defaultView;
  let el = svg.parentElement;
  for (let i = 0; el && i < 16; i += 1) {
    const style = win?.getComputedStyle?.(el);
    if (style && /(auto|scroll)/.test(`${style.overflow} ${style.overflowY} ${style.overflowX}`)) return el;
    el = el.parentElement;
  }
  return doc.documentElement;
}

/** Find a mark's elements on the page (only present in Select / Callout mode). */
export function findMarkElements(doc, markId) {
  if (!doc || markId == null) return [];
  const id = String(markId);
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const selectors = [
    `[data-annotation-id="${esc}"]`,
    `[data-anno-id="${esc}"]`,
    `[data-callout-id="${esc}"]`,
    `[data-survey-marker-id="${esc}"]`,
  ];
  const out = [];
  for (const selector of selectors) {
    try {
      for (const el of doc.querySelectorAll(selector)) {
        // Only marks on a page (never the History overlay's own nodes), and
        // never an element already inside one we have.
        if (el.closest?.(`#${ROOT_ID}`)) continue;
        if (out.some((prev) => prev === el || prev.contains?.(el) || el.contains?.(prev))) continue;
        out.push(el);
      }
    } catch (_err) { /* bad selector: skip */ }
  }
  return out;
}

// ---- measuring what you see ------------------------------------------------
const LEAF_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'foreignObject', 'use']);
const NEVER_DRAWN = new Set(['defs', 'mask', 'clipPath', 'marker', 'pattern', 'symbol', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'style', 'script']);

function paintAlpha(value, opacity) {
  const v = String(value || '').trim();
  if (!v || v === 'none' || v === 'transparent') return 0;
  const op = Number.parseFloat(opacity);
  let a = Number.isFinite(op) ? op : 1;
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 4) {
      const alpha = parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
      if (Number.isFinite(alpha)) a *= alpha;
    }
  }
  return a;
}

function collectLeaves(el, out) {
  if (!el) return;
  if (el.namespaceURI !== NS) { out.push(el); return; } // an HTML part (text box)
  const tag = el.localName === 'foreignobject' ? 'foreignObject' : el.localName;
  if (NEVER_DRAWN.has(tag)) return;
  if (LEAF_TAGS.has(tag)) { out.push(el); return; }
  for (const child of el.children) collectLeaves(child, out);
}

// How much of `leaf` shows, counting every group up to (and including) the
// mark's own root element.
function effectiveOpacity(win, leaf, root) {
  let alpha = 1;
  for (let el = leaf; el; el = el.parentElement) {
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none') return 0;
    const op = Number.parseFloat(cs.opacity);
    if (Number.isFinite(op)) alpha *= op;
    if (el === root || alpha < 0.02) break;
  }
  return alpha;
}

// The page paints a translucent selection-blue glow round a mark you point at
// or select (SVGAnnotationLayer: stroke #4a90e2 at 0.4-0.67 opacity, no
// pointer events; clouds tag theirs data-cloud-glow). It is not the mark:
// counting it would make the highlight jump out and back as the pointer
// crosses the mark.
function isPointerGlow(leaf, cs) {
  if (leaf.hasAttribute?.('data-cloud-glow')) return true;
  if (cs.pointerEvents !== 'none') return false;
  const stroke = String(cs.stroke || '').replace(/\s+/g, '');
  if (stroke !== 'rgb(74,144,226)') return false;
  const strokeOpacity = Number.parseFloat(cs.strokeOpacity);
  return Number.isFinite(strokeOpacity) && strokeOpacity < 0.7 && paintAlpha(cs.fill, cs.fillOpacity) < 0.02;
}

const ELLIPSE = Symbol('ellipse');
const PATH_SAMPLES = 160;
// Sampled outlines of paths, kept until the path's shape changes.
const pathPointCache = new WeakMap();

/**
 * A turned shape's outline in its own units: the corners of a polygon or
 * line, points along a path, ELLIPSE for an oval (measured exactly), or null
 * (use its box).
 */
function outlinePoints(leaf, tag) {
  try {
    if (tag === 'circle' || tag === 'ellipse') return ELLIPSE;
    if (tag === 'polygon' || tag === 'polyline') {
      return Array.from(leaf.points || [], (pt) => [pt.x, pt.y]);
    }
    if (tag === 'line') {
      return [[leaf.x1.baseVal.value, leaf.y1.baseVal.value], [leaf.x2.baseVal.value, leaf.y2.baseVal.value]];
    }
    if (tag === 'path' && typeof leaf.getTotalLength === 'function') {
      const d = leaf.getAttribute('d') || '';
      const cached = pathPointCache.get(leaf);
      if (cached && cached.d === d) return cached.points;
      const total = leaf.getTotalLength();
      if (!(total > 0)) return null;
      const points = [];
      for (let i = 0; i <= PATH_SAMPLES; i += 1) {
        const pt = leaf.getPointAtLength((total * i) / PATH_SAMPLES);
        points.push([pt.x, pt.y]);
      }
      pathPointCache.set(leaf, { d, points });
      return points;
    }
  } catch (_err) { /* fall back to the box */ }
  return null;
}

/**
 * The screen box around everything you can see of these elements (stroke
 * included), as { l, t, r, b }, or null. Invisible hit targets (transparent
 * strokes) and hidden parts are skipped.
 */
export function measureInkScreenRect(doc, elements) {
  const win = doc?.defaultView;
  if (!win || !elements?.length) return null;
  let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
  const add = (x, y) => { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y); };
  for (const root of elements) {
    const leaves = [];
    collectLeaves(root, leaves);
    for (const leaf of leaves) {
      const cs = win.getComputedStyle(leaf);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
      if (effectiveOpacity(win, leaf, root) < 0.02) continue;
      if (leaf.namespaceURI !== NS) {
        const rect = leaf.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) { add(rect.left, rect.top); add(rect.right, rect.bottom); }
        continue;
      }
      const tag = leaf.localName;
      const painted = tag === 'image' || tag === 'use' || tag === 'foreignObject' || tag === 'foreignobject';
      const fillShows = paintAlpha(cs.fill, cs.fillOpacity) >= 0.02;
      const strokeWidth = Number.parseFloat(cs.strokeWidth) || 0;
      const strokeShows = strokeWidth > 0 && paintAlpha(cs.stroke, cs.strokeOpacity) >= 0.02;
      if (!painted && !fillShows && !strokeShows) continue; // a hit target
      if (isPointerGlow(leaf, cs)) continue; // the page's own hover / selection glow
      let bb;
      try { bb = leaf.getBBox(); } catch (_err) { bb = null; }
      const ctm = leaf.getScreenCTM?.();
      if (!bb || !ctm) continue;
      const nonScaling = cs.vectorEffect === 'non-scaling-stroke';
      const rotated = Math.abs(ctm.b) > 1e-6 || Math.abs(ctm.c) > 1e-6;
      const scale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1;
      const strokeHalfPx = strokeShows ? (nonScaling ? strokeWidth / 2 : (strokeWidth / 2) * scale) : 0;
      // Turned shapes: take the shape's own outline through the transform (a
      // turned box around a triangle or an oval is far bigger than the shape).
      const points = rotated ? outlinePoints(leaf, tag) : null;
      if (points === ELLIPSE) {
        const cx = leaf.cx.baseVal.value;
        const cy = leaf.cy.baseVal.value;
        const rx = tag === 'circle' ? leaf.r.baseVal.value : leaf.rx.baseVal.value;
        const ry = tag === 'circle' ? leaf.r.baseVal.value : leaf.ry.baseVal.value;
        const sx = ctm.a * cx + ctm.c * cy + ctm.e;
        const sy = ctm.b * cx + ctm.d * cy + ctm.f;
        const hx = Math.hypot(ctm.a * rx, ctm.c * ry) + strokeHalfPx;
        const hy = Math.hypot(ctm.b * rx, ctm.d * ry) + strokeHalfPx;
        add(sx - hx, sy - hy);
        add(sx + hx, sy + hy);
        continue;
      }
      if (points && points.length) {
        for (const [x, y] of points) {
          const sx = ctm.a * x + ctm.c * y + ctm.e;
          const sy = ctm.b * x + ctm.d * y + ctm.f;
          add(sx - strokeHalfPx, sy - strokeHalfPx);
          add(sx + strokeHalfPx, sy + strokeHalfPx);
        }
        continue;
      }
      // Otherwise the shape's box, grown by half the stroke in its own units
      // (a square corner of a turned rectangle comes out exactly right).
      const half = strokeShows && !nonScaling ? strokeWidth / 2 : 0;
      const screenHalf = strokeShows && nonScaling ? strokeWidth / 2 : 0;
      const corners = [
        [bb.x - half, bb.y - half], [bb.x + bb.width + half, bb.y - half],
        [bb.x + bb.width + half, bb.y + bb.height + half], [bb.x - half, bb.y + bb.height + half],
      ];
      for (const [x, y] of corners) {
        const sx = ctm.a * x + ctm.c * y + ctm.e;
        const sy = ctm.b * x + ctm.d * y + ctm.f;
        add(sx - screenHalf, sy - screenHalf);
        add(sx + screenHalf, sy + screenHalf);
      }
    }
  }
  if (!Number.isFinite(l) || !Number.isFinite(t) || r < l || b < t) return null;
  return { l, t, r, b };
}

function screenRectToPage(host, rect) {
  if (!host || !rect) return null;
  const kx = host.vbW / host.rect.width;
  const ky = host.vbH / host.rect.height;
  return {
    x: (rect.l - host.rect.left) * kx,
    y: (rect.t - host.rect.top) * ky,
    width: (rect.r - rect.l) * kx,
    height: (rect.b - rect.t) * ky,
  };
}

/** The ink box (stroke included) of these marks on this page, in page units, or null. */
function measureMarksOnHost(doc, host, markIds) {
  const ids = (Array.isArray(markIds) ? markIds : [markIds]).filter((id) => id != null && id !== '');
  if (!host || !ids.length) return null;
  const els = [];
  for (const id of ids) els.push(...findMarkElements(doc, id));
  const rect = measureInkScreenRect(doc, els);
  if (!rect) return null;
  // The marks must sit on this page's layer.
  if (rect.r < host.rect.left - 2 || rect.l > host.rect.right + 2 || rect.b < host.rect.top - 2 || rect.t > host.rect.bottom + 2) return null;
  return screenRectToPage(host, rect);
}

/** The live mark's box in page units (what you see, stroke included), or null. */
export function measureMarkBox(doc, markId, pageNumber) {
  return measureMarksOnHost(doc, pageHost(doc, pageNumber), markId);
}

/** The box around what you see of several marks on a page (page units), or null. */
export function measureMarksBox(doc, markIds, pageNumber) {
  return measureMarksOnHost(doc, pageHost(doc, pageNumber), markIds);
}

export function createHistoryPageOverlay(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) {
    const noop = () => {};
    return { setHighlight: noop, updateHighlight: noop, setHover: noop, setScene: noop, clearHighlight: noop, clear: noop, destroy: noop, hasHighlight: () => false };
  }
  const win = doc.defaultView;
  // Frames (a timer where there are none, e.g. a test DOM).
  const raf = typeof win.requestAnimationFrame === 'function'
    ? (fn) => win.requestAnimationFrame(fn)
    : (fn) => win.setTimeout(fn, 16);
  const cancelRaf = typeof win.cancelAnimationFrame === 'function'
    ? (id) => win.cancelAnimationFrame(id)
    : (id) => win.clearTimeout(id);
  let root = null;
  const layers = { scene: null, highlight: null, hover: null };
  let frame = 0;
  let dimmed = [];
  // Layers fading out, removed when their fade ends.
  const fading = new Map();

  const ensureRoot = () => {
    ensureStyle(doc);
    if (!root || !root.isConnected) {
      root = doc.getElementById(ROOT_ID) || doc.createElement('div');
      root.id = ROOT_ID;
      doc.body.appendChild(root);
    }
    return root;
  };

  const dropLayer = (layer) => {
    if (!layer) return;
    if (layer.lifeTimer) win.clearTimeout(layer.lifeTimer);
    layer.svg.remove();
    layer.extras.forEach((el) => el.remove());
  };

  const removeLayer = (name, { fade = false } = {}) => {
    const layer = layers[name];
    if (!layer) return;
    layers[name] = null;
    if (!fade) { dropLayer(layer); return; }
    // Fade out, then go (the frame loop no longer places it).
    if (layer.lifeTimer) win.clearTimeout(layer.lifeTimer);
    layer.fadingOut = true;
    layer.svg.classList.remove('in');
    layer.extras.forEach((el) => el.remove());
    const timer = win.setTimeout(() => { fading.delete(layer); dropLayer(layer); }, HISTORY_HIGHLIGHT_FADE_MS + 20);
    fading.set(layer, timer);
  };

  const undim = () => {
    dimmed.forEach(({ el, opacity }) => { el.style.opacity = opacity; });
    dimmed = [];
  };

  // Where a highlight / hover goes this frame, in page units: the marks as
  // they are drawn now, else the scene's ghosts, else the box it was given.
  const resolveTarget = (target, host) => {
    if (!target) return null;
    if (target.markIds?.length) {
      const measured = measureMarksOnHost(doc, host, target.markIds);
      if (measured) return measured;
    }
    if (target.ghosts && layers.scene?.ghostNodes?.length && layers.scene.svg.style.display !== 'none') {
      const rect = measureInkScreenRect(doc, layers.scene.ghostNodes);
      const box = screenRectToPage(host, rect);
      if (box) return box;
    }
    return target.box || null;
  };

  const place = () => {
    frame = 0;
    let any = false;
    // Layers fading out are still placed, so they fade where the mark is.
    for (const layer of [...Object.values(layers), ...fading.keys()]) {
      if (!layer) continue;
      any = true;
      // Fade in on the second frame (the first paints it at 0).
      if (layer.fadeFrames > 0) {
        layer.fadeFrames -= 1;
        if (layer.fadeFrames === 0) layer.svg.classList.add('in');
      }
      const host = pageHost(doc, layer.pageNumber);
      if (!host) {
        layer.svg.style.display = 'none';
        layer.extras.forEach((el) => { el.style.display = 'none'; });
        continue;
      }
      const { rect, vbW, vbH } = host;
      const svg = layer.svg;
      svg.style.display = 'block';
      svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
      svg.style.left = `${rect.left}px`;
      svg.style.top = `${rect.top}px`;
      svg.style.width = `${rect.width}px`;
      svg.style.height = `${rect.height}px`;
      if (layer.clipFor !== host.svg) {
        layer.clipFor = host.svg;
        layer.clipEl = findScrollElement(doc, host.svg);
      }
      const clip = layer.clipEl.getBoundingClientRect();
      const inset = [
        Math.max(0, clip.top - rect.top),
        Math.max(0, rect.right - clip.right),
        Math.max(0, rect.bottom - clip.bottom),
        Math.max(0, clip.left - rect.left),
      ];
      svg.style.clipPath = `inset(${inset.map((v) => `${v}px`).join(' ')})`;
      if (typeof layer.onPlace === 'function') {
        layer.onPlace({ host, kx: rect.width / vbW, ky: rect.height / vbH, clip });
      }
    }
    if (any) frame = raf(place);
  };

  // One loop only: drop any pending frame, place now, and place() queues the
  // next frame itself while something is shown.
  const kick = () => {
    if (frame) { cancelRaf(frame); frame = 0; }
    place();
  };

  const newLayer = (name, pageNumber, { fade = false } = {}) => {
    const prev = layers[name];
    layers[name] = null;
    dropLayer(prev);
    ensureRoot();
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.dataset.historyLayer = name;
    if (fade) svg.setAttribute('class', 'dh-fade');
    root.appendChild(svg);
    const layer = { svg, pageNumber: Number(pageNumber), extras: [], onPlace: null, lifeTimer: 0, fadeFrames: fade ? 2 : 0 };
    layers[name] = layer;
    return layer;
  };

  // The wash + one outline around `layer.target`, padded evenly in screen
  // pixels at every zoom (placed each frame), with an optional Restore fixed
  // to its top-right corner.
  const buildFrame = (layer) => {
    const wash = doc.createElementNS(NS, 'rect');
    wash.setAttribute('class', 'dh-wash');
    const line = doc.createElementNS(NS, 'rect');
    line.setAttribute('class', 'dh-line');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    layer.svg.appendChild(wash);
    layer.svg.appendChild(line);
    layer.onPlace = ({ host, kx, ky, clip }) => {
      // Measuring what is drawn costs more than placing it: re-measure for a
      // new target, when the page changes size (zoom), and every 250 ms
      // otherwise (a mark being edited, a teammate's change); scrolling needs
      // no re-measure (the box is in page units). A fading layer keeps its box.
      const now = typeof win.performance?.now === 'function' ? win.performance.now() : Date.now();
      const sizeKey = `${Math.round(host.rect.width)}x${Math.round(host.rect.height)}`;
      if (!layer.measure || (!layer.fadingOut && (layer.measure.target !== layer.target
        || layer.measure.size !== sizeKey || now - layer.measure.at > 250))) {
        layer.measure = { target: layer.target, size: sizeKey, at: now, box: resolveTarget(layer.target, host) };
      }
      const box = layer.measure.box;
      const show = Boolean(box);
      wash.style.display = show ? '' : 'none';
      line.style.display = show ? '' : 'none';
      if (layer.pinEl) layer.pinEl.style.display = show ? '' : 'none';
      if (!show) return;
      const padX = HISTORY_HIGHLIGHT_PAD_PX / kx;
      const padY = HISTORY_HIGHLIGHT_PAD_PX / ky;
      const x = box.x - padX;
      const y = box.y - padY;
      const w = Math.max(1 / kx, box.width + padX * 2);
      const h = Math.max(1 / ky, box.height + padY * 2);
      for (const node of [wash, line]) {
        node.setAttribute('x', `${x}`);
        node.setAttribute('y', `${y}`);
        node.setAttribute('width', `${w}`);
        node.setAttribute('height', `${h}`);
        node.setAttribute('rx', `${4 / kx}`);
        node.setAttribute('ry', `${4 / ky}`);
      }
      layer.bounds = { x, y, width: w, height: h };
      if (layer.pinEl) {
        // In the highlight's top-right corner; just above that corner when
        // the highlight is too small to hold it.
        if (!(layer.pinSize?.w > 0)) layer.pinSize = { w: layer.pinEl.offsetWidth, h: layer.pinEl.offsetHeight };
        const { w: pw, h: ph } = layer.pinSize;
        const right = host.rect.left + (x + w) * kx;
        const top = host.rect.top + y * ky;
        const fits = w * kx >= pw + 16 && h * ky >= ph * 2 + 12;
        const px = fits ? right - 4 - pw : right - pw;
        const py = fits ? top + 4 : top - ph - 2;
        const visible = px + pw >= clip.left && px <= clip.right && py + ph >= clip.top && py <= clip.bottom;
        layer.pinEl.style.display = visible ? '' : 'none';
        layer.pinEl.style.left = `${px}px`;
        layer.pinEl.style.top = `${py}px`;
      }
    };
  };

  const setPin = (layer, pin) => {
    const wanted = Boolean(pin && typeof pin.onClick === 'function');
    if (layer.pinEl && wanted) {
      // Same button, new action: a redraw never swaps it under a press.
      layer.pinAction = pin.onClick;
      const label = pin.label || 'Restore';
      const span = layer.pinEl.querySelector('span');
      if (span && span.textContent !== label) { span.textContent = label; layer.pinSize = null; }
      return;
    }
    if (layer.pinEl) {
      layer.pinEl.remove();
      layer.extras = layer.extras.filter((el) => el !== layer.pinEl);
      layer.pinEl = null;
      layer.pinSize = null;
    }
    if (!wanted) return;
    layer.pinAction = pin.onClick;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'dh-restore-pin';
    button.dataset.testid = 'document-history-ghost-restore';
    button.title = 'Put it back where it was';
    button.innerHTML = `${RESTORE_GLYPH}<span></span>`;
    button.querySelector('span').textContent = pin.label || 'Restore';
    button.addEventListener('click', (event) => { event.stopPropagation(); layer.pinAction?.(); });
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    root.appendChild(button);
    layer.extras.push(button);
    layer.pinEl = button;
  };

  const targetOf = (spec) => ({
    markIds: (Array.isArray(spec.markIds) ? spec.markIds : []).filter((id) => id != null && id !== '').map(String),
    ghosts: Boolean(spec.ghosts),
    box: spec.box || null,
  });

  const api = {
    /**
     * The highlight around what a line is about (stays until cleared).
     *   { pageNumber, markIds?, ghosts?, box?, pin?: { label, onClick }, lifetimeMs? }
     * markIds: follow those marks as drawn now; ghosts: surround the scene's
     * ghosts; box: page-unit fallback when neither is on the page.
     */
    setHighlight(spec = {}) {
      const page = Number(spec?.pageNumber);
      const target = spec ? targetOf(spec) : null;
      if (!Number.isFinite(page) || !target || (!target.markIds.length && !target.ghosts && !target.box)) {
        removeLayer('highlight', { fade: true });
        return false;
      }
      // Same page: move the one we have (no second fade-in).
      let layer = layers.highlight;
      if (!layer || layer.pageNumber !== page) {
        layer = newLayer('highlight', page, { fade: true });
        buildFrame(layer);
      }
      if (layer.lifeTimer) { win.clearTimeout(layer.lifeTimer); layer.lifeTimer = 0; }
      layer.target = target;
      setPin(layer, spec.pin || null);
      if (Number(spec.lifetimeMs) > 0) {
        layer.lifeTimer = win.setTimeout(() => {
          layer.lifeTimer = 0;
          if (layers.highlight === layer) removeLayer('highlight', { fade: true });
        }, Number(spec.lifetimeMs));
      }
      kick();
      return true;
    },
    /** Move the highlight to a new target, only if one is showing. */
    updateHighlight(spec) {
      if (!layers.highlight) return false;
      return api.setHighlight(spec);
    },
    hasHighlight: () => Boolean(layers.highlight),
    clearHighlight() {
      removeLayer('highlight', { fade: true });
    },
    /** The quieter highlight while a row is pointed at (null clears it). */
    setHover(spec) {
      const target = spec ? targetOf(spec) : null;
      const page = Number(spec?.pageNumber);
      if (!target || !Number.isFinite(page) || (!target.markIds.length && !target.box)) {
        removeLayer('hover');
        return;
      }
      const layer = layers.hover && layers.hover.pageNumber === page ? layers.hover : newLayer('hover', page);
      if (!layer.onPlace) buildFrame(layer);
      layer.target = target;
      kick();
    },
    /**
     * The ghosts that stay while a row is open (null clears them).
     *   ghosts: [{ annotation, box, color, solid }]
     *   trail:  { from: [x, y], to: [x, y] }
     *   dimElements: elements to fade while peeking at the old state
     */
    setScene(spec) {
      removeLayer('scene');
      undim();
      if (!spec || !Number.isFinite(Number(spec.pageNumber))) return;
      const layer = newLayer('scene', spec.pageNumber);
      layer.ghostNodes = [];
      const defs = doc.createElementNS(NS, 'defs');
      defs.innerHTML = `<marker id="dh-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${GHOST_GREY}"/></marker>`;
      layer.svg.appendChild(defs);
      for (const ghost of spec.ghosts || []) {
        const color = ghost.color || GHOST_GREY;
        let node = ghost.annotation ? buildHistoryShapeNode(doc, ghost.annotation) : null;
        if (!node && ghost.box) {
          node = doc.createElementNS(NS, 'rect');
          node.setAttribute('x', `${ghost.box.x}`);
          node.setAttribute('y', `${ghost.box.y}`);
          node.setAttribute('width', `${ghost.box.width}`);
          node.setAttribute('height', `${ghost.box.height}`);
        }
        if (!node) continue;
        node.setAttribute('class', ghost.solid ? 'dh-ghost-solid' : 'dh-ghost');
        node.setAttribute('stroke', color);
        node.setAttribute('vector-effect', 'non-scaling-stroke');
        node.setAttribute('stroke-linecap', 'round');
        node.setAttribute('stroke-linejoin', 'round');
        layer.svg.appendChild(node);
        layer.ghostNodes.push(node);
      }
      if (spec.trail?.from && spec.trail?.to) {
        const line = doc.createElementNS(NS, 'line');
        line.setAttribute('class', 'dh-trail');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.setAttribute('x1', `${spec.trail.from[0]}`);
        line.setAttribute('y1', `${spec.trail.from[1]}`);
        line.setAttribute('x2', `${spec.trail.to[0]}`);
        line.setAttribute('y2', `${spec.trail.to[1]}`);
        line.setAttribute('marker-end', 'url(#dh-arrow)');
        layer.svg.appendChild(line);
      }
      for (const el of spec.dimElements || []) {
        dimmed.push({ el, opacity: el.style.opacity });
        el.style.opacity = '0.18';
      }
      kick();
    },
    clear() {
      removeLayer('highlight', { fade: true });
      removeLayer('hover');
      removeLayer('scene');
      undim();
    },
    destroy() {
      ['highlight', 'hover', 'scene'].forEach((name) => removeLayer(name));
      for (const [layer, timer] of fading) { win.clearTimeout(timer); dropLayer(layer); }
      fading.clear();
      undim();
      if (frame) { cancelRaf(frame); frame = 0; }
      root?.remove();
      root = null;
    },
  };
  return api;
}
