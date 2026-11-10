import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

// Phone held sideways: the rail is ~250px tall. Owner rule (2026-10-01):
// scroll rather than compress, and the scroll box must stop at the dock.
test('short landscape phone: the whole rail scrolls and ends at the dock', () => {
  const start = css.indexOf('@media (orientation: landscape) and (max-height: 500px)');
  assert.ok(start >= 0, 'landscape rail rule is missing');
  const block = css.slice(start, start + 1600);
  assert.match(block, /\.mobile-pdf-tools\s*\{[^}]*height:\s*calc\(100% - var\(--mobile-viewer-dock-height\)\)/);
  assert.match(block, /\.mobile-pdf-tools\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(block, /\.mobile-pdf-tools__main\s*\{[^}]*flex:\s*none/);
  assert.match(block, /\.mobile-pdf-tools__footer\s*\{[^}]*flex:\s*none/);
});
