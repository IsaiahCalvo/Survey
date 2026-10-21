import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

test('phone: the viewer top reserve is drawn so a tool settings strip never pushes the sheet', () => {
  const at = appShell.indexOf('data-viewer-top-reserve="true"');
  assert.ok(at > 0, 'reserve strip exists');
  const style = appShell.slice(at, at + 900);
  assert.match(style, /display: isViewerVisible \? 'block' : 'none'/, 'reserve is shown on phone too');
  assert.match(style, /height: isMobileViewer \? '44px' : 'calc\(var\(--chrome-bar-h\) \+ 1px\)'/);
});

test('phone: reserve height matches the mobile tool settings strip', () => {
  const block = css.match(/\n\.mobile-pdf-properties \{[^}]*\}/);
  assert.ok(block, '.mobile-pdf-properties rule found');
  assert.match(block[0], /\bheight: 44px;/);
});
