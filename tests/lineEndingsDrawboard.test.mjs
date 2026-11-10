// Nightly 'line-endings': Drawboard's ten heads at its measured sizes
// (endings-and-pens.md, pdf.drawboard.com 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARROWHEAD_STYLES,
  LINE_ENDING_SET_DRAWBOARD,
  arrowheadShapePathD,
  buildArrowheadRenderSpec,
  buildLineRenderSpec,
  lineEndingBodyInset,
  resolveLineEndingStyles,
} from '../src/utils/lineRenderHelpers.js';
import { LINE_ENDING_GRID_ORDER, LINE_ENDING_NAMES } from '../src/components/Callout/types.js';
import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { LINE_ENDING_DEFAULTS, lineEndingCreateOptions, parsePickedLineEnds, pickedLineEndsKey } from '../src/utils/lineEndingDefaults.js';
import { setLineEndingOn } from '../src/utils/selectionProperties.js';
import { arrowheadBounds } from '../src/utils/arrowheadEdge.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const geometry = LINE_ENDING_SET_DRAWBOARD;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test("the grid is Drawboard's ten heads in its order, each named", () => {
  assert.deepEqual(LINE_ENDING_GRID_ORDER.map((s) => LINE_ENDING_NAMES[s]), [
    'None', 'Slash', 'Square', 'Open arrow', 'Reverse open arrow',
    'Circle', 'Closed arrow', 'Reverse closed arrow', 'Diamond', 'Butt',
  ]);
});

test('open arrow: arms 8w at 30 degrees each side, tip on the end, any width (2 pt -> 16, 6 pt -> 48)', () => {
  for (const w of [2, 6]) {
    const spec = buildArrowheadRenderSpec(ARROWHEAD_STYLES.V_SHAPE, 100, 50, 0, '#f00', w, { geometry });
    assert.equal(spec.kind, 'shapes');
    const [arm1, tip, arm2] = spec.shapes[0].points;
    assert.deepEqual(tip, { x: 100, y: 50 });
    assert.ok(near(dist(arm1, tip), 8 * w) && near(dist(arm2, tip), 8 * w));
    assert.ok(near(Math.abs(Math.atan2(arm1.y - 50, 100 - arm1.x)) * 180 / Math.PI, 30));
    const shape = spec.shapes[0];
    assert.equal(shape.fill, 'none');
    assert.equal(shape.stroke, '#f00');
    assert.equal(shape.strokeWidth, w);
    assert.equal(shape.strokeLinejoin, 'miter');
    assert.equal(shape.strokeLinecap, 'butt');
    assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.V_SHAPE, w, geometry), 0, 'the line runs to the tip');
  }
});

test('closed arrow 6.2w x 7.2w filled in the line colour; reverse closed 4.85w x 5.6w', () => {
  const w = 3;
  const closed = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 0, 0, 0, '#123456', w, { geometry }).shapes[0];
  assert.equal(closed.fill, '#123456');
  assert.equal(closed.stroke, 'none');
  const xs = closed.points.map((p) => p.x);
  const ys = closed.points.map((p) => p.y);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 6.2 * w));
  assert.ok(near(Math.max(...ys) - Math.min(...ys), 7.2 * w));
  assert.ok(near(Math.max(...xs), 0), 'tip on the end');
  assert.ok(near(lineEndingBodyInset(ARROWHEAD_STYLES.SOLID_TRIANGLE, w, geometry), 6.2 * w), 'line stops at its back edge');
  const rev = buildArrowheadRenderSpec(ARROWHEAD_STYLES.R_CLOSED_ARROW, 0, 0, 0, '#123456', w, { geometry }).shapes[0];
  const rx = rev.points.map((p) => p.x);
  const ry = rev.points.map((p) => p.y);
  assert.ok(near(Math.max(...rx) - Math.min(...rx), 4.85 * w));
  assert.ok(near(Math.max(...ry) - Math.min(...ry), 5.6 * w));
  assert.ok(near(Math.min(...rx), -4.85 * w), 'it points back into the line');
});

