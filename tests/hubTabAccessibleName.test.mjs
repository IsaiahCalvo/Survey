// The phone hides each Pages / Search / Bookmarks tab's word (display: none),
// so the button must carry its own aria-label or a screen reader hears nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

test('hub tab buttons are named even when the phone hides their word', () => {
  assert.match(css, /\.mobile-pdf-hub-tab > span \{ display: none !important; \}/);
  assert.match(src, /mobile-pdf-hub-tab\$\{isActive[\s\S]{0,400}?aria-label=\{tab\.label\}/);
});
