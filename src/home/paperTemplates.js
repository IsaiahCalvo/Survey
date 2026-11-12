/**
 * Paper templates for Home > New (Nightly flag 'home-templates'), copied from
 * Drawboard PDF's + menu: Notebook paper in one tap, and Other templates in
 * three groups (Notetaking, Grids and graphs, Music).
 *
 * Every template is a list of marks in PDF space (points, origin bottom
 * left), so the same numbers draw the PDF (utils/blankPdf.js) and the small
 * previews in the picker. A mark is { kind: 'line', x1, y1, x2, y2, tone }
 * or { kind: 'dot', x, y, tone }; tone is 'rule' (light blue), 'major'
 * (darker blue), 'margin' (red) or 'ink' (grey, music staves). Pure, for
 * tests.
 */

const IN = 72;
const MM = 72 / 25.4;

export const TEMPLATE_GROUPS = Object.freeze([
  Object.freeze({ id: 'notes', label: 'Notetaking' }),
  Object.freeze({ id: 'grids', label: 'Grids and graphs' }),
  Object.freeze({ id: 'music', label: 'Music' }),
]);

export const PAPER_TEMPLATES = Object.freeze([
  { id: 'blank', group: 'notes', label: 'Blank page' },
  { id: 'notebook', group: 'notes', label: 'Notebook paper' },
  { id: 'gregg', group: 'notes', label: 'Gregg ruled' },
  { id: 'pitman', group: 'notes', label: 'Pitman ruled' },
  { id: 'cornell', group: 'notes', label: 'Cornell notes' },
  { id: 'engineering', group: 'grids', label: 'Engineering grid' },
  { id: 'graph-quarter-in', group: 'grids', label: 'Graph 1/4 in' },
  { id: 'graph-eighth-in', group: 'grids', label: 'Graph 1/8 in' },
  { id: 'graph-1cm', group: 'grids', label: 'Graph 1 cm' },
  { id: 'graph-half-cm', group: 'grids', label: 'Graph 1/2 cm' },
  { id: 'graph-1mm', group: 'grids', label: 'Graph 1 mm' },
  { id: 'isometric', group: 'grids', label: 'Isometric' },
  { id: 'hex', group: 'grids', label: 'Hexagons' },
  { id: 'stave', group: 'music', label: 'Blank stave' },
  { id: 'tab', group: 'music', label: '6 line tab' },
  { id: 'double-stave', group: 'music', label: 'Double stave' },
].map((t) => Object.freeze(t)));

export const NOTEBOOK_PAGES = 10;

export function isPaperTemplate(id) {
  return PAPER_TEMPLATES.some((t) => t.id === id);
}

export function templateLabel(id) {
  return PAPER_TEMPLATES.find((t) => t.id === id)?.label || 'Blank page';
}

const line = (x1, y1, x2, y2, tone = 'rule') => ({ kind: 'line', x1, y1, x2, y2, tone });

// Ruled lines across [x1, x2] from the top line down to the bottom limit.
function ruled(marks, { x1, x2, top, bottom, gap, tone = 'rule' }) {
  for (let y = top; y >= bottom - 0.01; y -= gap) marks.push(line(x1, y, x2, y, tone));
}

// A square grid; every `majorEvery` line is a major line (0 = none).
function grid(marks, box, step, majorEvery = 0) {
  let i = 1;
  for (let x = step; x < box.width - 0.01; x += step, i += 1) {
    marks.push(line(x, 0, x, box.height, majorEvery && i % majorEvery === 0 ? 'major' : 'rule'));
  }
  i = 1;
  for (let y = step; y < box.height - 0.01; y += step, i += 1) {
    marks.push(line(0, y, box.width, y, majorEvery && i % majorEvery === 0 ? 'major' : 'rule'));
  }
}

