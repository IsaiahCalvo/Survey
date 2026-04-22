/**
 * Shape Fill-Bleed Diagnostics (2026-04-16)
 *
 * Purpose: gather evidence about the "fill bleeds past border" bug on filled
 * shapes (rect/ellipse/polygon/polyline). Instrumentation only — no fixes.
 *
 * Off by default. User enables in DevTools console:
 *   __shapeSpyOn()     // turn on click-to-capture + render logging
 *   __shapeSpyOff()    // turn off
 *   __captureAllShapes()  // dump every shape on the current page
 *
 * Triggers:
 *   - Click any filled shape (rect/ellipse/polygon) while spy is on →
 *     auto-downloads TWO files: a JSON report and an SVG snippet of just that
 *     shape at full rendered size, plus a PNG of the same shape.
 *   - Cmd+Shift+D (or Ctrl+Shift+D) → full-page dump (JSON + whole SVG layer
 *     outerHTML).
 *
 * Files land in the browser's default Download folder.
 */

// Ring buffer of the last N shape renders. `logShapeRender` pushes here from
// svgAnnotationRenderers.jsx. When the user captures a shape we attach the
// most recent matching entry to the report so we have the exact Fabric JSON
// the renderer saw.
const RENDER_BUFFER_MAX = 500;
const renderBuffer = [];

let spyOn = false;

/**
 * Called from inside each shape renderer on every render. Cheap when off.
 * When on, records the full Fabric object + metadata so a later click can
 * cross-reference it by id.
 */
export function logShapeRender(obj, kind) {
  if (!spyOn) return;
  if (!obj) return;
  const id = obj.id || obj.pdfAnnotationId || obj.highlightId || null;
  renderBuffer.push({
    t: Date.now(),
    kind,
    id,
    fabric: cloneForJson(obj),
  });
  if (renderBuffer.length > RENDER_BUFFER_MAX) renderBuffer.shift();
}

/**
 * Called from each shape's onClick. Collects DOM-side facts (computed style,
 * bounding box, outerHTML), pairs them with the most recent render entry for
 * that shape id, and triggers 3 downloads (JSON + SVG + PNG).
 */
export function captureShape(domEl, clickEvent) {
  if (!spyOn) return;
  if (!domEl) return;
  if (clickEvent) {
    clickEvent.stopPropagation?.();
    clickEvent.preventDefault?.();
  }

  const shapeId = domEl.getAttribute('data-shape-id') || 'unknown';
  const kind = domEl.getAttribute('data-shape-kind') || domEl.tagName.toLowerCase();
  const computed = window.getComputedStyle(domEl);
  const bbox = domEl.getBoundingClientRect();

  // Find the most recent render record for this shape id.
  const renderEntry = renderBuffer
    .slice()
    .reverse()
    .find(r => r.id === shapeId) || null;

  // Pull every attribute the renderer actually set, for side-by-side check.
  const attrs = {};
  for (const a of domEl.attributes) attrs[a.name] = a.value;

  const paintComputed = {
    fill: computed.fill,
    fillOpacity: computed.fillOpacity,
    stroke: computed.stroke,
    strokeWidth: computed.strokeWidth,
    strokeOpacity: computed.strokeOpacity,
    opacity: computed.opacity,
    paintOrder: computed.paintOrder,
    vectorEffect: computed.vectorEffect,
    mixBlendMode: computed.mixBlendMode,
  };

  const report = {
    capturedAt: new Date().toISOString(),
    shapeId,
    kind,
    tag: domEl.tagName.toLowerCase(),
    attrs,
    paintComputed,
    bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
    renderEntry,
    parentViewBox: findViewBox(domEl),
  };

  // 1. JSON report
  downloadText(
    `shape-${shapeId}-${tsStamp()}.json`,
    'application/json',
    JSON.stringify(report, null, 2)
  );

  // 2. Standalone SVG of JUST this shape, viewBox fit to its bounding box in
  //    its own coordinate system (the parent's viewBox origin). This lets us
  //    open the file and see the exact pixel rendering the browser produced.
  const standaloneSvg = buildStandaloneSvg(domEl, report.parentViewBox);
  downloadText(`shape-${shapeId}-${tsStamp()}.svg`, 'image/svg+xml', standaloneSvg);

  // 3. PNG raster of the same standalone SVG — scaled up 4x for easy
  //    zoom-inspection of the bleed.
  rasterizeSvgToPng(standaloneSvg, 4).then(pngBlob => {
    if (!pngBlob) return;
    downloadBlob(`shape-${shapeId}-${tsStamp()}.png`, pngBlob);
  });

  // eslint-disable-next-line no-console
  console.log('[shape-spy] captured', shapeId, report);
}

