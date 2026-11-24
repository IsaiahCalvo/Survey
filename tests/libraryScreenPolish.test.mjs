// KAL-652 batch 20: the Library screen's switch, empty state and note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../src/library/LibraryScreen.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/library/library.css', import.meta.url), 'utf8');

test('My library / Company library is one switch, the chosen side on the selected fill', () => {
  assert.match(screen, /role="tablist" aria-label="Library" className="library-tabs"/);
  assert.match(screen, /className="library-tabs__tab"/);
  assert.doesNotMatch(screen, /btn\$\{scope === key \? ' primary' : ''\}/);
  assert.match(css, /\.library-tabs__tab\[aria-selected='true'\] \{ background: var\(--surface-3\);/);
  assert.match(css, /\.library-tabs__tab:hover \{ background: var\(--hover\);/);
});

test('an empty library shows the shared empty state, only once the server has answered', () => {
  assert.match(screen, /<EmptyState\s+icon="library"/);
  assert.match(screen, /line: 'Nothing in the Company library yet'/);
  assert.match(screen, /line: 'Your library is empty'/);
  assert.match(screen, /outline\.length === 0 \? \(!checked \? null :/);
});

test('the not-linked note uses the theme line, not the old ink step', () => {
  assert.match(screen, /className="card library-note" role="status"/);
  assert.doesNotMatch(screen, /--ink-500/);
  assert.doesNotMatch(css, /--ink-500/);
});
