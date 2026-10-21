import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

test('overflowing rail column gets scroll room so the last tool clears the fade and "more"', () => {
  assert.match(chrome, /setAttribute\('data-overflows', 'true'\)/);
  assert.match(chrome, /removeAttribute\('data-overflows'\)/);
  const rule = css.match(/\.mobile-pdf-tools__main\[data-overflows='true'\]\s*\{([^}]*)\}/);
  assert.ok(rule, 'data-overflows rule exists');
  const pad = Number(/padding-block-end:\s*(\d+)px/.exec(rule[1])?.[1]);
  assert.ok(pad >= 3 + 18, `bottom room ${pad}px must exceed the 18px fade`);
});

