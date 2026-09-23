/*
 * UX 2026-09-23 (owner: "text color opacity must exist everywhere text color
 * can be picked"). Text colour carries its opacity in the one stored colour
 * string; these tests pin the helpers and the places that pick text colour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { composeTextColor, isTextColorValue, splitTextColor } from '../src/utils/textColorOpacity.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('an opaque text colour stays a plain hex, so untouched text never changes', () => {
  assert.equal(composeTextColor('#1e293b', 1), '#1e293b');
  assert.equal(composeTextColor('#1E293B', 1.2), '#1E293B');
  assert.deepEqual(splitTextColor('#1e293b'), { hex: '#1e293b', opacity: 1 });
  assert.deepEqual(splitTextColor('#abc'), { hex: '#aabbcc', opacity: 1 });
});

test('a see-through text colour round-trips through rgba()', () => {
  assert.equal(composeTextColor('#1e293b', 0.4), 'rgba(30, 41, 59, 0.4)');
  assert.deepEqual(splitTextColor('rgba(30, 41, 59, 0.4)'), { hex: '#1e293b', opacity: 0.4 });
  assert.deepEqual(splitTextColor('rgb(255, 0, 0)'), { hex: '#ff0000', opacity: 1 });
  assert.equal(composeTextColor(splitTextColor('rgba(30, 41, 59, 0.55)').hex, 0.55), 'rgba(30, 41, 59, 0.55)');
  // Anything unreadable falls back rather than throwing.
  assert.deepEqual(splitTextColor('not a colour', '#000000'), { hex: '#000000', opacity: 1 });
});

test('the live text editor accepts a colour with opacity', () => {
  assert.equal(isTextColorValue('#1e293b'), true);
  assert.equal(isTextColorValue('rgba(30, 41, 59, 0.4)'), true);
  assert.equal(isTextColorValue('rgba(30, 41, 59, 1)'), true);
  assert.equal(isTextColorValue('url(javascript:alert(1))'), false);
  assert.equal(isTextColorValue('red; background: x'), false);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /setFontColor: \(c\) => applyStyle\('fill', isTextColorValue\(c\) \? c : '#000000'\)/);
});

test('every text colour picker shows and writes opacity', () => {
  const shell = read('src/AppShell.jsx');
  // Desktop text bar: the picker opens on the text's own opacity and writes it.
  assert.match(shell, /color=\{textColorParts\.hex\}\s*opacity=\{textColorParts\.opacity\}/);
  assert.match(shell, /setFontColor\?\.\(composeTextColor\(hex, nextAlpha\)\)/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  // Phone: the live Font color sheet and the Text settings colour sheet.
  const live = mobile.slice(mobile.indexOf("colorPicker === 'fontColorLive' && ("), mobile.indexOf("colorPicker === 'fontColorLive' && (") + 1200);
  assert.doesNotMatch(live, /showOpacity=\{false\}/);
  assert.match(live, /opacity=\{splitTextColor\(state\.fontColor\)\.opacity\}/);
  const defaults = mobile.slice(mobile.indexOf("title: 'Text color'"), mobile.indexOf("title: 'Text color'") + 700);
  assert.match(defaults, /showOpacity: true/);
  assert.match(defaults, /composeTextColor\(hex,/);
});
