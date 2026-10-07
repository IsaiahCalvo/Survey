/*
 * Regression (2026-09-23, w13): changing a SELECTED callout's text colour from
 * the desktop text bar (Red / Blue / Black dots, Custom color) or the phone
 * Text settings card did nothing. Two causes:
 *   1. With a callout or text box selected, the bar read and wrote the TOOL's
 *      text defaults (resolveTextFormatting treats context tool 'callout' /
 *      'text' as "armed"), so the change went to the next box, not this one.
 *   2. Inside the live editor the change did save, but leaving the editor
 *      committed the style captured when the edit began, putting it back
 *      (fixed on main in 15eaae16e; pinned by the last test here).
 * These tests pin the selection bridge (utils/selectedTextFormatting.js), its
 * wiring in PDFViewer, the drag phase riding through to the save pipeline,
 * and the edit commit keeping the live style.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSelectedTextStylePatch,
  isFormattableTextObject,
  patchCanReflowText,
  placeCalloutEditBox,
  readCalloutTextStyle,
  readTextboxTextStyle,
  refitCalloutToText,
  refitTextboxToText,
  resolveFontSizeDraft,
  resolveTextStyleWrite,
  TEXT_BOX_PADDING,
} from '../src/utils/selectedTextFormatting.js';
import { findSelectedAnnotationIndex } from '../src/utils/annotationStorageIdentity.js';
import { composeTextColor } from '../src/utils/textColorOpacity.js';
import { mergeEditOntoCurrent } from '../src/utils/dragCommitMerge.js';
import {
  MIN_KNEE_TO_BOX_EDGE_DISTANCE,
  calculateCalloutConnection,
  calloutDrawnBoxHeight,
} from '../src/utils/calloutGeometry.js';
import { planGroupUpdate, resolveGroupWrite } from '../src/utils/selectionRestyle.js';
import {
  applyCalloutListToByPage,
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import { normalizeMergedHistoryObject } from '../src/utils/historyMergeNormalize.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the bar reads a selected callout\'s own text style, legacy textColor included', () => {
  const state = readCalloutTextStyle({
    style: { fontColor: 'rgba(255, 0, 0, 0.4)', fontSize: 18, bold: true, strikethrough: true, textAlign: 'center' },
  });
  assert.deepEqual(state, {
    fontColor: 'rgba(255, 0, 0, 0.4)',
    fontFamily: 'Arial',
    fontSize: 18,
    bold: true,
    italic: false,
    underline: false,
    strike: true,
    textAlign: 'center',
    verticalAlign: 'top',
  });
  assert.equal(readCalloutTextStyle({ style: { textColor: '#00ff00' } }).fontColor, '#00ff00');
  assert.equal(readCalloutTextStyle({}).fontColor, '#1e293b');
});

test('the bar reads a selected text box from its Fabric fields', () => {
  const state = readTextboxTextStyle({
    type: 'textbox', fill: '#ff0000', fontWeight: 700, fontStyle: 'italic', linethrough: true, fontSize: 12.4,
  });
  assert.equal(state.fontColor, '#ff0000');
  assert.equal(state.bold, true);
  assert.equal(state.italic, true);
  assert.equal(state.strike, true);
  assert.equal(state.fontSize, 12);
  assert.equal(isFormattableTextObject({ type: 'textbox' }), true);
  assert.equal(isFormattableTextObject({ type: 'Textbox' }), true);
  assert.equal(isFormattableTextObject({ type: 'rect' }), false);
  assert.equal(isFormattableTextObject({ type: 'textbox', data: { type: 'callout' } }), false);
});

test('a colour dot on a selected callout writes ONLY the text colour, keeping its opacity', () => {
  const current = readCalloutTextStyle({ style: { fontColor: 'rgba(30, 41, 59, 0.4)', bold: true } });
  // What the bar does for the Red dot: merge the new colour into the state on screen.
  const next = { ...current, fontColor: composeTextColor('#ff0000', 0.4) };
  assert.deepEqual(
    buildSelectedTextStylePatch('callout', current, next),
    { fontColor: 'rgba(255, 0, 0, 0.4)' },
  );
  // A plain hex (legacy / fully opaque) still works.
  assert.deepEqual(
    buildSelectedTextStylePatch('callout', current, { ...current, fontColor: '#0000ff' }),
    { fontColor: '#0000ff' },
  );
});

test('text box patches use the Fabric field names', () => {
  const current = readTextboxTextStyle({ type: 'textbox', fill: '#000000' });
  assert.deepEqual(
    buildSelectedTextStylePatch('textbox', current, { ...current, fontColor: 'rgba(0, 0, 255, 0.5)', bold: true, strike: true }),
    { fill: 'rgba(0, 0, 255, 0.5)', fontWeight: 'bold', linethrough: true },
  );
  assert.deepEqual(
    buildSelectedTextStylePatch('callout', readCalloutTextStyle({}), { ...readCalloutTextStyle({}), strike: true, italic: true }),
    { italic: true, strikethrough: true },
  );
});

test('an unchanged value writes nothing, unless a colour drag must record its release', () => {
  const current = readCalloutTextStyle({ style: { fontColor: 'rgba(255, 0, 0, 0.4)' } });
  assert.equal(buildSelectedTextStylePatch('callout', current, { ...current }), null);
  assert.deepEqual(
    buildSelectedTextStylePatch('callout', current, { ...current }, { forceColor: true }),
    { fontColor: 'rgba(255, 0, 0, 0.4)' },
  );
});

test('unsafe values never reach the saved object', () => {
  const current = readCalloutTextStyle({});
  assert.equal(
    buildSelectedTextStylePatch('callout', current, { ...current, fontColor: 'red; background: url(x)' }),
    null,
  );
  assert.equal(
    buildSelectedTextStylePatch('callout', current, { ...current, fontFamily: 'Arial, sans-serif' }),
    null,
  );
  assert.deepEqual(
    buildSelectedTextStylePatch('callout', current, { ...current, fontSize: 999 }),
    { fontSize: 200 },
  );
  assert.equal(buildSelectedTextStylePatch('rect', current, { ...current, bold: true }), null);
});

test('PDFViewer publishes the selection as the text bar source and writes back to it', () => {
  const viewer = read('src/PDFViewer.jsx');
  // The published pair is the selected object's style while one is selected.
  assert.match(viewer, /textStyleDefaults: selectedTextTarget \? selectedTextTarget\.style : textStyleDefaults,/);
  assert.match(viewer, /onTextStyleDefaultsChange: handleTextStyleSourceChange,/);
  // The selection wins only under Select with no live editor (whose own bridge wins).
  assert.match(viewer, /const selectedTextTarget = \(pickBarTool === 'select' && !richTextEditor\)/);
  assert.match(viewer, /selectedTextTargetRef\.current = selectedTextTarget;/);
  // The WHOLE handler runs inside the drag phase (so a drag's page snapshot is
  // always dropped), decides with resolveTextStyleWrite, and makes ONE write -
  // the style and the refit together - per change.
  const handler = viewer.slice(
    viewer.indexOf('const handleTextStyleSourceChange = useCallback('),
    viewer.indexOf('const handleTextStyleSourceChange = useCallback(') + 1400,
  );
  // RULED 2026-09-23 (w15 hardening): the handler takes a third argument,
  // `changed` (only the fields the user touched); what is guarded - the whole
  // handler runs inside runWithPaintPhase - is unchanged.
  assert.match(handler, /^const handleTextStyleSourceChange = useCallback\(\(next, options, changed\) => \{\s*runWithPaintPhase\(options, \(\) => \{/);
  assert.match(handler, /resolveTextStyleWrite\(\{\s*next,\s*changed,/);
  assert.match(handler, /resolveTextStyleWrite\(\{/);
  assert.match(handler, /handlePatchSelectedCallout\(write\.patch, write\.reflows/);
  assert.match(handler, /handlePatchSelectedAnnotation\(write\.patch, write\.reflows/);
  assert.equal((handler.match(/handlePatchSelected(Callout|Annotation)\(/g) || []).length, 2);
  // Both patch paths apply the refit to the object they save, in that save.
  // Owner Test 44: the refit also gets the callout as it was (its old font
  // size sets the old drawn box edge it anchors to).
  assert.match(viewer, /return typeof refit === 'function' \? \(refit\(patched, pageNumber, c\) \|\| patched\) : patched;/);
  assert.match(viewer, /const nextObj = typeof refit === 'function' \? \(refit\(mergedObj\) \|\| mergedObj\) : mergedObj;/);
});

const calloutTarget = (style = {}) => ({
  kind: 'callout', key: 'callout:c1', style: readCalloutTextStyle({ style }),
});

test('a change on a picked mark is a patch; armed, it is the defaults', () => {
  const target = calloutTarget({ fontColor: '#1e293b' });
  const write = resolveTextStyleWrite({
    next: { ...target.style, fontColor: '#ff0000' }, target, activeTool: 'select', dragRecord: null,
  });
  assert.equal(write.action, 'patch');
  assert.deepEqual(write.patch, { fontColor: '#ff0000' });
  assert.equal(write.reflows, false);
  const armed = resolveTextStyleWrite({
    next: { ...readCalloutTextStyle({}), bold: true, supportsVerticalAlign: false },
    target: null, activeTool: 'callout', dragRecord: null,
  });
  assert.equal(armed.action, 'defaults');
  assert.equal(armed.defaults.bold, true);
  assert.equal('supportsVerticalAlign' in armed.defaults, false);
});

test('no default write when the picked mark vanished (mid-drag or not)', () => {
  const target = calloutTarget();
  const now = 1_000_000;
  const first = resolveTextStyleWrite({
    next: { ...target.style, fontColor: 'rgba(255, 0, 0, 0.5)' },
    phase: 'preview', target, activeTool: 'select', dragRecord: null, now,
  });
  assert.equal(first.action, 'patch');
  assert.deepEqual(first.dragRecord, { key: 'callout:c1', at: now });
  // A collaborator deletes the callout; the drag keeps going and is released.
  const frame = resolveTextStyleWrite({
    next: { ...target.style, fontColor: 'rgba(255, 0, 0, 0.4)' },
    phase: 'preview', target: null, activeTool: 'select', dragRecord: first.dragRecord, now: now + 16,
  });
  assert.equal(frame.action, 'ignore');
  const release = resolveTextStyleWrite({
    next: { ...target.style, fontColor: 'rgba(255, 0, 0, 0.3)' },
    phase: 'commit', target: null, activeTool: 'select', dragRecord: frame.dragRecord, now: now + 32,
  });
  assert.equal(release.action, 'ignore');
  assert.equal(release.dragRecord, null);
  // A plain click with nothing picked under Select writes nothing either.
  assert.equal(resolveTextStyleWrite({
    next: { ...target.style, bold: true }, target: null, activeTool: 'select', dragRecord: null,
  }).action, 'ignore');
});

test('a drag never jumps to a different mark', () => {
  const a = calloutTarget();
  const b = { ...calloutTarget(), key: 'textbox:t9', kind: 'textbox', style: readTextboxTextStyle({ type: 'textbox' }) };
  const now = 5_000;
  const first = resolveTextStyleWrite({
    next: { ...a.style, fontColor: '#ff0000' }, phase: 'preview', target: a, activeTool: 'select', dragRecord: null, now,
  });
  const other = resolveTextStyleWrite({
    next: { ...b.style, fontColor: '#00ff00' }, phase: 'commit', target: b, activeTool: 'select', dragRecord: first.dragRecord, now: now + 20,
  });
  assert.equal(other.action, 'ignore');
  // A record left by a drag whose release never came (older than 2s) is stale.
  const later = resolveTextStyleWrite({
    next: { ...b.style, fontColor: '#00ff00' }, phase: 'preview', target: b, activeTool: 'select', dragRecord: first.dragRecord, now: now + 5000,
  });
  assert.equal(later.action, 'patch');
});

test('an empty change writes nothing', () => {
  const target = calloutTarget({ fontColor: '#ff0000' });
  assert.equal(resolveTextStyleWrite({
    next: { ...target.style }, target, activeTool: 'select', dragRecord: null,
  }).action, 'ignore');
});

// A fake layout engine: `fontSize x lineStep` per wrapped line, where a line
// holds floor(innerWidth / (0.6 x fontSize)) characters (bold is 10% wider).
// `query: 'widestWord'` answers the widest word's one-line width.
const fakeMeasure = ({ text, innerWidth, fontSize, fontWeight, lineHeight, query }) => {
  const charWidth = 0.6 * fontSize * (String(fontWeight) === 'bold' ? 1.1 : 1);
  if (query === 'widestWord') {
    return String(text).split(/\s+/).reduce((widest, word) => Math.max(widest, word.length * charWidth), 0);
  }
  const perLine = Math.max(1, Math.floor(innerWidth / charWidth));
  const lines = String(text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return lines * fontSize * lineHeight;
};

// Owner Test 44 (2026-10-06): the box fits its text both ways and moves AWAY
// from its leader. RULED: the earlier test here pinned "boxes never shrink"
// and "the position never moves"; the owner's decision replaced both rules.
const PAGE = { width: 600, height: 800 };
const GAP = MIN_KNEE_TO_BOX_EDGE_DISTANCE;
// Page units -> a callout (fractions of the page).
const makeCallout = ({ id = 'c1', text = 'AB CD EF GH', box, knee, tip, fontSize = 12 }) => ({
  id,
  pageNumber: 1,
  text,
  arrowTip: tip ? { x: tip.x / PAGE.width, y: tip.y / PAGE.height } : undefined,
  knee: knee ? { x: knee.x / PAGE.width, y: knee.y / PAGE.height } : undefined,
  textBoxPosition: { x: box.left / PAGE.width, y: box.top / PAGE.height },
  textBoxWidth: box.width / PAGE.width,
  textBoxHeight: box.height / PAGE.height,
  style: { fontSize },
});
// The box as DRAWN (stored height, at least 18, plus the descender strip).
const drawn = (callout) => {
  const left = callout.textBoxPosition.x * PAGE.width;
  const top = callout.textBoxPosition.y * PAGE.height;
  const width = callout.textBoxWidth * PAGE.width;
  return {
    left, top, right: left + width, width,
    height: callout.textBoxHeight * PAGE.height,
    bottom: top + calloutDrawnBoxHeight(callout.textBoxHeight * PAGE.height, callout.style.fontSize),
  };
};
const resize = (callout, fontSize) => refitCalloutToText(
  { ...callout, style: { ...callout.style, fontSize } }, PAGE, fakeMeasure, { before: callout },
);
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
const distToBox = (p, r) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
// The renderer's own geometry keeps the stored knee (no bad-geometry re-route).
const rendererKeepsKnee = (callout) => {
  const r = drawn(callout);
  const knee = { x: callout.knee.x * PAGE.width, y: callout.knee.y * PAGE.height };
  const tip = { x: callout.arrowTip.x * PAGE.width, y: callout.arrowTip.y * PAGE.height };
  const conn = calculateCalloutConnection(r.left, r.top, r.width, r.bottom - r.top, knee, tip, 0);
  near(conn.effectiveKnee.x, knee.x, 'drawn knee x');
  near(conn.effectiveKnee.y, knee.y, 'drawn knee y');
};

// 'AB CD EF GH' in a 120-wide box: one line at 12pt and 10pt, three at 36pt.
const ONE_LINE_12 = 12 * 1.13;
const THREE_LINES_36 = 3 * 36 * 1.13;

test('knee below: 12 -> 36 -> 10 keeps the bottom edge, grows up and shrinks back down; knee and tip stay', () => {
  const start = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 },
    knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  const bottom = drawn(start).bottom;
  const big = resize(start, 36);
  near(big.textBoxHeight * PAGE.height, THREE_LINES_36, 'height at 36');
  near(drawn(big).bottom, bottom, 'bottom edge at 36');
  assert.ok(drawn(big).top < drawn(start).top, 'grew upward');
  assert.equal(big.textBoxWidth, start.textBoxWidth);
  assert.deepEqual(big.knee, start.knee);
  assert.deepEqual(big.arrowTip, start.arrowTip);
  rendererKeepsKnee(big);
  const small = resize(big, 10);
  near(small.textBoxHeight * PAGE.height, 10 * 1.13, 'shrinks to one line at 10');
  near(drawn(small).bottom, bottom, 'bottom edge at 10');
  assert.deepEqual(small.knee, start.knee);
  rendererKeepsKnee(small);
});

test('knee above: the top edge stays and the box grows down; knee and tip stay', () => {
  const start = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 },
    knee: { x: 160, y: 200 }, tip: { x: 160, y: 100 },
  });
  const big = resize(start, 36);
  assert.deepEqual(big.textBoxPosition, start.textBoxPosition);
  near(big.textBoxHeight * PAGE.height, THREE_LINES_36, 'height');
  assert.deepEqual(big.knee, start.knee);
  assert.deepEqual(big.arrowTip, start.arrowTip);
  rendererKeepsKnee(big);
  // Shrinking back keeps the top edge too.
  const small = resize(big, 12);
  assert.deepEqual(small.textBoxPosition, start.textBoxPosition);
  near(small.textBoxHeight * PAGE.height, ONE_LINE_12, 'shrunk');
});

test('knee beside (left or right): the top edge stays and the box grows down', () => {
  for (const [knee, tip] of [[{ x: 300, y: 310 }, { x: 400, y: 310 }], [{ x: 40, y: 310 }, { x: 10, y: 310 }]]) {
    const start = makeCallout({ box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee, tip });
    const big = resize(start, 36);
    assert.deepEqual(big.textBoxPosition, start.textBoxPosition, `knee at x=${knee.x}`);
    near(big.textBoxHeight * PAGE.height, THREE_LINES_36, 'height');
    assert.deepEqual(big.knee, start.knee);
    rendererKeepsKnee(big);
  }
});

test('a box that would grow over the leader shifts clear of it instead of moving the knee', () => {
  // Knee to the right, leader running back down under the box: growing down
  // would cross it, so the box slides the short way clear.
  const start = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 },
    knee: { x: 260, y: 310 }, tip: { x: 150, y: 600 },
  });
  const big = resize(start, 36);
  const r = drawn(big);
  near(big.textBoxHeight * PAGE.height, THREE_LINES_36, 'height');
  assert.deepEqual(big.knee, start.knee);
  assert.deepEqual(big.arrowTip, start.arrowTip);
  assert.ok(r.left < 100 && r.left > 60, `slid left a little (${r.left})`);
  assert.ok(distToBox({ x: 260, y: 310 }, r) >= GAP - 1e-6);
  rendererKeepsKnee(big);
});

test('at the top of the page a bottom-anchored box grows down as far as it must, still clear of the knee', () => {
  const start = makeCallout({
    box: { left: 100, top: 20, width: 120, height: ONE_LINE_12 },
    knee: { x: 160, y: 200 }, tip: { x: 160, y: 300 },
  });
  const big = resize(start, 36);
  const r = drawn(big);
  near(r.top, 0, 'stops at the page top');
  assert.ok(r.bottom <= 200 - GAP, 'clear of the knee');
  assert.deepEqual(big.knee, start.knee);
  rendererKeepsKnee(big);
  // No room above or below: it slides sideways off the knee.
  const tight = makeCallout({
    box: { left: 100, top: 20, width: 120, height: ONE_LINE_12 },
    knee: { x: 160, y: 120 }, tip: { x: 160, y: 300 },
  });
  const moved = resize(tight, 36);
  const m = drawn(moved);
  assert.ok(m.top >= 0 && m.right <= PAGE.width, 'on the page');
  assert.ok(distToBox({ x: 160, y: 120 }, m) >= GAP - 1e-6, 'clear of the knee');
  assert.deepEqual(moved.knee, tight.knee);
  assert.deepEqual(moved.arrowTip, tight.arrowTip);
  rendererKeepsKnee(moved);
});

test('one long word widens the box so it is not split mid-word; otherwise the width stays', () => {
  const start = makeCallout({
    text: 'SUPERCALIFRAGILISTIC',
    box: { left: 100, top: 300, width: 120, height: 2 * ONE_LINE_12 },
    knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  const big = resize(start, 36);
  const word = 20 * 0.6 * 36;
  near(big.textBoxWidth * PAGE.width, word + 2 * TEXT_BOX_PADDING + 1, 'width fits the word');
  near(big.textBoxHeight * PAGE.height, 36 * 1.13, 'one line');
  near(drawn(big).left, 100, 'left edge stays (knee is not to the right)');
  near(drawn(big).bottom, drawn(start).bottom, 'bottom edge stays');
  // A word that already fits never changes the width.
  assert.equal(resize(makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  }), 36).textBoxWidth, 120 / PAGE.width);
});

test('a callout without a leader and an unchanged fit are left alone', () => {
  const bare = makeCallout({ box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 } });
  const big = resize(bare, 36);
  assert.deepEqual(big.textBoxPosition, bare.textBoxPosition, 'top edge stays');
  near(big.textBoxHeight * PAGE.height, THREE_LINES_36, 'height');
  const fits = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  assert.equal(refitCalloutToText(fits, PAGE, fakeMeasure, { before: fits }), fits);
  // No browser measurer: never guesses.
  assert.equal(refitCalloutToText({ ...fits, style: { fontSize: 36 } }, PAGE, () => null, { before: fits }).textBoxHeight, fits.textBoxHeight);
  // Colour alone never reflows.
  assert.equal(patchCanReflowText('callout', { fontColor: '#ff0000' }), false);
  assert.equal(patchCanReflowText('callout', { bold: true }), true);
});

test('the text bar patch and its refit are one write on a picked callout', () => {
  const callout = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  const target = { kind: 'callout', key: 'callout:c1', style: readCalloutTextStyle(callout) };
  const write = resolveTextStyleWrite({ next: { ...target.style, fontSize: 36 }, target, activeTool: 'select', dragRecord: null });
  assert.equal(write.reflows, true);
  const patched = { ...callout, style: { ...callout.style, ...write.patch } };
  const refit = refitCalloutToText(patched, PAGE, fakeMeasure, { before: callout });
  assert.equal(refit.style.fontSize, 36);
  near(drawn(refit).bottom, drawn(callout).bottom, 'bottom edge');
});

test('several picked callouts: each refits on its own, in ONE write (one undo step)', () => {
  const down = makeCallout({
    id: 'down', box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  const up = makeCallout({
    id: 'up', box: { left: 350, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 410, y: 200 }, tip: { x: 410, y: 100 },
  });
  const byPage = applyCalloutListToByPage({ 1: { objects: [] } }, [down, up], { 1: PAGE });
  const plan = planGroupUpdate({
    byPage,
    calloutIds: ['down', 'up'],
    calloutPageOf: () => 1,
    calloutStyle: (callout) => buildSelectedTextStylePatch('callout', readCalloutTextStyle(callout), { fontSize: 36 }),
    calloutRefit: (callout, page, stylePatch, before) => refitCalloutToText(callout, PAGE, fakeMeasure, { before }),
    deriveCallouts: deriveCalloutsFromByPage,
    applyCalloutList: applyCalloutListToByPage,
    pageSizes: { 1: PAGE },
  });
  const out = resolveGroupWrite({ byPage, plan, phase: null, baseline: new Map(), buildDocumentAction: () => null });
  assert.equal(out.kind, 'saves');
  assert.equal(out.saves.length, 1, 'one page save = one undo step');
  const after = deriveCalloutsFromByPage({ 1: out.saves[0][1] });
  const nextDown = after.find((c) => c.id === 'down');
  const nextUp = after.find((c) => c.id === 'up');
  assert.equal(nextDown.style.fontSize, 36);
  assert.equal(nextUp.style.fontSize, 36);
  assert.ok(Math.abs(drawn(nextDown).bottom - drawn(down).bottom) < 1e-3, 'knee-below box keeps its bottom');
  assert.ok(Math.abs(drawn(nextUp).top - drawn(up).top) < 1e-3, 'knee-above box keeps its top');
  assert.ok(Math.abs(nextDown.knee.y - down.knee.y) < 1e-9 && Math.abs(nextUp.knee.y - up.knee.y) < 1e-9);
});

test('history merge normalisation refits a callout by the same rule (both ways, away from the leader)', () => {
  const callout = makeCallout({
    box: { left: 100, top: 300, width: 120, height: THREE_LINES_36 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
    fontSize: 12,
  });
  const object = calloutToAnnotationObject(callout, PAGE);
  const target = calloutToAnnotationObject({ ...callout, style: { fontSize: 36 } }, PAGE);
  const merged = normalizeMergedHistoryObject(object, target, { pageNumber: 1, pageSize: PAGE, measure: fakeMeasure });
  const next = deriveCalloutsFromByPage({ 1: { objects: [merged] } })[0];
  assert.ok(Math.abs(next.textBoxHeight * PAGE.height - ONE_LINE_12) < 1e-3, 'shrinks to the 12pt text');
  assert.ok(Math.abs(drawn(next).bottom - drawn(callout).bottom) < 1e-3, 'bottom edge stays (knee below)');
  assert.ok(Math.abs(next.knee.y - callout.knee.y) < 1e-9);
});

test('typing into a callout: the growing box keeps the edge that faces the leader', () => {
  const start = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 500 }, tip: { x: 160, y: 650 },
  });
  const pos = placeCalloutEditBox(start, PAGE, { width: 120, height: 3 * ONE_LINE_12, fontSize: 12 });
  near(pos.left, 100, 'left');
  near(pos.top + calloutDrawnBoxHeight(3 * ONE_LINE_12, 12), drawn(start).bottom, 'bottom edge stays');
  const above = makeCallout({
    box: { left: 100, top: 300, width: 120, height: ONE_LINE_12 }, knee: { x: 160, y: 200 }, tip: { x: 160, y: 100 },
  });
  assert.deepEqual(placeCalloutEditBox(above, PAGE, { width: 120, height: 3 * ONE_LINE_12, fontSize: 12 }), { left: 100, top: 300 });
  // The overlay places the box on every broadcast and commits that spot.
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /const pos = placeCalloutBoxRef\.current\(\{ width: g\.outerW, height: outerH, fontSize: s\.fontSize \}\);/);
  assert.match(overlay, /const pos = placeCalloutBoxRef\.current\(\{ width: json\.width, height: json\.height, fontSize: s\.fontSize \}\);/);
  assert.match(read('src/PDFViewer.jsx'), /placeCalloutBox=\{editingAnnotation\?\.reactCalloutId\s*\? \(live\) => placeCalloutEditBox\(/);
});

test('a picked text box (no leader) fits both ways with its top edge fixed (width locked, tilt anchored)', () => {
  const box = { type: 'textbox', text: 'HELLO', left: 50, top: 60, width: 100, height: 34, fontSize: 16 };
  const refit = refitTextboxToText({ ...box, fontSize: 48 }, fakeMeasure);
  // 5 chars at 48px in 88px inner width: 3 per line -> 2 lines x 48 x 1.16 x 1.13, + 2 x 6 padding.
  const expected = 2 * 48 * 1.16 * 1.13 + 12;
  assert.ok(Math.abs(refit.height - expected) < 1e-6, `height ${refit.height}`);
  assert.equal(refit.width, 100);
  assert.equal(refit.left, 50);
  assert.equal(refit.top, 60);
  const tilted = refitTextboxToText({ ...box, angle: 90, fontSize: 48 }, fakeMeasure);
  const dh = expected - 34;
  assert.ok(Math.abs(tilted.left - (50 - dh / 2)) < 1e-6);
  assert.ok(Math.abs(tilted.top - (60 - dh / 2)) < 1e-6);
  // Now also shrinks: back to 10px is one line (10 x 1.16 x 1.13 + 12).
  const small = refitTextboxToText({ ...refit, fontSize: 10 }, fakeMeasure);
  assert.ok(Math.abs(small.height - (10 * 1.16 * 1.13 + 12)) < 1e-6, `shrunk ${small.height}`);
  assert.equal(small.top, 60);
  // Already fits: unchanged object.
  const fits = { ...box, height: 16 * 1.16 * 1.13 + 12 };
  assert.equal(refitTextboxToText(fits, fakeMeasure), fits);
  // No browser measurer: never guesses.
  assert.equal(refitTextboxToText({ ...box, fontSize: 48 }, () => null).height, 34);
});

test('text size is clamped to the editor range and the phone field saves once', () => {
  const current = readCalloutTextStyle({});
  assert.deepEqual(buildSelectedTextStylePatch('callout', current, { ...current, fontSize: 2 }), { fontSize: 6 });
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  // RULED 2026-09-23 (w15 hardening): the field's body grew (an unmount save)
  // and its parse + clamp moved into resolveFontSizeDraft, shared by blur /
  // Enter and the unmount save, so the slice runs to the next function and the
  // 6-200 clamp is checked on that helper (behaviourally, in the test below).
  const fieldStart = mobile.indexOf('function MobileFontSizeField(');
  const field = mobile.slice(fieldStart, mobile.indexOf('\nfunction ', fieldStart + 1));
  // Typing only edits a draft; blur / Enter commit once, clamped 6-200.
  assert.match(field, /onChange=\{\(event\) => setDraft\(/);
  assert.match(field, /onBlur=\{commit\}/);
  assert.match(field, /const fontSize = resolveFontSizeDraft\(pending, value\);/);
  // RULED CHANGE 2026-10-02 (owner, Test 19 sheet redesign): the field sits in
  // the sheet's Size row beside a preset slider (MobileTextSizeRow), which hands
  // it the text's size - or the slider's value while a drag is in flight, so
  // the field reads what the thumb is on. The field itself is unchanged.
  assert.match(mobile, /<MobileTextSizeRow\s+value=\{textDefaults\.fontSize \?\? 16\}\s+onCommit=/);
  assert.match(mobile, /<MobileFontSizeField value=\{shown\} onCommit=\{onCommit\} \/>/);
});

test('vertical alignment is hidden whenever callout text is what the bar edits', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /textVerticalAlignSupported: richTextEditor\s*\? richTextEditor\.state\?\.supportsVerticalAlign !== false\s*: !\(selectedTextTarget \? selectedTextTarget\.kind === 'callout' : contextTool === 'callout'\),/);
  assert.match(read('src/components/TextEditOverlay.jsx'), /supportsVerticalAlign: !isCallout,/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /bottomToolbarApi\?\.textVerticalAlignSupported !== false && \[\s*\['alignTop'/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.equal((mobile.match(/showVertical=\{api\.textVerticalAlignSupported !== false\}/g) || []).length, 2);
});

test('the drag phase reaches the save pipeline from every text colour picker', () => {
  const shell = read('src/AppShell.jsx');
  // RULED 2026-09-23 (w15 hardening): both bars also pass what the control
  // changed as a third argument; the drag phase (`meta`) still rides through
  // unchanged, which is what these two lines guard.
  assert.match(shell, /const patch = \(fields, meta\) => api\.onTextStyleDefaultsChange\(\{ \.\.\.defaults, \.\.\.fields \}, meta, fields\);/);
  assert.match(shell, /setFontColor: \(hex, meta\) => patch\(\{ fontColor: hex \}, meta\)/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const updateTextDefaults = \(patch, meta\) => api\.onTextStyleDefaultsChange\?\.\(\{ \.\.\.textDefaults, \.\.\.patch \}, meta, patch\);/);
  assert.match(mobile, /onChange: \(hex, alpha, meta\) => updateTextDefaults\(\{/);
  assert.match(mobile, /onChange=\{\(hex, alpha, meta\) => editorApi\.setFontColor\?\.\(/);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /if \(patch\) onCalloutTextStyleChange\(reactCalloutId, patch, meta\);/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleCalloutTextStyleChange = useCallback\(\(calloutId, stylePatch, options\) => \{/);
  assert.match(viewer, /runWithPaintPhase\(options, \(\) => handleCalloutTextStyleChange\(calloutId, stylePatch\)\);/);
});

test('leaving the callout editor keeps the text style changed during the edit', () => {
  // RULED 2026-09-24 (per-field sync, reviews A-C3/B-1): the commit now merges
  // only what the text edit changed onto the LIVE callout
  // (mergeEditOntoCurrent), which keeps the live style — and a collaborator's
  // move — instead of spreading the edit-start copy. The pin follows the new
  // code; the behaviour (style picked mid-edit survives) is exercised below.
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(c\.id !== editingAnnotation\.reactCalloutId\) return c;[\s\S]{0,400}return mergeEditOntoCurrent\(c, calloutEditStart, updatedReactCallout\) \|\| c;/,
  );
  const start = { id: 'c1', text: 'a', style: { fontSize: 12, bold: false } };
  const edited = { ...start, text: 'ab' }; // the editor spreads the edit-start style
  const live = { ...start, style: { fontSize: 20, bold: true } }; // picked mid-edit
  const merged = mergeEditOntoCurrent(live, start, edited);
  assert.equal(merged.text, 'ab');
  assert.deepEqual(merged.style, { fontSize: 20, bold: true });
});

/*
 * Hardening 2026-09-23 (second adversarial review of 484c02040 + 5b273a769).
 */