test('slash, square, circle, diamond, butt and reverse open match the measured sizes', () => {
  const w = 2;
  const one = (style) => buildArrowheadRenderSpec(style, 0, 0, 0, '#000', w, { geometry }).shapes[0];
  const slash = one(ARROWHEAD_STYLES.SLASH);
  assert.ok(near(dist(slash.points[0], slash.points[1]), 11.4 * w));
  const tilt = Math.abs(Math.atan2(slash.points[0].y - slash.points[1].y, slash.points[0].x - slash.points[1].x)) * 180 / Math.PI;
  assert.ok(near(Math.min(tilt, 180 - tilt), 51, 1e-6), `slash is 51 degrees off the line, got ${tilt}`);
  const square = one(ARROWHEAD_STYLES.SQUARE);
  assert.ok(near(Math.max(...square.points.map((p) => p.x)), 0) && near(Math.min(...square.points.map((p) => p.x)), -4 * w));
  const circle = one(ARROWHEAD_STYLES.OPEN_CIRCLE);
  assert.ok(near(circle.r * 2, 4.4 * w) && near(circle.cx + circle.r, 0), 'touches the end');
  const diamond = one(ARROWHEAD_STYLES.DIAMOND);
  assert.ok(near(Math.min(...diamond.points.map((p) => p.x)), -5.3 * w));
  const butt = one(ARROWHEAD_STYLES.HORIZONTAL_LINE);
  assert.ok(near(dist(butt.points[0], butt.points[1]), 8 * w));
  const ropen = one(ARROWHEAD_STYLES.R_OPEN_ARROW);
  assert.ok(near(dist(ropen.points[0], ropen.points[1]), 5.6 * w));
  assert.ok(ropen.points[1].x < 0, 'its point sits back inside the line');
  for (const s of [ARROWHEAD_STYLES.SQUARE, ARROWHEAD_STYLES.OPEN_CIRCLE, ARROWHEAD_STYLES.DIAMOND]) {
    assert.equal(one(s).fill, 'none', `${s} is an outline`);
  }
  assert.equal(buildArrowheadRenderSpec('none', 0, 0, 0, '#000', w, { geometry }).kind, 'none');
});

test('heads turn with the line and every grid head builds and fits its bounds', () => {
  for (const style of LINE_ENDING_GRID_ORDER) {
    const spec = buildArrowheadRenderSpec(style, 200, 200, 90, '#000', 2, { geometry });
    if (style === 'none') { assert.equal(spec.kind, 'none'); continue; }
    assert.equal(spec.kind, 'shapes', style);
    const box = arrowheadBounds(style, 200, 200, 90, 2, geometry);
    assert.ok(box && box.maxY <= 200 + 6.5 * 2 + 1e-6, `${style} reaches at most 6.5w past the end`);
    for (const shape of spec.shapes) if (shape.type === 'path') assert.match(arrowheadShapePathD(shape), /^M /);
  }
});

test('older marks keep their look; the marker switches a mark to Drawboard sizes', () => {
  const base = { type: 'Line', left: 0, top: 0, width: 100, height: 0, x1: -50, y1: 0, x2: 50, y2: 0, stroke: '#000', strokeWidth: 2, tool: 'arrow' };
  const classic = buildLineRenderSpec(base);
  assert.equal(classic.arrowhead.kind, 'solidTriangle');
  assert.deepEqual(Object.keys(resolveLineEndingStyles(base)).sort(), ['endStyle', 'interiorColor', 'startStyle']);
  const marked = { ...base, data: { arrowheadStyle: 'vShape', startArrowheadStyle: 'none', lineEndingSet: 'drawboard' } };
  assert.equal(resolveLineEndingStyles(marked).geometry, 'drawboard');
  const spec = buildLineRenderSpec(marked);
  assert.equal(spec.arrowhead.kind, 'shapes');
  assert.equal(spec.line.x2, 100, 'the line runs to the open arrow tip');
  // A reverse head on an unmarked mark takes the classic size.
  const legacyRev = buildArrowheadRenderSpec(ARROWHEAD_STYLES.R_OPEN_ARROW, 0, 0, 0, '#000', 2);
  assert.equal(legacyRev.kind, 'shapes');
  assert.ok(near(dist(legacyRev.shapes[0].points[0], legacyRev.shapes[0].points[1]), 5.6));
});

