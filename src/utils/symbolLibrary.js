/**
 * Engineering symbol library (KAL-407 / F13).
 *
 * A starter set of common symbols drawn after IEC 60617 (electrical) and
 * ISA-5.1 (instruments and valves). Each symbol is plain line art: a viewBox
 * and a list of SVG paths using only absolute M, L, H, V, A and Z commands,
 * so the same data draws in every renderer:
 *   - on screen, as an SVG data URL in the stamp <image> the SVG layer
 *     already draws (utils/pdfStampProxy.js), crisp at any zoom;
 *   - in the canvas painter (zoom proxy, thumbnails, worker) as Path2D;
 *   - in print and PDF export as vector paths (transformSymbolPath).
 *
 * A placed symbol is a stamp mark: type 'image', pdfAnnotationType 'Stamp',
 * src = the SVG data URL, data.symbolStamp = { id, color, version }. Unlike an
 * imported PDF stamp it is not locked: it moves, resizes and rotates.
 */
import { isPdfStampProxy } from './pdfStampProxy.js';

export const SYMBOL_LIBRARY_VERSION = 1;
export const SYMBOL_STROKE_WIDTH = 2.5;
/** Width on the page, in PDF points, of a newly placed symbol's longer side. */
export const SYMBOL_DEFAULT_SIZE = 40;
export const SYMBOL_COLORS = Object.freeze(['#e11d48', '#111111', '#2563eb']);

const circle = (cx, cy, r) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
const bowTie = (x0, y0, x1, y1) => {
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  return `M${x0} ${y0} L${cx} ${cy} L${x0} ${y1} Z M${x1} ${y0} L${cx} ${cy} L${x1} ${y1} Z`;
};
const p = (d, fill = false) => ({ d, fill });

export const SYMBOL_CATEGORIES = Object.freeze([
  { id: 'electrical', label: 'Electrical', standard: 'IEC 60617' },
  { id: 'instruments', label: 'Instruments and valves', standard: 'ISA-5.1' },
]);

