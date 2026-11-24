// KAL-652 batch 35: Settings > Annotations. The first section held Snapping,
// Shift snap angle and Units under a "Snapping" heading that repeated the row
// below it; it is now "Drawing", and the Snapping hint is whole sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');

test('the Annotations tab opens with a Drawing section, not a second Snapping', () => {
  const start = jsx.indexOf("activeTab === 'annotations' && (");
  const head = jsx.slice(start, start + 400);
  assert.match(head, /<h3>Drawing<\/h3>/);
  assert.doesNotMatch(head, /<h3>Snapping<\/h3>/);
});

test('the Snapping hint has no sentence fragment', () => {
  assert.doesNotMatch(jsx, /Also the magnet button beside the page controls, or Shift\+S\./);
  assert.match(jsx, /The magnet button beside the page controls, or Shift\+S, also turns it on and off\./);
});
