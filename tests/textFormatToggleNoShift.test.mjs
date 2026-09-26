// w43 (2026-09-26, owner report): clicking the tool bar's "Aa" moved other
// items in the bar. Aa must ONLY show or hide the text-formatting bar and put
// the caret in the text; nothing in the main bar may move or resize.
//
// Root cause measured in the live app at 1280px: clicking Aa while a text box
// was open for typing closed the editor (the click counted as a click-away),
// and the row laid out differently for an open box than for a picked one - the
// rule after the colour swatch only stood when the box was NOT open, so every
// setting to its right slid 11px. The live x-position measurement lives in
// scripts/verify-text-toggle-no-shift.mjs; this file pins the pieces of the
// contract that can be checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  showsColourRule,
  showsPaintSwatch,
  showsQuickColourDots,
} from '../src/utils/toolbarColourGroup.js';

const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const textEditOverlay = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');

const editorBridge = { api: {}, state: {} };
const api = (contextTool, extra = {}) => ({
  activeTool: 'select',
  contextTool,
  handleFillColorChange: () => {},
  ...extra,
});

test('the colour group reads the same whether a text box or callout is open, picked or armed', () => {
  for (const tool of ['text', 'callout']) {
    const states = {
      armed: api(tool, { activeTool: tool }),
      picked: api(tool),
      editing: api(tool, { richTextEditor: editorBridge }),
    };
    const shape = (a) => ({
      dots: showsQuickColourDots(a),
      swatch: showsPaintSwatch(a),
      rule: showsColourRule(a, true),
    });
    const picked = shape(states.picked);
    assert.deepEqual(shape(states.editing), picked, `${tool}: editing vs picked`);
    assert.deepEqual(shape(states.armed), picked, `${tool}: armed vs picked`);
    assert.equal(picked.rule, true, `${tool}: the swatch is closed off by its rule`);
  }
});

test('the rule after the colour group follows every colour control, and nothing else', () => {
  // Dot tools: dots + rule.
  assert.equal(showsColourRule(api('pen')), true);
  // Swatch tools with no resolved paint draw no swatch and so no rule.
  assert.equal(showsColourRule(api('rect', { richTextEditor: editorBridge }), false), false);
  // The eraser has no colour at all.
  assert.equal(showsColourRule(api('rect', { activeTool: 'eraser' })), false);
  assert.equal(showsColourRule(null), false);
});

test('Aa only toggles the bar: its label, size and the main row never depend on the toggle', () => {
  const start = appShell.indexOf("toolbarSlot('aa'");
  assert.ok(start > 0, 'the Aa slot exists');
  const button = appShell.slice(start, appShell.indexOf('</button>', start));
  // Fixed label; the only style that follows the toggle is its colour.
  assert.match(button, />\s*Aa\s*$/);
  const styleBlock = button.slice(button.indexOf('style={{'), button.indexOf('}}', button.indexOf('style={{')));
  const toggleDependent = styleBlock.split('\n').filter((line) => /showTextFormatting/.test(line));
  assert.deepEqual(toggleDependent.map((line) => line.trim().split(':')[0]), ['color']);
  // It opts out of the editor's click-away and keeps the caret in the text.
  assert.match(button, /data-rich-text-toolbar="true"/);
  assert.match(button, /if \(bottomToolbarApi\.richTextEditor\) e\.preventDefault\(\);/);
  assert.match(button, /editor\.api\?\.focus\?\.\(\)/);
  // The bar shows exactly when asked for - an open editor no longer forces it.
  assert.match(appShell, /const showTextFormatting = !!textFormatSource && showTextFormatBar;/);
  assert.doesNotMatch(appShell, /richTextEditor \|\| showTextFormatBar/);
});

test('the rich-text bridge can hand the caret back to the text', () => {
  assert.match(textEditOverlay, /focus: \(\) => editableRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});