export const SYMBOLS = Object.freeze([
  // Electrical (IEC 60617)
  { id: 'iec-resistor', category: 'electrical', label: 'Resistor', viewBox: [64, 24],
    paths: [p('M0 12 H14 M50 12 H64'), p('M14 6 H50 V18 H14 Z')] },
  { id: 'iec-capacitor', category: 'electrical', label: 'Capacitor', viewBox: [64, 32],
    paths: [p('M0 16 H28 M36 16 H64 M28 4 V28 M36 4 V28')] },
  { id: 'iec-inductor', category: 'electrical', label: 'Inductor', viewBox: [64, 24],
    paths: [p('M0 16 H12 A5 5 0 0 1 22 16 A5 5 0 0 1 32 16 A5 5 0 0 1 42 16 A5 5 0 0 1 52 16 H64')] },
  { id: 'iec-fuse', category: 'electrical', label: 'Fuse', viewBox: [64, 24],
    paths: [p('M0 12 H64'), p('M14 6 H50 V18 H14 Z')] },
  { id: 'iec-make-contact', category: 'electrical', label: 'Open contact', viewBox: [64, 32],
    paths: [p('M0 24 H20 L44 8 M44 24 H64')] },
  { id: 'iec-break-contact', category: 'electrical', label: 'Closed contact', viewBox: [64, 32],
    paths: [p('M0 24 H20 L47 17 M42 8 V24 H64')] },
  { id: 'iec-circuit-breaker', category: 'electrical', label: 'Circuit breaker', viewBox: [64, 32],
    paths: [p('M0 24 H20 L44 8 M44 24 H64 M40 20 L48 28 M48 20 L40 28')] },
  { id: 'iec-earth', category: 'electrical', label: 'Ground', viewBox: [48, 48],
    paths: [p('M24 4 V24 M10 24 H38 M15 31 H33 M20 38 H28')] },
  { id: 'iec-lamp', category: 'electrical', label: 'Lamp', viewBox: [64, 32],
    paths: [p(circle(32, 16, 12)), p('M23.5 7.5 L40.5 24.5 M40.5 7.5 L23.5 24.5 M0 16 H20 M44 16 H64')] },
  { id: 'iec-motor', category: 'electrical', label: 'Motor', viewBox: [48, 48],
    paths: [p(circle(24, 24, 18)), p('M15 32 V16 L24 26 L33 16 V32')] },
  { id: 'iec-transformer', category: 'electrical', label: 'Transformer', viewBox: [48, 64],
    paths: [p(circle(24, 23, 12)), p(circle(24, 41, 12)), p('M24 0 V11 M24 53 V64')] },
  { id: 'iec-diode', category: 'electrical', label: 'Diode', viewBox: [64, 32],
    paths: [p('M0 16 H22 M42 16 H64 M42 5 V27'), p('M22 5 L42 16 L22 27 Z', true)] },
  { id: 'iec-cell', category: 'electrical', label: 'Battery cell', viewBox: [64, 32],
    paths: [p('M0 16 H28 M36 16 H64 M28 3 V29 M36 9 V23')] },
  // Instruments and valves (ISA-5.1)
  { id: 'isa-field-instrument', category: 'instruments', label: 'Field instrument', viewBox: [48, 48],
    paths: [p(circle(24, 24, 18))] },
  { id: 'isa-panel-instrument', category: 'instruments', label: 'Panel instrument', viewBox: [48, 48],
    paths: [p(circle(24, 24, 18)), p('M6 24 H42')] },
  { id: 'isa-behind-panel', category: 'instruments', label: 'Behind-panel instrument', viewBox: [48, 48],
    paths: [p(circle(24, 24, 18)), p('M6 24 H11 M15 24 H21 M27 24 H33 M37 24 H42')] },
  { id: 'isa-shared-display', category: 'instruments', label: 'Shared display (DCS)', viewBox: [48, 48],
    paths: [p('M6 6 H42 V42 H6 Z'), p(circle(24, 24, 18))] },
  { id: 'isa-plc', category: 'instruments', label: 'PLC', viewBox: [48, 48],
    paths: [p('M6 6 H42 V42 H6 Z M24 6 L42 24 L24 42 L6 24 Z')] },
  { id: 'isa-computer', category: 'instruments', label: 'Computer function', viewBox: [48, 48],
    paths: [p('M14 7 H34 L44 24 L34 41 H14 L4 24 Z')] },
  { id: 'isa-gate-valve', category: 'instruments', label: 'Gate valve', viewBox: [64, 32],
    paths: [p(bowTie(8, 6, 56, 26))] },
  { id: 'isa-globe-valve', category: 'instruments', label: 'Globe valve', viewBox: [64, 32],
    paths: [p(bowTie(8, 6, 56, 26)), p(circle(32, 16, 4), true)] },
  { id: 'isa-ball-valve', category: 'instruments', label: 'Ball valve', viewBox: [64, 32],
    paths: [p(bowTie(8, 6, 56, 26)), p(circle(32, 16, 6))] },
  { id: 'isa-check-valve', category: 'instruments', label: 'Check valve', viewBox: [64, 32],
    paths: [p('M8 6 V26 L56 6 V26'), p('M38 10 L50 9 L44 19 Z', true)] },
  { id: 'isa-control-valve', category: 'instruments', label: 'Control valve', viewBox: [64, 56],
    paths: [p(bowTie(8, 30, 56, 50)), p('M32 40 V18 M18 18 A14 14 0 0 1 46 18 Z')] },
  { id: 'isa-pump', category: 'instruments', label: 'Pump', viewBox: [48, 48],
    paths: [p(circle(24, 24, 16)), p('M24 8 H46 M15 37 L9 45 H39 L33 37')] },
]);

const BY_ID = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

export const getSymbol = (id) => BY_ID.get(id) || null;
export const symbolsInCategory = (categoryId) => SYMBOLS.filter((s) => s.category === categoryId);

