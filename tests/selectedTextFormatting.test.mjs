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
  readCalloutTextStyle,
  readTextboxTextStyle,
} from '../src/utils/selectedTextFormatting.js';
import { composeTextColor } from '../src/utils/textColorOpacity.js';

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
  assert.match(viewer, /const selectedTextTarget = \(activeTool === 'select' && !richTextEditor\)/);
  assert.match(viewer, /selectedTextTargetRef\.current = selectedTextTarget;/);
  // The write goes to the selected callout / text box through the phased save
  // pipeline (one undo step per colour drag); armed, it is still the defaults.
  const handler = viewer.slice(
    viewer.indexOf('const handleTextStyleSourceChange = useCallback('),
    viewer.indexOf('const handleTextStyleSourceChange = useCallback(') + 900,
  );
  assert.match(handler, /if \(!target\) \{\s*setTextStyleDefaults\(next\);/);
  assert.match(handler, /runWithPaintPhase\(options, \(\) => \{/);
  assert.match(handler, /handlePatchSelectedCallout\(patch\)/);
  assert.match(handler, /handlePatchSelectedAnnotation\(patch\)/);
});

test('the drag phase reaches the save pipeline from every text colour picker', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /const patch = \(fields, meta\) => api\.onTextStyleDefaultsChange\(\{ \.\.\.defaults, \.\.\.fields \}, meta\);/);
  assert.match(shell, /setFontColor: \(hex, meta\) => patch\(\{ fontColor: hex \}, meta\)/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const updateTextDefaults = \(patch, meta\) => api\.onTextStyleDefaultsChange\?\.\(\{ \.\.\.textDefaults, \.\.\.patch \}, meta\);/);
  assert.match(mobile, /onChange: \(hex, alpha, meta\) => updateTextDefaults\(\{/);
  assert.match(mobile, /onChange=\{\(hex, alpha, meta\) => editorApi\.setFontColor\?\.\(/);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /if \(patch\) onCalloutTextStyleChange\(reactCalloutId, patch, meta\);/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleCalloutTextStyleChange = useCallback\(\(calloutId, stylePatch, options\) => \{/);
  assert.match(viewer, /runWithPaintPhase\(options, \(\) => handleCalloutTextStyleChange\(calloutId, stylePatch\)\);/);
});

test('leaving the callout editor keeps the text style changed during the edit', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /c\.id === editingAnnotation\.reactCalloutId\s*\?\s*\{ \.\.\.updatedReactCallout, style: c\.style \|\| updatedReactCallout\.style \}\s*:\s*c/,
  );
});
