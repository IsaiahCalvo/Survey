import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const controls = read('../src/mobile/MobileToolSheetControls.jsx');
const css = read('../src/mobile/mobilePdfViewer.css');
const overlay = read('../src/components/TextEditOverlay.jsx');

/*
 * Owner 2026-10-02, Test 19 (the pen's "..." -> settings sheet): "it doesn't look
 * like a designer built this ... have it be intentional". What the redesign
 * promised and must keep.
 */
test('the sheet is titled with the tool and says nothing it does not mean', () => {
  assert.doesNotMatch(chrome, /<span>Focused on/, 'no "Focused on Shape" line under the title');
  assert.match(chrome, /<header className="mobile-tool-sheet__header">\s*<strong>\{sheetTitle\}<\/strong>\s*<\/header>/);
  // A pen has one colour: no "Border" word unless the tool has two colours.
  assert.match(chrome, /const channelWord = hasFillSheet \? shapeSectionLabel\(shapeSection\) : '';/);
  // No raw hex line, no lone big swatch.
  assert.doesNotMatch(chrome, /large-swatch/);
});

test('the colour row is eight circles that fit the gutter, the last one custom', () => {
  const palette = /const MOBILE_ANNOTATION_COLORS = withQuickColoursFirst\(\[([\s\S]*?)\]\);/.exec(chrome)?.[1] || '';
  // 3 quick colours + this tail = 7 presets, + the custom cell = 8.
  assert.equal((palette.match(/'#[0-9a-fA-F]{6}'/g) || []).length, 4);
  assert.match(controls, /mobile-tool-sheet__custom/);
  assert.match(css, /\.mobile-tool-sheet__swatches \{[\s\S]{0,120}justify-content: space-between/);
  assert.match(css, /\.mobile-tool-sheet__swatch \{\s*width: 32px;\s*height: 32px;/);
});

test('no setting in the sheet opens a list outside it; width keeps its typed field', () => {
  assert.doesNotMatch(chrome, /<AnnotationSizeControl/);
  assert.match(chrome, /<SheetScaleSlider[\s\S]{0,200}ariaLabel=\{tool === 'counter' \? 'Counter size' : 'Line width'\}/);
  assert.match(controls, /if \(mixed && !event\.currentTarget\.value\.trim\(\)\) return;/);
  // Sliders keep the picker's drag contract: previews, then ONE commit.
  assert.match(controls, /onChange\(next, \{ phase: 'preview' \}\)/);
  assert.match(controls, /onChange\(next, \{ phase: 'commit' \}\)/);
});

test('every row is a 44px finger row on one label column', () => {
  assert.match(css, /\.mobile-tool-sheet__row \{[\s\S]{0,80}min-height: var\(--sheet-row-h\);[\s\S]{0,80}grid-template-columns: var\(--tool-sheet-label-w\)/);
  assert.match(css, /\.mobile-tool-sheet__seg > button::after \{[\s\S]{0,60}inset: -8px 0;/);
});

/*
 * Test 21: typing in a text box, the owner opened the colour sheet - every swatch
 * tap and every gradient / slider drag focused the text again, which raised the
 * keyboard over the sheet and moved the sheet under the finger.
 */
test('the phone colour and alignment sheets never refocus the text being edited', () => {
  assert.match(overlay, /if \(meta\?\.refocus === false\) return;\s*editableRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(chrome, /editorApi\.setFontColor\?\.\([\s\S]{0,140}\{ \.\.\.meta, refocus: false \},/);
  assert.match(chrome, /editorApi\.setTextAlign\?\.\(next, \{ refocus: false \}\)/);
  assert.match(chrome, /editorApi\.setVerticalAlign\?\.\(next, \{ refocus: false \}\)/);
  // A live edit that carries on never yanks its sheets away (no slide).
  assert.match(chrome, /const editContinues = wasLiveTextEditingRef\.current && liveTextEditing;/);
});
