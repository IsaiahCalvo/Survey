// Owner 2026-10-06: a mode toggle's Done check sits on a round disc (circle won
// the circle-vs-square debate), desktop and phone, from the one shared rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/components/SectionIconButton.css', import.meta.url), 'utf8');

test('Done check sits on a round disc, sized per platform', () => {
  assert.match(css, /\.section-icon-btn\.is-active::before \{[\s\S]*?width: 24px;[\s\S]*?border-radius: 50%;[\s\S]*?background: var\(--surface-3\);/);
  assert.match(css, /\.section-icon-btn\.is-active\.is-phone::before \{\s*width: 32px;\s*height: 32px;/);
  assert.match(css, /\.section-icon-btn\.is-active > svg \{[\s\S]*?z-index: 1;/);
});