test('a colour drag on a picked mark never writes back a size a collaborator just changed', () => {
  // The bar last rendered the callout at 14pt, not bold, Arial.
  const barState = readCalloutTextStyle({ style: { fontSize: 14, fontColor: '#1e293b' } });
  // A collaborator makes it 20pt, bold, Georgia; PDFViewer's target has the new
  // style, but the drag's next frame arrives before the bar re-renders.
  const target = calloutTarget({ fontSize: 20, bold: true, fontFamily: 'Georgia', fontColor: '#1e293b' });
  let record = null;
  const now = 50_000;
  ['preview', 'preview', 'commit'].forEach((phase, i) => {
    const fields = { fontColor: composeTextColor('#ff0000', 0.5 + i * 0.1) };
    const write = resolveTextStyleWrite({
      next: { ...barState, ...fields }, changed: fields,
      phase, target, activeTool: 'select', dragRecord: record, now: now + i * 16,
    });
    record = write.dragRecord;
    assert.equal(write.action, 'patch');
    assert.deepEqual(Object.keys(write.patch), ['fontColor'], `frame ${i}: ${JSON.stringify(write.patch)}`);
    assert.equal(write.reflows, false);
  });
  // The release is always written, even onto the colour the last frame showed.
  const release = resolveTextStyleWrite({
    next: { ...barState, fontColor: target.style.fontColor }, changed: { fontColor: target.style.fontColor },
    phase: 'commit', target, activeTool: 'select', dragRecord: null,
  });
  assert.deepEqual(release.patch, { fontColor: '#1e293b' });
  // Text boxes use their own field name, and still only that one.
  const box = { kind: 'textbox', key: 'textbox:t1', style: readTextboxTextStyle({ type: 'textbox', fontSize: 30, fontWeight: 'bold' }) };
  const stale = readTextboxTextStyle({ type: 'textbox', fontSize: 16 });
  assert.deepEqual(resolveTextStyleWrite({
    next: { ...stale, fontColor: '#00ff00' }, changed: { fontColor: '#00ff00' },
    phase: 'preview', target: box, activeTool: 'select', dragRecord: null,
  }).patch, { fill: '#00ff00' });
});