const escapeAttr = (value) => String(value).replace(/[^#0-9a-zA-Z]/g, '');

/** The symbol as a standalone SVG document (stretches with its box, like the other renderers). */
export function buildSymbolSvg(symbol, color = SYMBOL_COLORS[0]) {
  if (!symbol) return '';
  const [w, h] = symbol.viewBox;
  const c = escapeAttr(color) || '#000000';
  const body = symbol.paths.map((path) => (path.fill
    ? `<path d="${path.d}" fill="${c}" stroke="${c}" stroke-width="${SYMBOL_STROKE_WIDTH}" stroke-linejoin="round"/>`
    : `<path d="${path.d}" fill="none" stroke="${c}" stroke-width="${SYMBOL_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" overflow="visible">${body}</svg>`;
}

export const symbolDataUrl = (symbol, color) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSymbolSvg(symbol, color))}`;

/** True for a placed library symbol (a stamp mark that carries its symbol id). */
export const isSymbolStamp = (obj) => isPdfStampProxy(obj) && Boolean(getSymbol(obj?.data?.symbolStamp?.id));

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `symbol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * A new symbol mark centred on (centerX, centerY) in page units. The longer
 * side is `size` points; the other keeps the symbol's proportions.
 */
export function createSymbolStampObject({ symbolId, color = SYMBOL_COLORS[0], centerX, centerY, size = SYMBOL_DEFAULT_SIZE, id = newId() }) {
  const symbol = getSymbol(symbolId);
  if (!symbol) return null;
  const [w, h] = symbol.viewBox;
  const k = size / Math.max(w, h);
  const width = Math.round(w * k * 100) / 100;
  const height = Math.round(h * k * 100) / 100;
  return {
    id,
    type: 'image',
    src: symbolDataUrl(symbol, color),
    pdfAnnotationType: 'Stamp',
    left: Math.round((Number(centerX) - width / 2) * 100) / 100,
    top: Math.round((Number(centerY) - height / 2) * 100) / 100,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    selectable: true,
    evented: true,
    data: { id, symbolStamp: { id: symbol.id, color, version: SYMBOL_LIBRARY_VERSION } },
  };
}

// ---- geometry shared by the canvas painter and the PDF writer -------------

const TOKEN = /([MLHVAZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;
const ARGS = { M: 2, L: 2, H: 1, V: 1, A: 7, Z: 0 };

/** Parse one of this library's paths into [command, ...numbers] steps. Throws on anything else. */
export function parseSymbolPath(d) {
  const bad = String(d).match(/[^MLHVAZmlhvaz0-9.,\s\-e]/);
  if (bad) throw new Error(`Symbol paths use only M, L, H, V, A and Z: ${bad[0]}`);
  const steps = [];
  let current = null;
  for (const [, cmd, num] of String(d).matchAll(TOKEN)) {
    if (cmd) {
      const upper = cmd.toUpperCase();
      if (upper !== cmd) throw new Error(`Symbol paths use absolute commands only: ${cmd}`);
      current = [upper];
      steps.push(current);
      continue;
    }
    if (!current) throw new Error('Symbol path starts with a number');
    if (current.length - 1 === ARGS[current[0]]) {
      // Implicit repeat (an M repeats as L).
      current = [current[0] === 'M' ? 'L' : current[0]];
      steps.push(current);
    }
    current.push(Number(num));
  }
  for (const step of steps) {
    if (step.length - 1 !== ARGS[step[0]]) throw new Error(`Bad ${step[0]} in symbol path`);
  }
  return steps;
}

/**
 * The page-space box a symbol mark is drawn in: left/top/width/height (with
 * scale) and the angle the stamp renderers apply about the box centre.
 */
export function symbolStampBox(obj) {
  const width = Math.max(0, (Number(obj?.width) || 0) * Math.abs(Number(obj?.scaleX) || 1));
  const height = Math.max(0, (Number(obj?.height) || 0) * Math.abs(Number(obj?.scaleY) || 1));
  return { left: Number(obj?.left) || 0, top: Number(obj?.top) || 0, width, height, angle: Number(obj?.angle) || 0 };
}

/**
 * Map a symbol path into page space (y down) for a mark's box: stretch the
 * viewBox onto the box, then rotate about the box centre. Arcs keep their
 * radii scaled per axis and take the rotation as their x-axis rotation.
 */
export function transformSymbolPath(d, viewBox, box) {
  const [vw, vh] = viewBox;
  const sx = box.width / vw; const sy = box.height / vh;
  const cx = box.left + box.width / 2; const cy = box.top + box.height / 2;
  const rad = (box.angle * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  const at = (x, y) => {
    const px = box.left + x * sx - cx; const py = box.top + y * sy - cy;
    return [cx + px * cos - py * sin, cy + px * sin + py * cos];
  };
  const r = (n) => Math.round(n * 1000) / 1000;
  let x = 0; let y = 0;
  const out = [];
  for (const [cmd, ...a] of parseSymbolPath(d)) {
    if (cmd === 'Z') { out.push('Z'); continue; }
    if (cmd === 'M' || cmd === 'L') { [x, y] = a; }
    else if (cmd === 'H') { [x] = a; }
    else if (cmd === 'V') { [y] = a; }
    if (cmd === 'A') {
      [x, y] = [a[5], a[6]];
      const [px, py] = at(x, y);
      out.push(`A${r(a[0] * sx)} ${r(a[1] * sy)} ${r(a[2] + box.angle)} ${a[3]} ${a[4]} ${r(px)} ${r(py)}`);
      continue;
    }
    const [px, py] = at(x, y);
    out.push(`${cmd === 'M' ? 'M' : 'L'}${r(px)} ${r(py)}`);
  }
  return out.join(' ');
}

/** The stroke width on the page for a mark's box (scales with the box like the SVG image does). */
export const symbolStampStrokeWidth = (symbol, box) => SYMBOL_STROKE_WIDTH
  * Math.sqrt((box.width / symbol.viewBox[0]) * (box.height / symbol.viewBox[1]));
