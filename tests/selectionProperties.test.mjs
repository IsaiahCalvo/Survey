// Nightly 'properties-panel' (Drawboard PDF's Expand menu, checked live 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canTypeSize,
  canTypeTurn,
  formatPt,
  headerCountText,
  kindLabel,
  kindOfObject,
  parseTyped,
  planTypedMove,
  shiftRead,
  readTransform,
  resizeObjectTo,
  unionPageBox,
  wrapDegrees,
} from '../src/utils/selectionProperties.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rect = (extra = {}) => ({ type: 'rect', left: 10, top: 20, width: 100, height: 50, scaleX: 1, scaleY: 1, angle: 0, strokeWidth: 0, ...extra });

test('numbers read with up to 2 decimals and turns wrap into 0 to 359.99', () => {
  assert.equal(formatPt(300.714), '300.71');
  assert.equal(formatPt(72), '72');
  assert.equal(formatPt(-0.001), '0');
  assert.equal(formatPt('x'), '');
  assert.equal(wrapDegrees(400), 40);
  assert.equal(wrapDegrees(-30), 330);
  assert.equal(wrapDegrees(360), 0, 'a typed 360 reads 0, not 360');
  assert.equal(wrapDegrees(359.999), 0);
  assert.equal(wrapDegrees('nope'), null);
});

test('only plain numbers count as typed', () => {
  assert.equal(parseTyped(' 12.5 '), 12.5);
  assert.equal(parseTyped('-3'), -3);
  assert.equal(parseTyped('.5'), 0.5);
  assert.equal(parseTyped(''), null);
  assert.equal(parseTyped('12px'), null);
  assert.equal(parseTyped('1e3'), null);
});

test('the header counts the pick and names its kind', () => {
  assert.equal(headerCountText(1), '1 annotation selected');
  assert.equal(headerCountText(3), '3 annotations selected');
  assert.equal(kindOfObject(rect()), 'rect');
  assert.equal(kindOfObject({ type: 'path', data: { tape: true } }), 'tape');
  assert.equal(kindOfObject({ type: 'path', tool: 'highlighter' }), 'highlighter');
  assert.equal(kindOfObject({ type: 'line', data: { arrowheadStyle: 'open' } }), 'arrow');
  assert.equal(kindOfObject({ type: 'line', data: { arrowheadStyle: 'none' } }), 'line');
  assert.equal(kindOfObject({ type: 'rect', data: { type: 'counter' } }), 'counter');
  assert.equal(kindOfObject(null, 'callout'), 'callout');
  assert.equal(kindLabel(['rect']), 'Rectangle');
  assert.equal(kindLabel(['rect', 'rect']), 'Rectangle');
  assert.equal(kindLabel(['rect', 'arrow']), 'Mixed subjects');
  assert.equal(kindLabel([]), '');
});

test('the group box wraps every page box', () => {
  assert.equal(unionPageBox([]), null);
  assert.deepEqual(
    unionPageBox([{ left: 0, top: 10, width: 5, height: 5 }, { left: 20, top: 0, width: 10, height: 4 }, null]),
    { left: 0, top: 0, width: 30, height: 15 },
  );
});

test('W and H type only on box marks; R types on all but counters, text markup and tape', () => {
  assert.equal(canTypeSize(rect()), true);
  assert.equal(canTypeSize({ type: 'line' }), false);
  assert.equal(canTypeSize(rect({ data: { type: 'counter' } })), false);
  assert.equal(canTypeTurn({ type: 'line' }), true);
  assert.equal(canTypeTurn({ type: 'path', data: { tape: true } }), false);
  assert.equal(canTypeTurn(rect({ data: { type: 'text-markup' } })), false);
});