test('a size change writes only the size (the refit adds only the height)', () => {
  const barState = readCalloutTextStyle({ style: { fontSize: 14 } });
  const target = calloutTarget({ fontSize: 14, bold: true, fontColor: '#ff0000' });
  const write = resolveTextStyleWrite({
    next: { ...barState, fontSize: 30 }, changed: { fontSize: 30 }, target, activeTool: 'select', dragRecord: null,
  });
  assert.deepEqual(write.patch, { fontSize: 30 });
  assert.equal(write.reflows, true);
  // Toggling bold writes bold alone; a change the mark already has writes nothing.
  assert.deepEqual(resolveTextStyleWrite({
    next: { ...barState, italic: true }, changed: { italic: true }, target, activeTool: 'select', dragRecord: null,
  }).patch, { italic: true });
  assert.equal(resolveTextStyleWrite({
    next: { ...barState, bold: true }, changed: { bold: true }, target, activeTool: 'select', dragRecord: null,
  }).action, 'ignore');
  // The tool's defaults (nothing picked) still take the whole state.
  const armed = resolveTextStyleWrite({
    next: { ...barState, fontSize: 30 }, changed: { fontSize: 30 }, target: null, activeTool: 'callout', dragRecord: null,
  });
  assert.equal(armed.action, 'defaults');
  assert.equal(armed.defaults.fontColor, barState.fontColor);
  assert.equal(armed.defaults.fontSize, 30);
});

