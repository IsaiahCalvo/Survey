// Pan over text (owner 2026-10-14: "when I was using Drawboard I was able to
// have the pan tool selected and still hover over text and select it").
// Drawboard measured (scratchpad panText/evidence/db-pantext*.json): the Pan
// tool shows the grab hand over text, then an I-beam once the mouse or pen has
// rested on it 200 ms; a drag that starts before the rest, or on blank page,
// pans; after it, the drag selects text; a finger always pans.
// Replaces the 2026-10-13 rule "Pan never selects text" (we misread the owner).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAN_TEXT_HOVER_MS,
  deviceCanHover,
  hasLivePdfTextSelection,
  isHoverPointer,
  isPanTextTarget,
  isTextSelectionCaptureTool,
  panTextOwnsPress,
  resolvePanTextHover,
  resolvePanTextSelectionChange,
  shouldMountPanTextLayer,
} from '../src/utils/panTextSelect.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CONTAINER = read('../src/components/PdfjsViewerContainer.jsx');
const TEXT_LAYER = read('../src/components/PdfjsTextLayer.jsx');
const VIEWER = read('../src/PDFViewer.jsx');
const MARKUP = read('../src/utils/pdfTextMarkup.js');

const base = { toolIsPan: true, spaceHeld: false, pointerType: 'mouse', buttons: 0, overText: true, state: 'off' };

test('the rest before Pan selects text is Drawboard\'s 200 ms', () => {
  assert.equal(PAN_TEXT_HOVER_MS, 200);
});

test('a mouse or pen resting on text starts the timer; the timer (not the move) turns the I-beam on', () => {
  assert.deepEqual(resolvePanTextHover(base), { state: 'off', startTimer: true, stopTimer: false });
  assert.deepEqual(resolvePanTextHover({ ...base, pointerType: 'pen' }).startTimer, true);
  // Already on: stays on, nothing to restart.
  assert.deepEqual(resolvePanTextHover({ ...base, state: 'on' }), { state: 'on', startTimer: false, stopTimer: false });
});

test('leaving the text goes back to the grab hand (or keeps a live selection selectable)', () => {
  assert.equal(resolvePanTextHover({ ...base, overText: false, state: 'on' }).state, 'off');
  assert.equal(resolvePanTextHover({ ...base, overText: false, state: 'on', selectionLive: true }).state, 'keep');
  assert.equal(resolvePanTextHover({ ...base, overText: false, state: 'off' }).stopTimer, true);
});

test('a finger never hovers into text; Space held is a pure pan; other tools never', () => {
  assert.equal(isHoverPointer('touch'), false);
  assert.deepEqual(resolvePanTextHover({ ...base, pointerType: 'touch' }), { state: 'off', startTimer: false, stopTimer: true });
  assert.equal(resolvePanTextHover({ ...base, spaceHeld: true }).startTimer, false);
  assert.equal(resolvePanTextHover({ ...base, spaceHeld: true, state: 'on' }).state, 'off');
  assert.equal(resolvePanTextHover({ ...base, toolIsPan: false }).startTimer, false);
});

test('mid-drag nothing changes (a text drag keeps its I-beam, a pan keeps panning)', () => {
  assert.deepEqual(resolvePanTextHover({ ...base, buttons: 1, state: 'on', overText: false }), { state: 'on', startTimer: false, stopTimer: false });
  assert.deepEqual(resolvePanTextHover({ ...base, buttons: 1, state: 'off' }), { state: 'off', startTimer: false, stopTimer: false });
});

test('only a left mouse / pen press on the text layer with the I-beam showing selects text', () => {
  const press = { toolIsPan: true, spaceHeld: false, state: 'on', pointerType: 'mouse', button: 0, onTextLayer: true };
  assert.equal(panTextOwnsPress(press), true);
  assert.equal(panTextOwnsPress({ ...press, pointerType: 'pen' }), true);
  assert.equal(panTextOwnsPress({ ...press, state: 'off' }), false, 'before the rest a press pans');
  assert.equal(panTextOwnsPress({ ...press, state: 'keep' }), false, 'off the text a press pans');
  assert.equal(panTextOwnsPress({ ...press, onTextLayer: false }), false, 'blank page pans');
  assert.equal(panTextOwnsPress({ ...press, pointerType: 'touch' }), false, 'a finger pans');
  assert.equal(panTextOwnsPress({ ...press, button: 1 }), false, 'middle button pans');
  assert.equal(panTextOwnsPress({ ...press, spaceHeld: true }), false, 'Space pans');
  assert.equal(panTextOwnsPress({ ...press, toolIsPan: false }), false);
});

test('a kept selection ends when the selection is gone', () => {
  assert.equal(resolvePanTextSelectionChange({ state: 'keep', selectionLive: false }), 'off');
  assert.equal(resolvePanTextSelectionChange({ state: 'keep', selectionLive: true }), 'keep');
  assert.equal(resolvePanTextSelectionChange({ state: 'on', selectionLive: false }), 'on');
});