test('one upright rectangle reads its own box; two read the group box with a shared or mixed turn', () => {
  const one = readTransform([rect()]);
  assert.equal(one.single, true);
  assert.equal(one.sizable, true);
  assert.equal(Math.round(one.x), 10);
  assert.equal(Math.round(one.y), 20);
  assert.equal(Math.round(one.w), 100);
  assert.equal(Math.round(one.h), 50);
  assert.equal(one.r, 0);

  const turned = readTransform([rect({ angle: -30 })]);
  assert.equal(turned.r, 330);

  const two = readTransform([rect(), rect({ left: 200, top: 100 })]);
  assert.equal(two.single, false);
  assert.equal(two.sizable, false);
  assert.equal(two.turnable, false);
  assert.equal(Math.round(two.w), 290);
  assert.equal(two.r, 0);
  assert.equal(two.rMixed, false);
  const mixed = readTransform([rect(), rect({ left: 200, angle: 10 })]);
  assert.equal(mixed.r, null);
  assert.equal(mixed.rMixed, true);
  assert.equal(readTransform([]), null);
});

test('a typed X or Y is a move by the gap; the same value is no change', () => {
  const read1 = { x: 10, y: 20 };
  assert.deepEqual(planTypedMove(read1, 'x', 40), { dx: 30, dy: 0 });
  assert.deepEqual(planTypedMove(read1, 'y', 5), { dx: 0, dy: -15 });
  assert.equal(planTypedMove(read1, 'x', 10), null);
  assert.equal(planTypedMove(read1, 'w', 10), null);
});

test('a typed W or H scales a box mark and reflows a text box; it stops at 1', () => {
  const wider = resizeObjectTo(rect(), 'w', 200);
  assert.equal(wider.scaleX, 2);
  assert.equal(wider.scaleY, 1);
  assert.equal(wider.left, 10, 'the top-left holds');
  const tiny = resizeObjectTo(rect(), 'h', -5);
  assert.equal(tiny.scaleY, 1 / 50);
  assert.equal(resizeObjectTo(rect(), 'w', 100), null, 'same size is no change');
  assert.equal(resizeObjectTo({ type: 'line' }, 'w', 50), null);
  const text = resizeObjectTo({ type: 'textbox', left: 0, top: 0, width: 80, height: 20, scaleX: 1.5, scaleY: 1 }, 'w', 160);
  assert.equal(text.width, 160);
  assert.equal(text.scaleX, 1);
});