test('a drag on a text box with no id carries on after its first save gives it one', () => {
  const style = readTextboxTextStyle({ type: 'textbox' });
  const place = 'textbox:@2:4';
  const idless = { kind: 'textbox', key: place, aliasKey: place, style };
  const now = 70_000;
  const first = resolveTextStyleWrite({
    next: { ...style, fontColor: '#ff0000' }, changed: { fontColor: '#ff0000' },
    phase: 'preview', target: idless, activeTool: 'select', dragRecord: null, now,
  });
  assert.equal(first.action, 'patch');
  assert.equal(first.dragRecord.key, place);
  // The save gave it an id; the pick itself has none yet, so its place rides along.
  const withId = { kind: 'textbox', key: 'textbox:textbox-abc', aliasKey: place, style };
  const second = resolveTextStyleWrite({
    next: { ...style, fontColor: '#ee0000' }, changed: { fontColor: '#ee0000' },
    phase: 'preview', target: withId, activeTool: 'select', dragRecord: first.dragRecord, now: now + 16,
  });
  assert.equal(second.action, 'patch');
  // ...and the drag adopts the id, so it still matches once the pick has it too.
  assert.equal(second.dragRecord.key, 'textbox:textbox-abc');
  const settled = { kind: 'textbox', key: 'textbox:textbox-abc', aliasKey: null, style };
  const release = resolveTextStyleWrite({
    next: { ...style, fontColor: '#dd0000' }, changed: { fontColor: '#dd0000' },
    phase: 'commit', target: settled, activeTool: 'select', dragRecord: second.dragRecord, now: now + 32,
  });
  assert.equal(release.action, 'patch');
  // A different box (no alias for this drag's place) is still refused.
  const other = { kind: 'textbox', key: 'textbox:textbox-zzz', aliasKey: 'textbox:@2:5', style };
  assert.equal(resolveTextStyleWrite({
    next: { ...style, fontColor: '#00ff00' }, changed: { fontColor: '#00ff00' },
    phase: 'preview', target: other, activeTool: 'select', dragRecord: first.dragRecord, now: now + 16,
  }).action, 'ignore');
});

