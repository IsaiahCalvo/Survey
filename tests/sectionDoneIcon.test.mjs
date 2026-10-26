// Owner 2026-10-26: a mode toggle's Done is Lucide check-check, bare like the
// other header icons - not a check on a round disc (the 2026-10-06 look), and
// never an X.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/components/SectionIconButton.css');
const component = read('src/components/SectionIconButton.jsx');
const icons = read('src/Icons.jsx');

test('Done is the check-check glyph', () => {
  assert.match(component, /export const SECTION_DONE_ICON = 'checkCheck';/);
  assert.match(icons, /checkCheck: \(size, color, style, className\) =>[\s\S]*?d="M18 6L7 17L2 12"[\s\S]*?d="M22 10L14\.5 17\.5L13 16"/);
});

test('Done has no disc or plate behind it', () => {
  assert.doesNotMatch(css, /\.section-icon-btn\.is-active[^{]*::before/);
  assert.doesNotMatch(css, /\.section-icon-btn\.is-active[^{]*\{[^}]*background/);
  assert.match(css, /\.section-icon-btn\.is-active \{\s*color: var\(--text-1\);\s*\}/);
});