test('a beta flag with its migration, wired into the quick bar, the app shell and the layer', () => {
  assert.equal(FEATURE_FLAGS['properties-panel']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110145000_properties_panel_flag.sql'), /\('properties-panel', 'off'/);
  assert.match(read('src/components/SelectionQuickBar.jsx'), /data-selection-quick-expand/);
  assert.match(read('src/AppShell.jsx'), /<SelectionPropertiesPanel/);
  assert.match(read('src/components/SVGAnnotationLayer.jsx'), /TRANSFORM_SELECTION_EVENT/);
});

test('arrow steps and the blur after them measure from moves already sent', () => {
  const read = { x: 10, y: 20, w: 5, h: 5 };
  const sent = { dx: 0, dy: 0 };
  const step = (field, value) => {
    const move = planTypedMove(shiftRead(read, sent), field, value);
    if (move) { sent.dx += move.dx; sent.dy += move.dy; }
    return move;
  };
  assert.deepEqual(step('x', 11), { dx: 1, dy: 0 }); // ArrowUp
  assert.deepEqual(step('x', 12), { dx: 1, dy: 0 }); // held: one more step, not two
  assert.equal(step('x', 12), null); // the blur commits the same value
  assert.deepEqual(step('y', 19), { dx: 0, dy: -1 });
  assert.equal(shiftRead(read, { dx: 0, dy: 0 }), read);
  const panel = readFileSync(new URL('../src/components/SelectionPropertiesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /planTypedMove\(shiftRead\(transform, sent\), field, value\)/);
  assert.match(panel, /if \(sentMoveRef\.current\.read !== transform\) sentMoveRef\.current = \{ read: transform, dx: 0, dy: 0 \};/);
});

test('Selected colors: a swatch recolours every use of that colour in the pick, locked marks kept', async () => {
  const { recolourObject } = await import('../src/utils/selectionProperties.js');
  const red = { type: 'rect', stroke: '#E11D2E', fill: '#e11d2e' };
  assert.deepEqual(recolourObject(red, '#e11d2e', '#0066D4'), { type: 'rect', stroke: '#0066D4', fill: '#0066D4' }, 'stroke and fill alike, any case');
  assert.deepEqual(recolourObject({ stroke: '#E11D2E', fill: '#FFF9C4' }, '#E11D2E', '#000000'), { stroke: '#000000', fill: '#FFF9C4' });
  assert.equal(recolourObject({ stroke: '#0066D4' }, '#E11D2E', '#000000'), null, 'a mark without the colour is left alone');
  assert.equal(recolourObject(red, '#E11D2E', '#e11d2e'), null, 'the same colour is no change');
  assert.equal(recolourObject(red, '', '#000000'), null);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /if \(detail\.op === 'recolour'\) \{/);
  assert.match(layer, /if \(!object \|\| object\.locked \|\| !canMoveAnnotation\(object\)\) continue;\s*const next = recolourObject\(object, detail\.from, detail\.to\);/);
  assert.match(layer, /action: 'recolour'/);
  const panel = read('src/components/SelectionPropertiesPanel.jsx');
  assert.match(panel, /op: 'recolour', from, to/);
  assert.match(panel, /data-props-recolour=\{recolourFrom\}/);
});

test('Text section: Color, Opacity and Size go through the text bar\'s own setters', () => {
  const panel = read('src/components/SelectionPropertiesPanel.jsx');
  assert.match(panel, /TEXT_SIZE_TICKS = \[10, 12, 16, 20, 42, 64\]/);
  assert.match(panel, /<Section title="Text" id="text">/);
  assert.match(panel, /textFormat\.api\.setFontColor\?\.\(composeTextColor\(hex, textParts\.opacity\)\)/);
  assert.match(panel, /phase: 'preview'[\s\S]*phase: 'commit'/);
  assert.match(panel, /textFormat\.api\.setFontSize\?\.\(v\)/);
  assert.match(read('src/AppShell.jsx'), /textFormat=\{textFormatSource\}/);
});

test('Pin to side panel: pinned implies open, is remembered, and docks into AppShell\'s host', async () => {
  const store = await import('../src/utils/propertiesPanelStore.js');
  store.setPropertiesPanelOpen(false);
  store.setPropertiesPanelPinned(true);
  assert.equal(store.isPropertiesPanelPinned(), true);
  assert.equal(store.isPropertiesPanelOpen(), true);
  store.setPropertiesPanelPinned(false);
  assert.equal(store.isPropertiesPanelPinned(), false);
  assert.equal(store.isPropertiesPanelOpen(), true);
  const panel = read('src/components/SelectionPropertiesPanel.jsx');
  assert.match(panel, /docked \? dockEl : document\.body/);
  assert.match(panel, /export function PropertiesPanelDockHost/);
  assert.match(panel, /'Select'/);
  assert.match(read('src/AppShell.jsx'), /<PropertiesPanelDockHost enabled=\{Boolean\(isViewerVisible && !isMobileViewer\)\} \/>/);
});

test('Fill colour row: none, then white and the presets, on the fill side of the paint', async () => {
  const { FILL_QUICK_COLOURS, QUICK_COLOURS } = await import('../src/utils/quickStylePresets.js');
  assert.deepEqual(FILL_QUICK_COLOURS, ['#FFFFFF', ...QUICK_COLOURS]);
  const panel = read('src/components/SelectionPropertiesPanel.jsx');
  assert.match(panel, /data-props-fill-none/);
  assert.match(panel, /onClick=\{clearFill\}/);
  assert.doesNotMatch(panel, /paint\.fill\.apply\(paint\.fill\.color, 0\)/, 'No fill must not rewrite the colour');
  assert.match(panel, /api\?\.handleFillOpacityChange\?\.\(0\)/);
  assert.match(panel, /useLayoutEffect\(\(\) => \{\n    if \(!active \|\| docked\)/);
  assert.match(panel, /paint\.fill\.apply\(hex, paint\.fill\.opacity > 0 \? paint\.fill\.opacity : 1\)/);
  assert.match(read('src/AppShell.jsx'), /fill: isShape \? channel\(true\) : null,/);
});
