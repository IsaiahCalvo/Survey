// Owner issue note 2026-10-26, batch B (pickers and sub-toolbars):
//  #4  a picked or armed text box / callout shows its REGULAR settings; "Aa"
//      swaps the text settings into the same row in their place.
//  #11 the Arrowhead and Arrow ends pills are one pill. (The Style and arrow
//      pickers were cards; owner 2026-10-28, "a little simpler", made them
//      plain lists whose rows draw their line.)
//  #13 Set page scale is the app's dialog card with chips, not native selects.
//  #18 the Layers panel's PDF strength is five steps, not a slider.
//  #33 the Width pill carries no stroke drawing (it cut the number off).
// The live checks are in tests/e2e-signed-in/pickers-and-subtoolbars.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appShell = read('../src/AppShell.jsx');
const viewer = read('../src/PDFViewer.jsx');

test('#4 the text settings start hidden and swap in place of the regular ones', () => {
  assert.match(appShell, /const \[showTextFormatBar, setShowTextFormatBar\] = useState\(false\);/);
  assert.match(appShell, /const textSettingsSwapped = showTextFormatting && !surveyRowShown;/);
  // Every settings slot but Aa steps aside, and so does the colour group.
  assert.match(appShell, /if \(textSettingsSwapped && id !== 'aa'\) return null;/);
  assert.match(appShell, /bottomToolbarApi\.activeTool !== 'eraser' && !textSettingsSwapped && \(/);
  // A different pick (not opening the same one for typing) starts regular again.
  assert.match(viewer, /textFormatTargetKey: selectedTextTarget\?\.key \?\? null,/);
  assert.match(appShell, /if \(textFormatTargetKey && textFormatTargetKey !== lastTextFormatTargetRef\.current\)/);
});

test('#33 no size pill draws a stroke before its number', () => {
  const start = appShell.indexOf("toolbarSlot('width'");
  const widthPill = appShell.slice(start, appShell.indexOf('</AnnotationSizeControl>', start) > 0 ? appShell.indexOf('/>\n                ), {', start) : start + 4000);
  assert.doesNotMatch(widthPill, /\bpreview=\{/);
  const marker = viewer.slice(viewer.indexOf('label="Freehand marker width"'), viewer.indexOf('label="Freehand marker width"') + 800);
  assert.doesNotMatch(marker, /\bpreview=\{/);
});

test('#11 one arrow pill: heads in one list with a Both ends switch, "Filled" not a second "Solid"', () => {
  assert.doesNotMatch(appShell, /toolbarSlot\('ends'/);
  // Owner 2026-10-28 ("a little simpler"): plain lists, not cards.
  assert.doesNotMatch(appShell, /<ArrowEndsCard|<LineStyleCard/);
  assert.match(appShell, /data-arrow-both-ends="true"/);
  assert.match(appShell, /onClick=\{\(\) => setEnds\(both \? 'end' : 'both'\)\}/);
  assert.match(read('../src/components/Callout/types.js'), /\[ARROWHEAD_STYLES\.SOLID_TRIANGLE\]: 'Filled',/);
  // Line widths' quick picks are lines; round sizes keep their dots.
  assert.match(read('../src/components/AnnotationSizeControl.jsx'), /previewShape === 'dot'\s*\? <span style=\{\{ width: `\$\{size\}px`/);
});

test('#13 Set page scale has no native select and keeps its touch sizes', () => {
  const dialog = read('../src/components/MeasureScaleDialog.jsx');
  assert.doesNotMatch(dialog, /<select/);
  assert.match(dialog, /useFocusTrap\(cardRef, true, \{ onEscape: onCancel \}\)/);
  assert.match(read('../src/components/MeasureScaleDialog.css'), /min-height: 44px/);
});

test('#18 the Layers panel has no slider', () => {
  const layers = read('../src/sidebar/LayersPanel.jsx');
  assert.doesNotMatch(layers, /type="range"/);
  assert.match(layers, /const PDF_OPACITY_STEPS = \[\[100, '100%'\], \[75, '75%'\], \[50, '50%'\], \[25, '25%'\], \[0, 'Off'\]\];/);
});

test('the scale dialog moves focus with arrow keys', () => {
  const keys = read('../src/utils/radioGroupKeys.js');
  assert.match(keys, /ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1/);
  // The Style and Arrow ends lists move with the arrow keys as every
  // AnnotationDropdown list does (checked live in the e2e spec).
  for (const file of ['../src/components/MeasureScaleDialog.jsx']) {
    const src = read(file);
    const groups = src.match(/role="radiogroup"[^>]*>/g) || [];
    assert.ok(groups.length > 0, file);
    for (const group of groups) assert.match(group, /onKeyDown=\{moveGroupFocus\}/, file);
  }
});