// The part of the infinite line through (px, py) with direction (dx, dy)
// that lies inside the box, or null.
function clipToBox(px, py, dx, dy, box, from = -Infinity, to = Infinity) {
  let t0 = from;
  let t1 = to;
  const edges = [[dx, px, 0, box.width], [dy, py, 0, box.height]];
  for (const [d, p, lo, hi] of edges) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return null;
    } else {
      const a = (lo - p) / d;
      const b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
  }
  const len = Math.hypot(dx, dy) * (t1 - t0);
  if (!(len > 0.5)) return null;
  return line(px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1);
}

// The part of a segment inside the box, or null.
function clipSegment(x1, y1, x2, y2, box) {
  const seg = clipToBox(x1, y1, x2 - x1, y2 - y1, { width: box.width, height: box.height }, 0, 1);
  return seg;
}

// Isometric: verticals plus lines at 30° and 150°, triangles of side `side`.
function isometric(marks, box, side) {
  const colGap = side * Math.cos(Math.PI / 6);
  for (let x = colGap; x < box.width - 0.01; x += colGap) marks.push(line(x, 0, x, box.height));
  const dx = Math.cos(Math.PI / 6);
  const dy = Math.sin(Math.PI / 6);
  // Lines y = ±x·tan30 + c, one every `side` up the left edge, covering the box.
  const reach = box.height + box.width * Math.tan(Math.PI / 6);
  for (let c = -reach; c <= reach; c += side) {
    for (const sign of [1, -1]) {
      const seg = clipToBox(0, c, dx, sign * dy, box);
      if (seg) marks.push(seg);
    }
  }
}

// Flat-topped hexagons of side `a`; each shared edge drawn once.
function hexagons(marks, box, a) {
  const h = Math.sqrt(3) * a;
  const colStep = 1.5 * a;
  const round = (v) => Math.round(v * 100) / 100;
  const seen = new Set();
  const add = (x1, y1, x2, y2) => {
    const k = [round(x1), round(y1), round(x2), round(y2)];
    const key = k[0] < k[2] || (k[0] === k[2] && k[1] < k[3]) ? k.join() : [k[2], k[3], k[0], k[1]].join();
    if (seen.has(key)) return;
    seen.add(key);
    const seg = clipSegment(x1, y1, x2, y2, box);
    if (seg) marks.push(seg);
  };
  for (let col = 0, cx = 0; cx < box.width + a; col += 1, cx += colStep) {
    for (let cy = col % 2 ? h / 2 : 0; cy < box.height + h; cy += h) {
      const pts = [];
      for (let k = 0; k < 6; k += 1) {
        const ang = (Math.PI / 3) * k;
        pts.push([cx + a * Math.cos(ang), cy + a * Math.sin(ang)]);
      }
      for (let k = 0; k < 6; k += 1) {
        const [x1, y1] = pts[k];
        const [x2, y2] = pts[(k + 1) % 6];
        add(x1, y1, x2, y2);
      }
    }
  }
}

// Music systems: groups of `lines` staff lines `gap` apart, `count` systems
// spread down the page between the margins. `pair` draws grand staves (two
// staves joined by a line at the left).
function staves(marks, box, { lines, gap, pair = false }) {
  const side = Math.max(36, box.width * 0.07);
  const top = box.height - Math.max(54, box.height * 0.08);
  const bottom = Math.max(54, box.height * 0.08);
  const staffH = gap * (lines - 1);
  const unitH = pair ? staffH * 2 + gap * 6 : staffH;
  const minSpace = pair ? gap * 8 : gap * 6;
  const count = Math.max(1, Math.floor((top - bottom + minSpace) / (unitH + minSpace)));
  const space = count > 1 ? (top - bottom - count * unitH) / (count - 1) : 0;
  for (let n = 0; n < count; n += 1) {
    const unitTop = top - n * (unitH + space);
    const staffTops = pair ? [unitTop, unitTop - staffH - gap * 6] : [unitTop];
    for (const st of staffTops) {
      for (let i = 0; i < lines; i += 1) marks.push(line(side, st - i * gap, box.width - side, st - i * gap, 'ink'));
      marks.push(line(side, st, side, st - staffH, 'ink'));
      marks.push(line(box.width - side, st, box.width - side, st - staffH, 'ink'));
    }
    if (pair) marks.push(line(side, unitTop, side, staffTops[1] - staffH, 'ink'));
  }
}

