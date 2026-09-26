// w41 (2026-09-25): restyling marks that are already drawn.
//
// Owner report: "I'm not able to change the color of a pen stroke, and it
// probably applies to all shapes ... Once it's drawn, it's drawn." Since the
// capsule eraser (a3380bbf9, 2026-07-10) a pen / highlighter stroke is a
// FILLED OUTLINE (fill = ink colour, stroke 'transparent', width baked into
// the outline), and the bar kept writing `stroke` / `strokeWidth`, which that
// shape ignores. A multi-selection never had formatting at all.
// Standard held here (Drawboard / Bluebeam / Acrobat): the bar restyles the
// selection - every picked mark takes the properties it has, a mixed pick
// shows mixed values, each change (a whole slider drag included) is ONE undo
// step, and the tool's defaults are untouched while marks are picked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  applyRestyleChange,
  applyRestyleChangeToPage,
  calloutRestylePatch,
  canRebuildInkWidth,
  colorToHex,
  colorToOpacity,
  isFilledInkPath,
  readCalloutRestyleStyle,
  readRestyleStyle,
  rebuildInkAtWidth,
  resolvePickedMembers,
  restyleCapabilities,
  summarizeSelectionRestyle,
} from '../src/utils/selectionRestyle.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  buildBoundaryShapeCommitJSON,
  buildLineCommitJSON,
  buildPolyShapeCommitJSON,
} from '../src/utils/annotationCreationCommit.js';
import { renderPathToSvgAttrs } from '../src/utils/svgPathAttrs.js';
import { boundsOfCommands } from '../src/utils/paperAnnotationGeometry.js';
import { applyPageAffineToInkObject } from '../src/utils/inkGeometryTransform.js';
import { resolveMarqueeHits } from '../src/utils/marqueeSelection.js';
import { createCloud, openFor, until } from './helpers/liveSyncFakeCloud.mjs';
import { createHistoryScreen } from './helpers/historyTimelineHarness.mjs';
import {
  planGroupUpdate,
  resolveGroupPaintWrite,
  resolveGroupWrite,
} from '../src/utils/selectionRestyle.js';
import {
  applyCalloutListToByPage,
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import { buildTextMarkupDocumentAction } from '../src/utils/textMarkupGroupTransactions.js';

const WAVE = Array.from({ length: 24 }, (_, i) => ({ x: 100 + i * 8, y: 200 + Math.sin(i / 3) * 25 }));

const pen = (id = 'pen-1', overrides = {}) => ({
  ...createProductionPaperInk({ id, tool: 'pen', points: WAVE, color: '#ff0000', width: 3, data: { id } }),
  ...overrides,
});
const highlighter = (id = 'hl-1') => createProductionPaperInk({
  id, tool: 'highlighter', points: WAVE, color: 'rgba(255, 193, 7, 0.3)', width: 12, data: { id },
});
const rect = (id = 'rect-1') => buildBoundaryShapeCommitJSON({
  tool: 'rect', id, start: { x: 50, y: 300 }, end: { x: 150, y: 360 },
  strokeColor: '#1e293b', strokeOpacity: 100, fillColor: '#ffffff', fillOpacity: 0,
  strokeWidth: 2, lineBorderStyle: 'solid', cloudIntensity: 2,
});
const ellipse = (id = 'ell-1') => buildBoundaryShapeCommitJSON({
  tool: 'ellipse', id, start: { x: 200, y: 300 }, end: { x: 300, y: 360 },
  strokeColor: '#ff0000', strokeOpacity: 100, fillColor: '#ffffff', fillOpacity: 0,
  strokeWidth: 2, lineBorderStyle: 'solid', cloudIntensity: 2,
});
const line = (id = 'line-1', tool = 'line') => buildLineCommitJSON({
  tool, id, start: { x: 92, y: 413 }, end: { x: 215, y: 447 },
  strokeColor: '#ff0000', strokeOpacity: 100, strokeWidth: 2,
  arrowheadStyle: 'solidTriangle', lineBorderStyle: 'solid',
});
const poly = (tool, id) => buildPolyShapeCommitJSON({
  tool, id,
  points: [{ x: 300, y: 400 }, { x: 360, y: 400 }, { x: 330, y: 450 }],
  strokeColor: '#2563eb', strokeOpacity: 100, fillColor: '#ffffff', fillOpacity: 0,
  strokeWidth: 2, lineBorderStyle: 'solid', cloudIntensity: 2,
});
const textbox = (id = 'tb-1') => ({
  type: 'textbox', left: 140, top: 220, width: 140, height: 20, text: 'Note',
  fontSize: 14, fontFamily: 'Helvetica', fill: '#000000', stroke: '#1e293b', strokeWidth: 1,
  backgroundColor: 'transparent', data: { id },
});
const counter = (id = 'c-1') => ({
  type: 'circle', left: 320, top: 240, radius: 12, fill: '#fde68a',
  data: { id, type: 'counter', seriesId: 's1', displayNumber: 1 },
});
const stamp = (id = 'st-1') => ({
  type: 'image', left: 400, top: 240, width: 60, height: 30, data: { id, type: 'stamp' },
});
const callout = (id = 'co-1', style = {}) => ({
  id, pageNumber: 1, text: 'Check',
  style: { borderColor: '#1e293b', borderOpacity: 1, fillColor: '#ffffff', fillOpacity: 0.4, lineThickness: 2, ...style },
});

test('colour helpers read hex, rgb and rgba', () => {
  assert.equal(colorToHex('rgba(0, 0, 255, 0.5)'), '#0000ff');
  assert.equal(colorToHex('#ABC'), '#aabbcc');
  assert.equal(colorToHex('transparent'), null);
  assert.equal(colorToOpacity('rgba(0, 0, 255, 0.5)'), 50);
  assert.equal(colorToOpacity('#ff0000'), 100);
});

test('regression: a pen stroke is a filled outline, so its colour goes to FILL (the bar used to write stroke)', () => {
  const ink = pen();
  assert.equal(isFilledInkPath(ink), true);
  assert.equal(renderPathToSvgAttrs(ink).fill, '#ff0000');
  const next = applyRestyleChange(ink, { kind: 'strokeColor', color: '#0000ff' });
  assert.equal(next.fill, 'rgba(0, 0, 255, 1)');
  assert.equal(next.stroke, 'transparent', 'the unpainted stroke stays unpainted');
  assert.equal(renderPathToSvgAttrs(next).fill, 'rgba(0, 0, 255, 1)', 'the renderer shows the new colour');
  const half = applyRestyleChange(next, { kind: 'strokeOpacity', opacity: 40 });
  assert.equal(half.fill, 'rgba(0, 0, 255, 0.4)');
  assert.deepEqual(readRestyleStyle(half), {
    strokeColor: '#0000ff', strokeOpacity: 40, fillColor: null, fillOpacity: null,
    width: 3, lineStyle: null, cloudIntensity: null, arrowheadStyle: null,
  });
});

test('a pen width change rebuilds the outline from its centreline, in place', () => {
  const ink = pen();
  const wide = applyRestyleChange(ink, { kind: 'width', width: 9 });
  assert.equal(wide.sourceWidth, 9);
  assert.deepEqual(wide.paperCenterline, ink.paperCenterline, 'the centreline is kept');
  const oldBox = boundsOfCommands(ink.path);
  const newBox = boundsOfCommands(wide.path);
  // Grows by the half-width difference on every side around the SAME
  // centreline (the outline's round caps are polygons, so its box centre
  // moves by a few hundredths of a point at most).
  assert.ok(Math.abs((oldBox.x + oldBox.w / 2) - (newBox.x + newBox.w / 2)) < 0.05);
  assert.ok(Math.abs((oldBox.y + oldBox.h / 2) - (newBox.y + newBox.h / 2)) < 0.05);
  assert.ok(Math.abs((newBox.w - oldBox.w) - 6) < 0.05);
  assert.equal(readRestyleStyle(wide).width, 9);
  assert.equal(applyRestyleChange(wide, { kind: 'width', width: 9 }), null, 'no change, no write');
});

test('a moved (centre-origin) pen stroke keeps its place when widened; a resized one is set in drawn units', () => {
  const moved = applyPageAffineToInkObject(pen(), [1, 0, 0, 1, 40, 25]);
  assert.equal(canRebuildInkWidth(moved), true);
  const wide = rebuildInkAtWidth(moved, 7);
  assert.deepEqual(wide.pathOffset, moved.pathOffset);
  assert.equal(wide.left, moved.left);
  assert.equal(wide.top, moved.top);
  const scaled = { ...moved, scaleX: 2, scaleY: 2 };
  assert.equal(readRestyleStyle(scaled).width, 6, 'a 3-wide stroke drawn at 2x reads 6');
  assert.equal(rebuildInkAtWidth(scaled, 8).sourceWidth, 4);
});

test('a partly erased or imported pen outline keeps its colour controls but has no rebuildable width', () => {
  const erased = pen('pen-e', { paperEraserGeometry: 'v1', paperSourceStroke: { path: [], matrix: [1, 0, 0, 1, 0, 0] } });
  assert.deepEqual(restyleCapabilities(erased), {
    stroke: true, fill: false, width: false, lineStyle: false, cloud: false, arrowheads: false,
  });
  assert.equal(applyRestyleChange(erased, { kind: 'width', width: 8 }), null);
  assert.equal(applyRestyleChange(erased, { kind: 'strokeColor', color: '#000000' }).fill, 'rgba(0, 0, 0, 1)');
  const imported = { ...pen('pen-i'), paperCenterline: undefined, isPdfImported: true };
  assert.equal(restyleCapabilities(imported).width, false);
});

test('a highlighter keeps its see-through strength when recoloured and never goes under 8 wide', () => {
  const hl = highlighter();
  assert.equal(readRestyleStyle(hl).strokeOpacity, 30);
  assert.equal(applyRestyleChange(hl, { kind: 'strokeColor', color: '#22c55e' }).fill, 'rgba(34, 197, 94, 0.3)');
  assert.equal(applyRestyleChange(hl, { kind: 'width', width: 2 }).sourceWidth, 8);
});

test('what each mark type can change', () => {
  const caps = (annotation) => Object.entries(restyleCapabilities(annotation))
    .filter(([, on]) => on).map(([key]) => key).join(',');
  assert.equal(caps(pen()), 'stroke,width');
  assert.equal(caps(rect()), 'stroke,fill,width,lineStyle,cloud');
  assert.equal(caps(ellipse()), 'stroke,fill,width,lineStyle,cloud');
  assert.equal(caps(poly('polygon', 'pg')), 'stroke,fill,width,lineStyle,cloud');
  assert.equal(caps(poly('polyline', 'pl')), 'stroke,width,lineStyle,cloud');
  assert.equal(caps(line()), 'stroke,width,lineStyle');
  assert.equal(caps(line('ar', 'arrow')), 'stroke,width,lineStyle,arrowheads');
  assert.equal(caps(textbox()), 'stroke,fill,width,lineStyle');
  assert.equal(caps(counter()), '', 'a counter pin is restyled through its series');
  assert.equal(caps(stamp()), '', 'a stamp is a locked picture');
});

test('shape changes: border, fill, width, dashed, cloud, arrow ends', () => {
  const r = rect();
  assert.equal(applyRestyleChange(r, { kind: 'strokeColor', color: '#ff0000' }).stroke, 'rgba(255, 0, 0, 1)');
  // A transparent fill picked a colour turns on (or the pick would be invisible).
  assert.equal(applyRestyleChange(r, { kind: 'fillColor', color: '#22c55e' }).fill, 'rgba(34, 197, 94, 1)');
  assert.equal(applyRestyleChange(r, { kind: 'width', width: 5 }).strokeWidth, 5);
  assert.deepEqual(applyRestyleChange(r, { kind: 'lineStyle', style: 'dashed' }).strokeDashArray, [6, 4]);
  const cloudy = applyRestyleChange(r, { kind: 'lineStyle', style: 'cloud', cloudIntensity: 3 });
  assert.equal(cloudy.data.pdfCloudIntensity, 3);
  assert.equal(readRestyleStyle(cloudy).lineStyle, 'cloud');
  assert.equal(applyRestyleChange(cloudy, { kind: 'cloudIntensity', cloudIntensity: 5 }).data.pdfCloudIntensity, 5);
  assert.equal(applyRestyleChange(line(), { kind: 'lineStyle', style: 'cloud' }), null, 'a straight line never clouds');
  const tb = applyRestyleChange(textbox(), { kind: 'fillColor', color: '#fde68a' });
  assert.equal(tb.backgroundColor, 'rgba(253, 230, 138, 1)', 'a text box fill is its background');
  const arrow = applyRestyleChange(line('ar', 'arrow'), { kind: 'arrowhead', style: 'openCircle', bothEnds: true });
  assert.equal(arrow.data.arrowheadStyle, 'openCircle');
  assert.equal(arrow.data.startArrowheadStyle, 'openCircle');
  assert.equal(applyRestyleChange(line(), { kind: 'arrowhead', style: 'openCircle' }), null, 'a plain line has no ends');
  assert.equal(applyRestyleChange(pen(), { kind: 'fillColor', color: '#000000' }), null, 'a pen stroke has no fill');
});

test('callouts take the same changes as style patches', () => {
  const c = callout();
  assert.deepEqual(calloutRestylePatch(c, { kind: 'strokeColor', color: '#ff0000' }), { borderColor: '#ff0000' });
  assert.deepEqual(calloutRestylePatch(c, { kind: 'strokeOpacity', opacity: 50 }), { borderOpacity: 0.5 });
  assert.deepEqual(calloutRestylePatch(c, { kind: 'width', width: 4 }), { lineThickness: 4 });
  assert.deepEqual(calloutRestylePatch(c, { kind: 'lineStyle', style: 'dotted' }), { lineStyle: 'dotted' });
  assert.equal(calloutRestylePatch(c, { kind: 'lineStyle', style: 'cloud' }), null);
  assert.equal(calloutRestylePatch(c, { kind: 'width', width: 2 }), null, 'no change, no write');
  assert.equal(readCalloutRestyleStyle(c).fillOpacity, 40);
});

test('a mixed pick: the bar layout, the union of controls, and which values disagree', () => {
  const summary = summarizeSelectionRestyle([
    { kind: 'annotation', annotation: pen() },
    { kind: 'annotation', annotation: rect() },
    { kind: 'annotation', annotation: line() },
    { kind: 'callout', callout: callout() },
  ]);
  assert.equal(summary.contextTool, 'rect', 'a fill-capable member shows the Fill / Border swatch');
  assert.deepEqual(summary.capabilities, {
    stroke: true, fill: true, width: true, lineStyle: true, cloud: true, arrowheads: true,
  });
  assert.equal(summary.values.strokeColor, '#ff0000', 'the first picked mark leads');
  assert.equal(summary.mixed.strokeColor, true);
  assert.equal(summary.mixed.width, true);
  const pens = summarizeSelectionRestyle([
    { kind: 'annotation', annotation: pen('a') },
    { kind: 'annotation', annotation: pen('b') },
  ]);
  assert.equal(pens.contextTool, 'pen');
  assert.equal(pens.mixed.strokeColor, false);
  assert.equal(summarizeSelectionRestyle([{ kind: 'annotation', annotation: pen() }]), null, 'one mark is not a group');
  const withCounter = summarizeSelectionRestyle([
    { kind: 'annotation', annotation: pen() },
    { kind: 'annotation', annotation: counter() },
  ]);
  assert.equal(withCounter.count, 1, 'a counter picked with a stroke still lets the stroke be restyled');
});

test('a group change lands on every picked mark that has the property, and nowhere else', () => {
  const page = { objects: [pen(), rect(), line(), counter(), ellipse()] };
  const members = resolvePickedMembers(page.objects, [0, 1, 2, 3], ['pen-1', 'rect-1', 'line-1', 'c-1']);
  assert.deepEqual(members.map(({ index }) => index), [0, 1, 2, 3]);
  const next = applyRestyleChangeToPage(page, members, { kind: 'strokeColor', color: '#000000' });
  assert.equal(next.objects[0].fill, 'rgba(0, 0, 0, 1)');
  assert.equal(next.objects[1].stroke, 'rgba(0, 0, 0, 1)');
  assert.equal(next.objects[2].stroke, 'rgba(0, 0, 0, 1)');
  assert.equal(next.objects[3], page.objects[3], 'the counter is untouched');
  assert.equal(next.objects[4], page.objects[4], 'the unpicked ellipse is untouched');
  const fill = applyRestyleChangeToPage(page, members, { kind: 'fillColor', color: '#22c55e' });
  assert.equal(fill.objects[0], page.objects[0], 'a pen stroke has no fill to change');
  assert.equal(fill.objects[1].fill, 'rgba(34, 197, 94, 1)');
  assert.equal(applyRestyleChangeToPage(fill, members, { kind: 'fillColor', color: '#22c55e' }), null, 'repeat = no write');
});

test('a mixed group keeps each mark\'s own opacity when only the colour changes', () => {
  const see = { ...rect('r-see'), stroke: 'rgba(30, 41, 59, 0.5)' };
  const page = { objects: [see, rect('r-full')] };
  const members = page.objects.map((annotation, index) => ({ index, annotation }));
  const next = applyRestyleChangeToPage(page, members, { kind: 'strokeColor', color: '#ff0000' });
  assert.equal(next.objects[0].stroke, 'rgba(255, 0, 0, 0.5)');
  assert.equal(next.objects[1].stroke, 'rgba(255, 0, 0, 1)');
});

test('picked marks are found by id: a remote insert or delete can never retarget the change', () => {
  const objects = [pen('a'), rect('b'), line('c')];
  const pick = resolvePickedMembers(objects, [0, 2], ['a', 'c']);
  const shifted = [rect('new'), ...objects];
  assert.deepEqual(resolvePickedMembers(shifted, [0, 2], ['a', 'c']).map(({ index }) => index), [1, 3]);
  const gone = objects.filter((o) => o.data.id !== 'c');
  assert.deepEqual(resolvePickedMembers(gone, [0, 2], ['a', 'c']).map(({ index }) => index), [0]);
  assert.equal(pick.length, 2);
  // An id-less pick only matches an id-less mark still at its index.
  const bare = [{ type: 'rect', stroke: '#000' }, { type: 'rect', stroke: '#111', data: { id: 'z' } }];
  assert.deepEqual(resolvePickedMembers(bare, [0, 1], ['', '']).map(({ index }) => index), [0]);
});

test('window marquee picks a plain line drawn snugly inside it (the line bounds were shifted by half its size)', () => {
  const objects = [line()];
  const hits = (left, right) => resolveMarqueeHits({
    marqueeRect: { left, top: 380, right, bottom: 480 },
    direction: 'window', annotations: { objects }, callouts: [], pageWidth: 612, pageHeight: 792, pageNumber: 1,
  }).annotationIndices;
  assert.deepEqual(hits(50, 260), [0], 'the whole line is inside');
  assert.deepEqual(hits(95, 260), [], 'the line pokes out on the left');
  assert.deepEqual(hits(80, 214), [], 'the line pokes out on the right');
});

// ---- undo: one step per change -------------------------------------------------

async function openScreen(name) {
  const cloud = createCloud(name);
  const handle = await openFor(cloud.makeClient('user-a'), name);
  assert.ok(await until(() => handle.isRealtimeReady()));
  return { screen: createHistoryScreen(handle, 'user-a'), close: () => handle.destroy() };
}

const mine = (object) => ({ ...object, meta: { authorId: 'user-a' } });
const restyleAll = (change) => (objects) => {
  const members = objects.map((annotation, index) => ({ index, annotation }));
  return applyRestyleChangeToPage({ objects }, members, change)?.objects || objects;
};

test('undo: each group change (colour, width, dash, fill) is one step, and walks back and forth exactly', async () => {
  const { screen, close } = await openScreen('w41-group-restyle');
  try {
    const states = [];
    screen.save(1, () => [pen('p1'), rect('r1'), line('l1'), ellipse('e1')].map(mine));
    states.push(screen.signature());
    for (const change of [
      { kind: 'strokeColor', color: '#000000' },
      { kind: 'width', width: 5 },
      { kind: 'lineStyle', style: 'dashed' },
      { kind: 'fillColor', color: '#fde68a' },
    ]) {
      screen.save(1, restyleAll(change));
      states.push(screen.signature());
    }
    assert.equal(screen.depths().localUndo, 5, 'the create + four restyles');
    for (let index = states.length - 1; index > 0; index -= 1) {
      assert.equal(screen.undo(), 'applied');
      assert.deepEqual(screen.signature(), states[index - 1], `undo of change ${index}`);
    }
    for (let index = 1; index < states.length; index += 1) {
      assert.equal(screen.redo(), 'applied');
      assert.deepEqual(screen.signature(), states[index], `redo of change ${index}`);
    }
  } finally {
    await close();
  }
});

test('undo: a whole opacity-slider drag across a group is ONE step back to where it started', async () => {
  const { screen, close } = await openScreen('w41-group-drag');
  try {
    screen.save(1, () => [pen('p1'), rect('r1')].map(mine));
    const before = screen.signature();
    screen.gesture(1, [80, 60, 40, 25].map((opacity) => restyleAll({ kind: 'strokeOpacity', opacity })));
    assert.equal(screen.depths().localUndo, 2, 'the create + ONE drag step');
    const pen1 = screen.mark('p1');
    assert.equal(pen1.fill, 'rgba(255, 0, 0, 0.25)');
    assert.equal(screen.undo(), 'applied');
    assert.deepEqual(screen.signature(), before);
  } finally {
    await close();
  }
});

test('undo: a single pen stroke recolour and width change are one step each', async () => {
  const { screen, close } = await openScreen('w41-pen-single');
  try {
    screen.save(1, () => [pen('p1')].map(mine));
    const states = [screen.signature()];
    screen.save(1, (objects) => objects.map((o) => applyRestyleChange(o, { kind: 'strokeColor', color: '#0000ff' }) || o));
    states.push(screen.signature());
    screen.save(1, (objects) => objects.map((o) => applyRestyleChange(o, { kind: 'width', width: 8 }) || o));
    states.push(screen.signature());
    assert.equal(screen.undo(), 'applied');
    assert.deepEqual(screen.signature(), states[1]);
    assert.equal(screen.undo(), 'applied');
    assert.deepEqual(screen.signature(), states[0]);
  } finally {
    await close();
  }
});

// ---- wiring --------------------------------------------------------------------

test('PDFViewer: a picked pen stroke writes its FILL, and every bar handler tries the group first under Select', () => {
  const source = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(source, /isFilledInkPath\(annotation\)\) \{[\s\S]{0,400}handlePatchSelectedAnnotation\(\{ fill: rgba \}\)/);
  for (const kind of ['strokeColor', 'strokeOpacity', 'fillColor', 'fillOpacity']) {
    assert.match(source, new RegExp(`writeGroupPaint\\('${kind}'`), `${kind} reaches the group`);
  }
  for (const kind of ['width', 'lineStyle', 'cloudIntensity', 'arrowhead', 'arrowBothEnds']) {
    assert.match(source, new RegExp(`applyRestyleToGroup\\(\\{\\s*kind: '${kind}'`), `${kind} reaches the group`);
  }
  // The tool's defaults are only written when a drawing tool is armed.
  assert.match(source, /if \(pdfId && activeTool !== 'select' && paintPhaseRef\.current !== 'preview'\) updateToolPreference\(paintPreferenceKey\(activeTool\), \{ strokeColor: color \}\);/);
  // A drag's release always reaches the save path (its one undo step), and
  // the viewer writes through the same pure planner the tests below drive.
  assert.match(source, /release: phase === 'commit',/);
  assert.match(source, /const write = resolveGroupWrite\(\{/);
  assert.match(source, /resolveGroupPaintWrite\(kind, value, previous, paintPhaseRef\.current\)/);
  // Review 2026-09-25: a pick only makes a group under Select, and the bar
  // reloads the group's values only when the pick or its values change.
  assert.match(source, /const restyleGroup = useMemo\(\(\) => \{[\s\S]{0,400}if \(activeTool !== 'select'\) return null;/);
  assert.match(source, /\}, \[restyleGroupLoadKey\]\);/);
  // An empty Width over a mixed pick changes nothing.
  assert.match(source, /if \(rawValue === '' && activeTool === 'select' && restyleGroupRef\.current\?\.summary\?\.mixed\?\.width\) return;/);
  // A group arrowhead change keeps each arrow's own ends.
  assert.match(source, /kind: 'arrowhead',[\s\S]{0,200}bothEnds: 'keep',/);
  // The whole pick reaches the viewer.
  const layer = fs.readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /annotationIndices/);
});

test('the bar hides what the pick cannot change and shows mixed values (desktop + phone)', () => {
  const shell = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /selectionCapabilities\?\.width !== false/);
  assert.match(shell, /mixed=\{bottomToolbarApi\.activeTool !== 'eraser' && !!bottomToolbarApi\.selectionMixed\?\.width\}/);
  assert.match(shell, /triggerContent=\{styleMixed \? 'Mixed' : undefined\}/);
  const phone = fs.readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(phone, /selectionCaps\?\.width !== false/);
  assert.match(phone, /value=\{quickColourShown\}/);
  // A mixed width field shows empty and leaving it untouched changes nothing.
  const size = fs.readFileSync(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');
  assert.match(size, /if \(mixed && !event\.currentTarget\.value\.trim\(\)\) return;/);
});

// ---- the viewer's real group write path (review 2026-09-25) --------------------
// The viewer's applyGroupUpdate is planGroupUpdate -> resolveGroupWrite, then
// page saves or ONE document transaction; its paint handlers go through
// resolveGroupPaintWrite. This driver runs exactly those, against the history
// harness (the same undo stacks the viewer keeps).

const PAGE_SIZE = { width: 612, height: 792 };
// Owned through data.authorId (the callout bridge rebuilds the page object on a
// style change and keeps only what the callout model carries).
const pageCallout = (id, pageNumber, style = {}) => (JSON.parse(JSON.stringify(calloutToAnnotationObject({
  id, pageNumber, authorId: 'user-a',
  arrowTip: { x: 0.5, y: 0.3 }, knee: { x: 0.55, y: 0.33 }, textBoxPosition: { x: 0.6, y: 0.35 },
  textBoxWidth: 0.2, textBoxHeight: 0.04, text: 'Check',
  style: { fontColor: '#000000', fontSize: 14, borderColor: '#1e293b', borderOpacity: 1, lineThickness: 2, ...style },
}, PAGE_SIZE))));

function groupViewer(screen, group) {
  let baseline = new Map();
  const write = (change, phase = null) => {
    const byPage = screen.byPage;
    const plan = planGroupUpdate({
      byPage,
      selection: group.selection || null,
      calloutIds: group.calloutIds || [],
      calloutPageOf: (id) => deriveCalloutsFromByPage(byPage).find((c) => c.id === id)?.pageNumber,
      annotationPage: (pageJSON, members) => applyRestyleChangeToPage(pageJSON, members, change),
      calloutStyle: (callout) => calloutRestylePatch(callout, change),
      deriveCallouts: deriveCalloutsFromByPage,
      applyCalloutList: applyCalloutListToByPage,
      pageSizes: { 1: PAGE_SIZE, 2: PAGE_SIZE },
      release: phase === 'commit',
    });
    const out = resolveGroupWrite({
      byPage, plan, phase, baseline, buildDocumentAction: buildTextMarkupDocumentAction,
    });
    if (out.kind === 'saves') {
      out.saves.forEach(([page, json]) => screen.save(page, () => json.objects));
    } else if (out.kind === 'transaction') {
      screen.transaction(() => ({ action: out.action, nextByPage: out.nextByPage, skipHistory: out.skipHistory }));
    }
    // runWithPaintPhase: a drag's baseline never outlives the drag.
    if (phase !== 'preview' && phase !== 'settle') baseline = new Map();
    return out;
  };
  const paint = (kind, value, previous, phase = null) => {
    const decision = resolveGroupPaintWrite(kind, value, previous, phase);
    if (decision.action === 'skip') return decision;
    if (decision.action === 'release') return write({ kind: 'noop' }, phase);
    return write(decision.change, phase);
  };
  return { write, paint };
}

const bothSignatures = (screen) => ({ 1: screen.signature(1), 2: screen.signature(2) });

test('real path: a group spread over two pages is ONE undo step per change (it used to be one per page)', async () => {
  const { screen, close } = await openScreen('w41-cross-page');
  try {
    screen.save(1, () => [pen('p1'), rect('r1')].map(mine));
    screen.save(2, () => [pageCallout('c2', 2)]);
    const start = bothSignatures(screen);
    const depth = screen.depths().localUndo;
    const viewer = groupViewer(screen, {
      selection: { pageNumber: 1, indices: [0, 1], ids: ['p1', 'r1'] },
      calloutIds: ['c2'],
    });
    viewer.write({ kind: 'strokeColor', color: '#0000ff' });
    assert.equal(screen.depths().localUndo, depth + 1, 'two pages, one step');
    assert.equal(screen.mark('p1', 1).fill, 'rgba(0, 0, 255, 1)');
    assert.equal(deriveCalloutsFromByPage(screen.byPage).find((c) => c.id === 'c2').style.borderColor, '#0000ff');
    assert.equal(screen.undo(), 'applied');
    assert.deepEqual(bothSignatures(screen), start, 'one undo puts both pages back');
    assert.equal(screen.redo(), 'applied');
    assert.equal(screen.mark('p1', 1).fill, 'rgba(0, 0, 255, 1)');
  } finally {
    await close();
  }
});

test('real path: a cross-page opacity drag is ONE step; a drag released where it began is none', async () => {
  const { screen, close } = await openScreen('w41-cross-page-drag');
  try {
    // Stored the way the bar writes paint (rgba), so returning to it is no change.
    screen.save(1, () => [{ ...pen('p1'), fill: 'rgba(255, 0, 0, 1)' }].map(mine));
    screen.save(2, () => [pageCallout('c2', 2)]);
    const start = bothSignatures(screen);
    const depth = screen.depths().localUndo;
    const viewer = groupViewer(screen, {
      selection: { pageNumber: 1, indices: [0], ids: ['p1'] },
      calloutIds: ['c2'],
    });
    let shown = 100;
    for (const opacity of [80, 60, 40]) {
      viewer.paint('strokeOpacity', opacity, shown, 'preview');
      shown = opacity;
    }
    assert.equal(screen.depths().localUndo, depth, 'drag frames record nothing');
    viewer.paint('strokeOpacity', 40, shown, 'commit');
    assert.equal(screen.depths().localUndo, depth + 1, 'the release records one step');
    assert.equal(screen.mark('p1', 1).fill, 'rgba(255, 0, 0, 0.4)');
    assert.equal(screen.undo(), 'applied');
    assert.deepEqual(bothSignatures(screen), start, 'undo goes back to where the drag began');
    // A drag that comes back to where it started records nothing.
    const again = screen.depths().localUndo;
    viewer.paint('strokeOpacity', 50, 100, 'preview');
    viewer.paint('strokeOpacity', 100, 50, 'commit');
    assert.equal(screen.depths().localUndo, again, 'no change, no step');
    assert.deepEqual(bothSignatures(screen), start);
  } finally {
    await close();
  }
});

test('real path: an unchanged release on one page records no step; an unchanged opacity re-send is skipped', async () => {
  const { screen, close } = await openScreen('w41-noop-commit');
  try {
    screen.save(1, () => [pen('p1'), rect('r1')].map(mine));
    const depth = screen.depths().localUndo;
    const viewer = groupViewer(screen, { selection: { pageNumber: 1, indices: [0, 1], ids: ['p1', 'r1'] } });
    assert.deepEqual(viewer.paint('strokeOpacity', 100, 100, null), { action: 'skip' });
    viewer.paint('strokeColor', '#ff0000', '#ff0000', 'commit');
    assert.equal(screen.depths().localUndo, depth, 'a release that changed nothing is no step');
    // A CLICKED colour equal to the one shown still unifies a mixed group.
    assert.equal(resolveGroupPaintWrite('strokeColor', '#ff0000', '#ff0000', null).action, 'apply');
  } finally {
    await close();
  }
});

test('real path: an opacity change keeps each mark\'s own colour (the re-sent shown colour is skipped)', async () => {
  const { screen, close } = await openScreen('w41-mixed-opacity');
  try {
    screen.save(1, () => [pen('p1'), { ...rect('r1'), stroke: '#0000ff' }].map(mine));
    const viewer = groupViewer(screen, { selection: { pageNumber: 1, indices: [0, 1], ids: ['p1', 'r1'] } });
    // The picker sends the shown colour (the first member's) along with the opacity.
    viewer.paint('strokeColor', '#ff0000', '#ff0000', 'settle');
    viewer.paint('strokeOpacity', 50, 100, null);
    assert.equal(screen.mark('p1', 1).fill, 'rgba(255, 0, 0, 0.5)');
    assert.equal(screen.mark('r1', 1).stroke, 'rgba(0, 0, 255, 0.5)', 'the blue border stays blue');
  } finally {
    await close();
  }
});

test('real path: a group arrowhead change keeps each arrow\'s own ends', async () => {
  const { screen, close } = await openScreen('w41-arrow-ends');
  try {
    const both = mine({ ...line('a1', 'arrow'), data: { id: 'a1', tool: 'arrow', arrowheadStyle: 'solidTriangle', startArrowheadStyle: 'solidTriangle' } });
    const endOnly = mine({ ...line('a2', 'arrow'), data: { id: 'a2', tool: 'arrow', arrowheadStyle: 'solidTriangle' } });
    screen.save(1, () => [both, endOnly]);
    const summary = summarizeSelectionRestyle(screen.objects(1).map((annotation) => ({ kind: 'annotation', annotation })));
    assert.equal(summary.mixed.arrowBothEnds, true, 'the bar shows the ends as mixed');
    const depth = screen.depths().localUndo;
    const viewer = groupViewer(screen, { selection: { pageNumber: 1, indices: [0, 1], ids: ['a1', 'a2'] } });
    viewer.write({ kind: 'arrowhead', style: 'openCircle', bothEnds: 'keep' });
    assert.equal(screen.depths().localUndo, depth + 1);
    assert.equal(screen.mark('a1').data.startArrowheadStyle, 'openCircle', 'a both-ends arrow keeps both');
    assert.equal(screen.mark('a2').data.startArrowheadStyle, undefined, 'an end-only arrow gains no start head');
    assert.equal(screen.mark('a2').data.arrowheadStyle, 'openCircle');
  } finally {
    await close();
  }
});

test('ink width: a re-commit of the shown (rounded) width never rebuilds; only the centre-v1 origin is rebuilt in place', () => {
  const ink = { ...pen('p-r'), sourceWidth: 3.04 };
  assert.equal(readRestyleStyle(ink).width, 3);
  assert.equal(applyRestyleChange(ink, { kind: 'width', width: 3 }), null, 'blur on the shown "3" is no change');
  const leftTop = { ...pen('p-lt'), inkGeometryOrigin: 'left-top', pathOffset: { x: 10, y: 10 }, left: 50, top: 50 };
  assert.equal(canRebuildInkWidth(leftTop), false);
});

test('marquee: a rotated line and a curved line are picked by their DRAWN geometry (window and crossing)', () => {
  const hits = (objects, rect, direction) => resolveMarqueeHits({
    marqueeRect: rect, direction, annotations: { objects }, callouts: [], pageWidth: 612, pageHeight: 792, pageNumber: 1,
  }).annotationIndices;
  // A horizontal line 100..200 at y=300 turned 90 degrees about its centre:
  // drawn vertically at x=150 from y=250 to y=350.
  const turned = { ...line('t'), left: 100, top: 300, width: 100, height: 0, x1: -50, y1: 0, x2: 50, y2: 0, angle: 90 };
  assert.deepEqual(hits([turned], { left: 140, top: 240, right: 160, bottom: 360 }, 'window'), [0]);
  assert.deepEqual(hits([turned], { left: 90, top: 290, right: 210, bottom: 310 }, 'window'), []);
  assert.deepEqual(hits([turned], { left: 145, top: 330, right: 155, bottom: 340 }, 'crossing'), [0]);
  assert.deepEqual(hits([turned], { left: 180, top: 295, right: 195, bottom: 305 }, 'crossing'), [], 'the unturned spot is empty');
  // A curve bulging up to y=275 (a quadratic through its midpoint 150,250
  // peaks at the midpoint's height).
  const curved = { ...line('c'), left: 100, top: 300, width: 100, height: 0, x1: -50, y1: 0, x2: 50, y2: 0, data: { id: 'c', midpoint: { x: 150, y: 250 } } };
  assert.deepEqual(hits([curved], { left: 95, top: 280, right: 205, bottom: 310 }, 'window'), [], 'the bulge pokes out');
  assert.deepEqual(hits([curved], { left: 95, top: 245, right: 205, bottom: 310 }, 'window'), [0]);
  assert.deepEqual(hits([curved], { left: 145, top: 245, right: 155, bottom: 255 }, 'crossing'), [0], 'the bulge itself crosses');
});

// ---- review pass 2 (2026-09-25) ----------------------------------------------

test('real path: a cross-page group holding a colleague\'s mark is still restyled (only the undo step is left out)', async () => {
  const { screen, close } = await openScreen('w41-foreign-cross-page');
  try {
    screen.save(1, () => [{ ...pen('p1'), meta: { authorId: 'user-b' }, data: { id: 'p1', authorId: 'user-b' } }]);
    screen.save(2, () => [pageCallout('c2', 2)]);
    const viewer = groupViewer(screen, {
      selection: { pageNumber: 1, indices: [0], ids: ['p1'] },
      calloutIds: ['c2'],
    });
    const out = viewer.write({ kind: 'strokeColor', color: '#0000ff' });
    assert.equal(out.kind, 'transaction');
    assert.equal(screen.mark('p1', 1).fill, 'rgba(0, 0, 255, 1)', 'the colleague\'s stroke changed too');
    assert.equal(deriveCalloutsFromByPage(screen.byPage).find((c) => c.id === 'c2').style.borderColor, '#0000ff');
    const viewerSource = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
    assert.match(viewerSource, /if \(!scopedAction && !saveContext\?\.applyWithoutOwnedStep\) return false;/);
    assert.match(viewerSource, /action: 'group-restyle',\s*applyWithoutOwnedStep: true,/);
  } finally {
    await close();
  }
});

test('real path: a colleague moving a picked mark mid-drag keeps the move when the drag is undone', async () => {
  const { screen, close } = await openScreen('w41-drag-collab');
  try {
    screen.save(1, () => [{ ...pen('p1'), fill: 'rgba(255, 0, 0, 1)' }].map(mine));
    screen.save(2, () => [pageCallout('c2', 2)]);
    const viewer = groupViewer(screen, {
      selection: { pageNumber: 1, indices: [0], ids: ['p1'] },
      calloutIds: ['c2'],
    });
    viewer.paint('strokeOpacity', 60, 100, 'preview');
    // A collaborator's move lands on screen mid-drag (not this user's step).
    screen.transaction((byPage) => ({
      nextByPage: { ...byPage, 1: { ...byPage[1], objects: byPage[1].objects.map((o) => ({ ...o, left: 77 })) } },
      action: null,
    }));
    viewer.paint('strokeOpacity', 30, 60, 'commit');
    assert.equal(screen.undo(), 'applied');
    assert.equal(screen.mark('p1', 1).fill, 'rgba(255, 0, 0, 1)', 'undo restores the paint');
    assert.equal(screen.mark('p1', 1).left, 77, 'and keeps the colleague\'s move');
  } finally {
    await close();
  }
});

test('real path: the Arrow ends menu on picked arrows is ONE write and keeps each arrow\'s own head', async () => {
  const { screen, close } = await openScreen('w41-arrow-ends-menu');
  try {
    const headless = mine({ ...line('a1', 'arrow'), data: { id: 'a1', tool: 'arrow', arrowheadStyle: 'none' } });
    const circled = mine({ ...line('a2', 'arrow'), data: { id: 'a2', tool: 'arrow', arrowheadStyle: 'openCircle' } });
    screen.save(1, () => [headless, circled]);
    const depth = screen.depths().localUndo;
    const viewer = groupViewer(screen, { selection: { pageNumber: 1, indices: [0, 1], ids: ['a1', 'a2'] } });
    viewer.write({ kind: 'arrowEnds', ends: 'both' });
    assert.equal(screen.depths().localUndo, depth + 1, 'one step');
    assert.deepEqual(
      [screen.mark('a1').data.arrowheadStyle, screen.mark('a1').data.startArrowheadStyle],
      ['solidTriangle', 'solidTriangle'],
      'a headless arrow gets the default head on both ends',
    );
    assert.deepEqual(
      [screen.mark('a2').data.arrowheadStyle, screen.mark('a2').data.startArrowheadStyle],
      ['openCircle', 'openCircle'],
      'an arrow keeps its own head style',
    );
    viewer.write({ kind: 'arrowEnds', ends: 'none' });
    assert.equal(screen.mark('a2').data.arrowheadStyle, 'none');
    assert.equal(screen.mark('a2').data.startArrowheadStyle, 'none');
    const shell = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
    assert.match(shell, /bottomToolbarApi\.setGroupArrowEnds\(next\);/);
    const phone = fs.readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
    assert.match(phone, /api\.setGroupArrowEnds\(next\);/);
  } finally {
    await close();
  }
});

test('a mixed Width field keeps what the user types (the draft is not reset mid-typing)', () => {
  const size = fs.readFileSync(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');
  assert.match(size, /if \(mixed && fieldFocusedRef\.current\) return;/);
});
