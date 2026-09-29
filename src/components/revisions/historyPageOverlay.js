/**
 * historyPageOverlay.js — RULED 2026-09-28 owner: History option A.
 *
 * What the History panel draws ON the page, in one fixed-position layer that
 * follows the page as it scrolls and zooms (it reads the page's annotation
 * layer rectangle every frame while something is shown, and stops when
 * nothing is):
 *
 *   highlight  the mark you picked: a blue outline around it that draws on,
 *              pulses twice, then fades (about 4 s). Selection blue #4a90e2,
 *              never gold (owner ruling 2026-09-17).
 *   hover      a quiet dashed blue outline while you point at a row.
 *   scene      what stays while a row is open:
 *                - a dashed grey ghost of a deleted mark, tagged "Deleted",
 *                  with a Restore button on the page above it;
 *                - a ghost of where / how a mark was before a move, resize or
 *                  color change, tagged "Before" (or "After" when you peek at
 *                  the old state), with a dotted trail for a move.
 *
 * Reference: the approved prototype history-A.html (V.highlight / V.hover /
 * ghosts / V.pin). Everything is in page units (the annotation layer's
 * viewBox), so it stays on the mark at any zoom. Nothing here changes a mark:
 * looking is free, only Restore changes the document.
 */
import { buildHistoryShapeNode } from '../../utils/historyGeometry.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'document-history-overlay-style';
const ROOT_ID = 'document-history-overlay';
export const HISTORY_HIGHLIGHT_BLUE = '#4a90e2';
const GHOST_GREY = '#9aa0aa';
export const HISTORY_HIGHLIGHT_LIFETIME_MS = 4300;