/**
 * Marks for a template on one page box. `metric` picks 5 mm spacing for the
 * ruled papers' margins where it matters; the graph papers keep their named
 * sizes. Unknown ids give no marks (a blank page).
 */
export function templateMarks(id, box, metric = false) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return [];
  const marks = [];
  const big = Math.min(box.width, box.height) > 1000 ? 2 : 1;
  const rule = (9 / 32) * IN * big; // college ruled
  const topMargin = IN * big;
  switch (id) {
    case 'notebook': {
      ruled(marks, { x1: 0, x2: box.width, top: box.height - topMargin, bottom: rule, gap: rule });
      const mx = 1.25 * IN * big;
      marks.push(line(mx, 0, mx, box.height, 'margin'));
      break;
    }
    case 'gregg': {
      ruled(marks, { x1: 0, x2: box.width, top: box.height - topMargin, bottom: rule, gap: (1 / 3) * IN * big });
      marks.push(line(box.width / 2, 0, box.width / 2, box.height - topMargin, 'margin'));
      break;
    }
    case 'pitman': {
      const gap = 0.3 * IN * big;
      ruled(marks, { x1: 0, x2: box.width, top: box.height - topMargin, bottom: gap, gap });
      const mx = IN * big;
      marks.push(line(mx, 0, mx, box.height, 'margin'));
      marks.push(line((box.width + mx) / 2, 0, (box.width + mx) / 2, box.height - topMargin, 'margin'));
      break;
    }
    case 'cornell': {
      const summary = 2 * IN * big;
      const cue = 2.5 * IN * big;
      const header = box.height - topMargin;
      ruled(marks, { x1: 0, x2: box.width, top: header - rule, bottom: summary + rule, gap: rule });
      marks.push(line(0, header, box.width, header, 'major'));
      marks.push(line(0, summary, box.width, summary, 'major'));
      marks.push(line(cue, summary, cue, header, 'margin'));
      break;
    }
    case 'engineering':
      grid(marks, box, (IN / 5) * big, 5);
      break;
    case 'graph-quarter-in':
      grid(marks, box, IN / 4);
      break;
    case 'graph-eighth-in':
      grid(marks, box, IN / 8, 8);
      break;
    case 'graph-1cm':
      grid(marks, box, 10 * MM);
      break;
    case 'graph-half-cm':
      grid(marks, box, 5 * MM, 2);
      break;
    case 'graph-1mm':
      grid(marks, box, MM, 10);
      break;
    case 'isometric':
      isometric(marks, box, (metric ? 5 * MM : IN / 4) * big);
      break;
    case 'hex':
      hexagons(marks, box, (metric ? 5 * MM : IN / 4) * big);
      break;
    case 'stave':
      staves(marks, box, { lines: 5, gap: 7 * big });
      break;
    case 'tab':
      staves(marks, box, { lines: 6, gap: 8 * big });
      break;
    case 'double-stave':
      staves(marks, box, { lines: 5, gap: 7 * big, pair: true });
      break;
    default:
      break;
  }
  return marks;
}

/** One SVG path per tone for a preview drawn with viewBox = the page box
 *  (y flipped to the screen's top-down). */
export function templatePreviewPaths(id, box, metric = false) {
  const paths = {};
  const f = (v) => Math.round(v * 10) / 10;
  for (const m of templateMarks(id, box, metric)) {
    if (m.kind !== 'line') continue;
    const d = `M${f(m.x1)} ${f(box.height - m.y1)}L${f(m.x2)} ${f(box.height - m.y2)}`;
    paths[m.tone] = (paths[m.tone] || '') + d;
  }
  return paths;
}