test('the text layer is mounted under Pan only where a pointer can hover (not on a phone)', () => {
  assert.equal(shouldMountPanTextLayer({ toolIsPan: true, canHover: true }), true);
  assert.equal(shouldMountPanTextLayer({ toolIsPan: true, canHover: false }), false);
  assert.equal(shouldMountPanTextLayer({ toolIsPan: false, canHover: true }), false);
  assert.equal(deviceCanHover(null), false);
  assert.equal(deviceCanHover({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(deviceCanHover({ matchMedia: () => { throw new Error('x'); } }), false);
});

test('Pan and Text Select feed the text quick menu; other tools do not', () => {
  assert.equal(isTextSelectionCaptureTool('pan'), true);
  assert.equal(isTextSelectionCaptureTool('text-select'), true);
  for (const tool of ['select', 'pen', 'rect', 'eraser', 'text-highlight']) assert.equal(isTextSelectionCaptureTool(tool), false, tool);
});

test('text targets: glyph boxes only (not image stand-ins, not elsewhere)', () => {
  const el = (span) => ({ closest: () => span });
  const span = { getAttribute: () => null, classList: { contains: () => false } };
  assert.equal(isPanTextTarget(el(span)), true);
  assert.equal(isPanTextTarget({ nodeType: 3, parentElement: el(span) }), true);
  assert.equal(isPanTextTarget(el({ getAttribute: (n) => (n === 'role' ? 'img' : null), classList: { contains: () => false } })), false);
  assert.equal(isPanTextTarget(el(null)), false);
  assert.equal(isPanTextTarget(null), false);
  const inLayer = { nodeType: 3, parentElement: { closest: (s) => (s === '.pdfjsTextLayer' ? {} : null) } };
  assert.equal(hasLivePdfTextSelection({ isCollapsed: false, rangeCount: 1, anchorNode: inLayer }), true);
  assert.equal(hasLivePdfTextSelection({ isCollapsed: true, rangeCount: 1, anchorNode: inLayer }), false);
  assert.equal(hasLivePdfTextSelection({ isCollapsed: false, rangeCount: 1, anchorNode: { nodeType: 1, closest: () => null } }), false);
  assert.equal(hasLivePdfTextSelection(null), false);
});

test('wiring: the viewer, the pan press, the text layer and the quick menu follow the rule', () => {
  // PDFViewer mounts the layer under Pan on hover devices and lets Pan's
  // selection reach the quick menu (Copy, Highlight, Underline...).
  assert.match(VIEWER, /panTextHoverSelect=\{shouldMountPanTextLayer\(\{ toolIsPan: activeTool === 'pan', canHover: deviceCanHover\(\) \}\)\}/);
  assert.match(VIEWER, /if \(!isTextSelectionCaptureTool\(activeToolRef\.current\)\) return null;/);
  assert.match(VIEWER, /selection=\{isTextSelectionCaptureTool\(activeTool\) && !selectedTextMarkupActionSelection/);
  // The pan press yields to text only through the pure rule, before it pans.
  assert.match(CONTAINER, /const onPointerDown = \(event\) => \{\s*\/\/ Pan over text[^\n]*\n\s*if \(panTextOwnsPress\(\{/);
  assert.match(CONTAINER, /window\.setTimeout\(\(\) => \{[\s\S]{0,120}setState\('on'\);[\s\S]{0,40}\}, PAN_TEXT_HOVER_MS\);/);
  assert.match(CONTAINER, /panHover=\{panTextHoverSelect && !textSelectionLayerActive\}/);
  // The no-select rule still covers Pan / Space, except while text mode is live.
  assert.match(CONTAINER, /:is\(\[data-space-pan='armed'\], \[data-space-pan='dragging'\]\):not\(\[data-pan-text\]\) :not\(input/);
  assert.match(CONTAINER, /const noSelect = armed && panTextStateRef\.current === 'off';/);
  // An iPad with a trackpad: the touch surface's selectstart guard lets it through.
  assert.match(CONTAINER, /if \(event\.type === 'selectstart' && panTextStateRef\.current === 'on'\) return;/);
  // The text layer: glyph boxes take the hover; the I-beam and selection only in text mode.
  assert.match(TEXT_LAYER, /\.pdfjsTextLayer\.is-pan-text :is\(span, br\) \{ pointer-events: auto; \}/);
  assert.match(TEXT_LAYER, /\[data-pan-text='on'\] \.pdfjsTextLayer\.is-pan-text \{ pointer-events: auto; \}/);
  assert.match(TEXT_LAYER, /:is\(\[data-pan-text='on'\], \[data-pan-text='keep'\]\) \.pdfjsTextLayer\.is-pan-text :is\(span, br\) \{ -webkit-user-select: text !important; user-select: text !important; \}/);
  // Selection capture reads Pan's layer as well as Text Select's.
  assert.match(MARKUP, /querySelectorAll\('\.pdfjsTextLayer\.is-interactive, \.pdfjsTextLayer\.is-pan-text'\)/);
});

test('a press is handed to text selection only on a glyph, and scrolling drops the I-beam (Codex #832)', () => {
  const src = read('../src/components/PdfjsViewerContainer.jsx');
  // The text layer root takes presses while the I-beam shows; its blank part must still pan.
  assert.match(src, /onTextLayer: isPanTextTarget\(event\.target\),/);
  assert.doesNotMatch(src, /onTextLayer: Boolean\(event\.target\?\.closest\?\.\('\.pdfjsTextLayer'\)\)/);
  // Scroll / zoom under a still pointer: back to off (or keep), never mid-press.
  assert.match(src, /const onScroll = \(\) => \{\s*if \(press \|\| panTextStateRef\.current !== 'on'\) return;[\s\S]{0,160}setState\(hasLivePdfTextSelection\(window\.getSelection\?\.\(\)\) \? 'keep' : 'off'\);/);
  assert.match(src, /el\.addEventListener\('scroll', onScroll, \{ passive: true \}\);/);
  assert.match(src, /el\.removeEventListener\('scroll', onScroll\);/);
});