test('a new Line or Arrow with the Drawboard set stamps both ends and the marker', () => {
  const common = { id: 'a', start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2 };
  const line = buildLineCommitJSON({ ...common, tool: 'line', endingSet: 'drawboard', arrowheadStyle: 'none', arrowStartStyle: 'slash' });
  assert.deepEqual(line.data, { id: 'a', arrowheadStyle: 'none', startArrowheadStyle: 'slash', lineEndingSet: 'drawboard' });
  const arrow = buildLineCommitJSON({ ...common, tool: 'arrow', endingSet: 'drawboard', arrowheadStyle: 'vShape', arrowStartStyle: 'none' });
  assert.equal(arrow.data.arrowheadStyle, 'vShape');
  // Without the set the old rule holds: a line carries no heads.
  assert.deepEqual(buildLineCommitJSON({ ...common, tool: 'line', arrowheadStyle: 'solidTriangle' }).data, { id: 'a' });
});

test("defaults are Drawboard's; with the flag off a new mark is unchanged", () => {
  assert.deepEqual({ ...LINE_ENDING_DEFAULTS.arrow }, { start: 'none', end: 'vShape' });
  assert.deepEqual({ ...LINE_ENDING_DEFAULTS.line }, { start: 'none', end: 'none' });
  assert.deepEqual(lineEndingCreateOptions('arrow'), {});
  assert.equal(pickedLineEndsKey({ type: 'Line' }, 1), null);
  assert.deepEqual(parsePickedLineEnds('slash|vShape|3'), { start: 'slash', end: 'vShape', pageNumber: 3 });
  assert.equal(parsePickedLineEnds(null), null);
});

test('setting one end of a picked line keeps the other and marks it', () => {
  const line = { type: 'Line', data: { id: 'x', arrowheadStyle: 'solidTriangle' } };
  const next = setLineEndingOn(line, 'start', 'diamond');
  assert.deepEqual(next.data, { id: 'x', arrowheadStyle: 'solidTriangle', startArrowheadStyle: 'diamond', lineEndingSet: 'drawboard' });
  assert.equal(setLineEndingOn({ type: 'Rect' }, 'end', 'slash'), null);
});

test('the reverse heads export as their PDF names; a filled one writes /IC', () => {
  const pdf = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(pdf, /\[ARROWHEAD_STYLES\.R_OPEN_ARROW\]: 'ROpenArrow'/);
  assert.match(pdf, /\[ARROWHEAD_STYLES\.R_CLOSED_ARROW\]: 'RClosedArrow'/);
  assert.match(pdf, /style === ARROWHEAD_STYLES\.R_CLOSED_ARROW;/);
  assert.match(pdf, /if \(spec\.kind === 'shapes'\) \{/);
});

test('every surface draws the shapes kind, and the pickers are wired behind the flag', () => {
  assert.equal(FEATURE_FLAGS['line-endings']?.stage, 'beta');
  assert.match(read('src/utils/svgAnnotationRenderers.jsx'), /case 'shapes': return renderArrowheadShapes\(spec\);/);
  assert.match(read('src/utils/annotationCanvasPainter.js'), /if \(spec\.kind === 'shapes'\) \{/);
  assert.match(read('src/utils/lassoObjectAdapter.js'), /if \(spec\.kind === 'shapes'\) \{/);
  assert.match(read('src/components/SVGAnnotationLayer.jsx'), /lineEndingCreateOptions\(tool\)/);
  assert.match(read('src/components/SVGAnnotationLayer.jsx'), /detail\.op === 'ending'/);
  assert.match(read('src/AppShell.jsx'), /<LineEndingsMenu api=\{bottomToolbarApi\}/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /<LineEndingsPanel api=\{api\} tool=\{tool\}/);
  assert.match(read('src/components/SelectionPropertiesPanel.jsx'), /<LineEndingsPanel api=\{api\}/);
  assert.match(read('src/PDFViewer.jsx'), /selectedLineEnds: groupSummary \? null : pickedLineEndsKey\(/);
  assert.match(read('supabase/migrations/20261110149000_line_endings_flag.sql'), /'line-endings', 'off'/);
});