test('the picked mark is found by id, never by a stale index', () => {
  const a = { type: 'rect', data: { id: 'a' }, left: 0, top: 0, width: 10 };
  const b = { type: 'textbox', data: { id: 'b' }, text: 'B', left: 5, top: 5, width: 40 };
  const c = { type: 'textbox', data: { id: 'c' }, text: 'C', left: 9, top: 9, width: 40 };
  // Picked b at index 1; a collaborator deletes a, so c now sits at index 1.
  assert.equal(findSelectedAnnotationIndex([b, c], { annotationIndex: 1, annotation: b }), 0);
  // b itself deleted: nothing, never c.
  assert.equal(findSelectedAnnotationIndex([a, c], { annotationIndex: 1, annotation: b }), -1);
});

test('a mark picked with no id is re-verified at its index', () => {
  const box = { type: 'textbox', text: 'HELLO', left: 50, top: 60, width: 100, angle: 0 };
  const other = { type: 'textbox', data: { id: 'x' }, text: 'OTHER', left: 200, top: 60, width: 100 };
  const sel = { annotationIndex: 1, annotation: box };
  assert.equal(findSelectedAnnotationIndex([other, box], sel), 1);
  // Its first save gave it an id (and a new size): still the same box.
  const saved = { ...box, fontSize: 30, height: 80, data: { id: 'textbox-new' } };
  assert.equal(findSelectedAnnotationIndex([other, saved], sel), 1);
  // A remote delete moved another mark into its place: refused.
  assert.equal(findSelectedAnnotationIndex([box, other], sel), -1);
  assert.equal(findSelectedAnnotationIndex([other], sel), -1);
  // PDFViewer resolves the selection through this one rule, no index fallback.
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const currentIndex = findSelectedAnnotationIndex\(pageJSON\.objects, sel\);/);
  assert.match(viewer, /const selectedAnnotIndex = findSelectedAnnotationIndex\(pageObjects, selectedToolbarAnnotation\);/);
  assert.doesNotMatch(viewer, /annotationId \?\? selectedToolbarAnnotation\?\.annotationIndex/);
  assert.doesNotMatch(viewer, /: sel\.annotationIndex;\n\s*const current = pageJSON\.objects\[currentIndex\];/);
});

test('the phone size draft saves once, clamped, and not when unchanged', () => {
  assert.equal(resolveFontSizeDraft(null, 16), null);
  assert.equal(resolveFontSizeDraft('', 16), null);
  assert.equal(resolveFontSizeDraft('24', 16), 24);
  assert.equal(resolveFontSizeDraft('999', 16), 200);
  assert.equal(resolveFontSizeDraft('2', 16), 6);
  assert.equal(resolveFontSizeDraft('16', 16), null);
  // The unmount save: once (the draft is cleared first), from the latest props.
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const fieldStart = mobile.indexOf('function MobileFontSizeField(');
  const field = mobile.slice(fieldStart, mobile.indexOf('\nfunction ', fieldStart + 1));
  assert.match(field, /latestRef\.current = \{ value, onCommit \};/);
  assert.match(field, /useEffect\(\(\) => \(\) => \{\s*const pending = draftRef\.current;\s*draftRef\.current = null;\s*const fontSize = resolveFontSizeDraft\(pending, latestRef\.current\.value\);\s*if \(fontSize !== null\) latestRef\.current\.onCommit\?\.\(fontSize\);\s*\}, \[\]\);/);
});