// z-index 5100: above the viewer's own stack (5000) so the ghost's Restore
// button can be clicked, below the app chrome (top 5500, side rails 5600).
function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 5100; }
    #${ROOT_ID} svg { position: fixed; overflow: visible; pointer-events: none; }
    #${ROOT_ID} .dh-hl { fill: none; stroke: ${HISTORY_HIGHLIGHT_BLUE}; stroke-width: 2.4px; stroke-dasharray: 100; stroke-dashoffset: 100;
      animation: dhDraw .55s ease-out forwards, dhPulse .42s ease-in-out .6s 4 alternate, dhFade .7s ease 3.6s forwards; }
    #${ROOT_ID} .dh-halo { fill: rgba(74,144,226,.10); stroke: none; opacity: 0;
      animation: dhHalo .84s ease-in-out .55s 2, dhFade .7s ease 3.6s forwards; }
    #${ROOT_ID} .dh-hover { fill: none; stroke: ${HISTORY_HIGHLIGHT_BLUE}; stroke-opacity: .75; stroke-width: 1.5px; stroke-dasharray: 4 3; }
    #${ROOT_ID} .dh-ghost { fill: none; stroke-width: 1.6px; stroke-dasharray: 4 3; opacity: .85; }
    #${ROOT_ID} .dh-ghost-solid { fill: none; stroke-width: 2px; opacity: .95; }
    #${ROOT_ID} .dh-trail { fill: none; stroke: #7a8290; stroke-width: 1.3px; stroke-dasharray: 2 3; }
    #${ROOT_ID} .dh-tag { position: fixed; transform: translate(0, 4px); font: 600 10px/1.5 var(--font-primary, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif);
      letter-spacing: .02em; color: #e6e8eb; background: rgba(19,20,23,.92); border-radius: 4px; padding: 0 5px; white-space: nowrap; }
    #${ROOT_ID} .dh-pin { position: fixed; transform: translate(-50%, calc(-100% - 8px)); pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
      background: #15161a; color: #fff; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 5px 10px 5px 8px;
      font: 600 12px/1.2 var(--font-primary, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif);
      cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); white-space: nowrap; }
    #${ROOT_ID} .dh-pin:hover { color: ${HISTORY_HIGHLIGHT_BLUE}; }
    #${ROOT_ID} .dh-pin:active svg { transform: scale(.86); }
    #${ROOT_ID} .dh-pin svg { width: 14px; height: 14px; }
    @keyframes dhDraw { to { stroke-dashoffset: 0; } }
    @keyframes dhPulse { from { stroke-opacity: 1; } to { stroke-opacity: .3; } }
    @keyframes dhHalo { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes dhFade { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      #${ROOT_ID} .dh-hl, #${ROOT_ID} .dh-halo { animation: dhFade .3s ease 2.5s forwards; stroke-dashoffset: 0; }
    }
  `;
  doc.head.appendChild(style);
}

const RESTORE_GLYPH = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 9.5a5.8 5.8 0 111.8 4.6"/><path d="M4 5.2v4.3h4.3"/></svg>';

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
  for (const selector of selectors) {
    try {
      const found = Array.from(doc.querySelectorAll(selector)).filter((el) => {
        const r = el.getBoundingClientRect?.();
        return r && (r.width > 0 || r.height > 0);
      });
      if (found.length) return found;
    } catch (_err) { /* bad selector: skip */ }
  }
  return [];
}

/** The live mark's box in page units, measured from its elements, or null. */
export function measureMarkBox(doc, markId, pageNumber) {
  const host = pageHost(doc, pageNumber);
  if (!host) return null;
  const els = findMarkElements(doc, markId);
  if (!els.length) return null;
  let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    l = Math.min(l, rect.left); t = Math.min(t, rect.top); r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
  }
  // The mark must sit on this page's layer.
  if (r < host.rect.left - 2 || l > host.rect.right + 2 || b < host.rect.top - 2 || t > host.rect.bottom + 2) return null;
  const kx = host.vbW / host.rect.width;
  const ky = host.vbH / host.rect.height;
  return { x: (l - host.rect.left) * kx, y: (t - host.rect.top) * ky, width: (r - l) * kx, height: (b - t) * ky };
}

export function createHistoryPageOverlay(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) {
    const noop = () => {};
    return { setHighlight: noop, setHover: noop, setScene: noop, clearHighlight: noop, clear: noop, destroy: noop, hasHighlight: () => false };
  }
  const win = doc.defaultView;
  let root = null;
  const layers = { scene: null, highlight: null, hover: null };
  let frame = 0;
  let highlightTimer = 0;
  let dimmed = [];

  const ensureRoot = () => {
    ensureStyle(doc);
    if (!root || !root.isConnected) {
      root = doc.getElementById(ROOT_ID) || doc.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'false');
      doc.body.appendChild(root);
    }
    return root;
  };

  const removeLayer = (name) => {
    const layer = layers[name];
    if (!layer) return;
    layer.svg.remove();
    layer.labels.forEach((label) => label.el.remove());
    layers[name] = null;
  };

  const undim = () => {
    dimmed.forEach(({ el, opacity }) => { el.style.opacity = opacity; });
    dimmed = [];
  };

  const place = () => {
    frame = 0;
    let any = false;
    for (const name of Object.keys(layers)) {
      const layer = layers[name];
      if (!layer) continue;
      any = true;
      const host = pageHost(doc, layer.pageNumber);
      if (!host) {
        layer.svg.style.display = 'none';
        layer.labels.forEach((label) => { label.el.style.display = 'none'; });
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
      const kx = rect.width / vbW;
      const ky = rect.height / vbH;
      if (typeof layer.onPlace === 'function') layer.onPlace({ kx, ky, vbW });
      for (const label of layer.labels) {
        const x = rect.left + label.x * kx;
        const y = rect.top + label.y * ky;
        const visible = x >= clip.left - 1 && x <= clip.right + 1 && y >= clip.top - 1 && y <= clip.bottom + 1;
        label.el.style.display = visible ? '' : 'none';
        label.el.style.left = `${x}px`;
        label.el.style.top = `${y}px`;
      }
    }
    if (any) frame = win.requestAnimationFrame(place);
  };

  // One loop only: drop any pending frame, place now, and place() queues the
  // next frame itself while something is shown.
  const kick = () => {
    if (frame) { win.cancelAnimationFrame(frame); frame = 0; }
    place();
  };

  const newLayer = (name, pageNumber) => {
    removeLayer(name);
    ensureRoot();
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.dataset.historyLayer = name;
    root.appendChild(svg);
    const layer = { svg, pageNumber: Number(pageNumber), labels: [], onPlace: null };
    layers[name] = layer;
    return layer;
  };

  const addLabel = (layer, el, x, y) => {
    root.appendChild(el);
    layer.labels.push({ el, x, y });
  };

  // A rectangle around `box`, `padPx` screen pixels outside it, kept right
  // at every zoom (updated each frame).
  const paddedRect = (layer, className, box, padPx, extra = null) => {
    const node = doc.createElementNS(NS, 'rect');
    node.setAttribute('class', className);
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    if (extra) extra(node);
    layer.svg.appendChild(node);
    const prev = layer.onPlace;
    layer.onPlace = (m) => {
      if (prev) prev(m);
      const px = 1 / m.kx;
      const pad = padPx * px;
      node.setAttribute('x', `${box.x - pad}`);
      node.setAttribute('y', `${box.y - pad}`);
      node.setAttribute('width', `${Math.max(1, box.width + pad * 2)}`);
      node.setAttribute('height', `${Math.max(1, box.height + pad * 2)}`);
      node.setAttribute('rx', `${4 * px}`);
    };
    return node;
  };

  const api = {
    /** Blue draw-on / pulse / fade outline around the mark. */
    setHighlight({ pageNumber, box } = {}) {
      removeLayer('highlight');
      if (highlightTimer) { win.clearTimeout(highlightTimer); highlightTimer = 0; }
      if (!box || !Number.isFinite(Number(pageNumber))) return false;
      const layer = newLayer('highlight', pageNumber);
      paddedRect(layer, 'dh-halo', box, 6);
      paddedRect(layer, 'dh-hl', box, 6, (node) => node.setAttribute('pathLength', '100'));
      highlightTimer = win.setTimeout(() => { highlightTimer = 0; removeLayer('highlight'); }, HISTORY_HIGHLIGHT_LIFETIME_MS);
      kick();
      return true;
    },
    hasHighlight: () => Boolean(layers.highlight),
    clearHighlight() {
      if (highlightTimer) { win.clearTimeout(highlightTimer); highlightTimer = 0; }
      removeLayer('highlight');
    },
    /** Dashed blue outline while a row is pointed at (null clears it). */
    setHover(spec) {
      removeLayer('hover');
      if (!spec?.box || !Number.isFinite(Number(spec.pageNumber))) return;
      const layer = newLayer('hover', spec.pageNumber);
      paddedRect(layer, 'dh-hover', spec.box, 5);
      kick();
    },
    /**
     * The ghosts that stay while a row is open (null clears them).
     *   ghosts: [{ annotation, box, color, solid, tag }]
     *   trail:  { from: [x, y], to: [x, y] }
     *   pin:    { box, label, onClick }
     *   dimElements: elements to fade while peeking at the old state
     */
    setScene(spec) {
      removeLayer('scene');
      undim();
      if (!spec || !Number.isFinite(Number(spec.pageNumber))) return;
      const layer = newLayer('scene', spec.pageNumber);
      const defs = doc.createElementNS(NS, 'defs');
      defs.innerHTML = '<marker id="dh-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7a8290"/></marker>';
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
        if (node) {
          node.setAttribute('class', ghost.solid ? 'dh-ghost-solid' : 'dh-ghost');
          node.setAttribute('stroke', color);
          node.setAttribute('vector-effect', 'non-scaling-stroke');
          node.setAttribute('stroke-linecap', 'round');
          node.setAttribute('stroke-linejoin', 'round');
          layer.svg.appendChild(node);
        }
        if (ghost.tag && ghost.box) {
          const tag = doc.createElement('span');
          tag.className = 'dh-tag';
          tag.textContent = ghost.tag;
          addLabel(layer, tag, ghost.box.x, ghost.box.y + ghost.box.height);
        }
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
      if (spec.pin?.box && typeof spec.pin.onClick === 'function') {
        const pin = doc.createElement('button');
        pin.type = 'button';
        pin.className = 'dh-pin';
        pin.dataset.testid = 'document-history-ghost-restore';
        pin.title = 'Put it back where it was';
        pin.innerHTML = `${RESTORE_GLYPH}<span></span>`;
        pin.querySelector('span').textContent = spec.pin.label || 'Restore';
        pin.addEventListener('click', (event) => { event.stopPropagation(); spec.pin.onClick(); });
        pin.addEventListener('pointerdown', (event) => event.stopPropagation());
        addLabel(layer, pin, spec.pin.box.x + spec.pin.box.width / 2, spec.pin.box.y);
      }
      for (const el of spec.dimElements || []) {
        dimmed.push({ el, opacity: el.style.opacity });
        el.style.opacity = '0.18';
      }
      kick();
    },
    clear() {
      if (highlightTimer) { win.clearTimeout(highlightTimer); highlightTimer = 0; }
      removeLayer('highlight');
      removeLayer('hover');
      removeLayer('scene');
      undim();
    },
    destroy() {
      api.clear();
      if (frame) { win.cancelAnimationFrame(frame); frame = 0; }
      root?.remove();
      root = null;
    },
  };
  return api;
}