/**
 * Full-page dump: every annotation shape on the page plus the whole SVG
 * layer's outerHTML. One JSON, one SVG.
 */
export function captureAllShapes() {
  const layers = Array.from(document.querySelectorAll('[data-svg-annotation-layer]'));
  const fallback = layers.length === 0
    ? Array.from(document.querySelectorAll('svg.svg-annotation-layer, svg[data-annotation-layer]'))
    : layers;
  const target = fallback[0] || document.querySelector('svg');
  if (!target) {
    // eslint-disable-next-line no-console
    console.warn('[shape-spy] no SVG annotation layer found on page');
    return;
  }

  const shapes = Array.from(target.querySelectorAll('[data-shape-id]'));
  const report = {
    capturedAt: new Date().toISOString(),
    totalShapes: shapes.length,
    shapes: shapes.map(el => {
      const cs = window.getComputedStyle(el);
      const b = el.getBoundingClientRect();
      const attrs = {};
      for (const a of el.attributes) attrs[a.name] = a.value;
      return {
        shapeId: el.getAttribute('data-shape-id'),
        kind: el.getAttribute('data-shape-kind') || el.tagName.toLowerCase(),
        attrs,
        paintComputed: {
          fill: cs.fill,
          fillOpacity: cs.fillOpacity,
          stroke: cs.stroke,
          strokeWidth: cs.strokeWidth,
          strokeOpacity: cs.strokeOpacity,
          opacity: cs.opacity,
          paintOrder: cs.paintOrder,
          vectorEffect: cs.vectorEffect,
        },
        bbox: { x: b.x, y: b.y, w: b.width, h: b.height },
      };
    }),
  };

  downloadText(`shape-page-${tsStamp()}.json`, 'application/json', JSON.stringify(report, null, 2));
  downloadText(`shape-page-${tsStamp()}.svg`, 'image/svg+xml', target.outerHTML);
  // eslint-disable-next-line no-console
  console.log('[shape-spy] full page captured', report);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function cloneForJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj, (k, v) => {
      if (typeof v === 'function') return undefined;
      if (v instanceof HTMLElement) return '[HTMLElement]';
      if (v instanceof SVGElement) return '[SVGElement]';
      return v;
    }));
  } catch {
    return { _cloneError: true };
  }
}

function findViewBox(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    if (cur.tagName && cur.tagName.toLowerCase() === 'svg') {
      return cur.getAttribute('viewBox') || null;
    }
    cur = cur.parentNode;
  }
  return null;
}

function buildStandaloneSvg(el, parentViewBox) {
  const bbSvg = el.getBBox ? el.getBBox() : null;
  const pad = 4;
  let viewBox = parentViewBox;
  if (bbSvg) {
    viewBox = `${bbSvg.x - pad} ${bbSvg.y - pad} ${bbSvg.width + pad * 2} ${bbSvg.height + pad * 2}`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox || '0 0 100 100'}">\n` +
    `  <!-- captured ${new Date().toISOString()} from live DOM -->\n` +
    `  ${el.outerHTML}\n` +
    `</svg>`;
}

function rasterizeSvgToPng(svgText, upscale = 2) {
  return new Promise(resolve => {
    try {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const w = (img.naturalWidth || 400) * upscale;
        const h = (img.naturalHeight || 400) * upscale;
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, w, h);
        cvs.toBlob(b => {
          URL.revokeObjectURL(url);
          resolve(b);
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

function downloadText(filename, mime, text) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function tsStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Globals + hotkey
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.__shapeSpyOn = () => {
    spyOn = true;
    // eslint-disable-next-line no-console
    console.log('[shape-spy] ON — click any filled shape to capture it. Cmd/Ctrl+Shift+D = full page.');
  };
  window.__shapeSpyOff = () => {
    spyOn = false;
    // eslint-disable-next-line no-console
    console.log('[shape-spy] OFF');
  };
  window.__shapeSpyStatus = () => ({ on: spyOn, buffered: renderBuffer.length });
  window.__captureAllShapes = captureAllShapes;

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      captureAllShapes();
    }
  });

  // Cmd/Ctrl+Shift+click anywhere: scan every element under the cursor
  // (elementsFromPoint pierces pointer-events:none layers), pick the first
  // one tagged as a shape, and capture it. This bypasses the case where the
  // SVG annotation layer is pointer-events: none and the shape's own onClick
  // never fires.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (!spyOn) return;
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      const shape = stack.find(el => el.hasAttribute && el.hasAttribute('data-shape-id'));
      if (shape) {
        e.preventDefault();
        e.stopPropagation();
        captureShape(shape, e);
      }
    },
    true
  );
}

export function isShapeSpyOn() {
  return spyOn;
}
