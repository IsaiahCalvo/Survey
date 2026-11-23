import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../src/library/LibraryScreen.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/library/library.css', import.meta.url), 'utf8');

// KAL-652: each Library row had three bordered buttons (Add type, Rename,
// Remove). Rows now match the Templates Category rows: name, count, one More.
test('Library rows carry one More menu, not three bordered buttons', () => {
  assert.doesNotMatch(screen, />Add type<\/button>/);
  assert.doesNotMatch(screen, /className="btn"[^>]*>Rename</);
  assert.match(screen, /className="hub-icon-btn library-row__more"/);
  assert.match(screen, /label: 'Add Category Type', icon: 'plus'/);
  // A Company entry a member can't change still explains why, on the row.
  assert.match(screen, /\{ label: 'Rename', reason: refusal \|\| undefined/);
  assert.match(screen, /\{ label: 'Remove', danger: true, reason: refusal \|\| undefined/);
  assert.match(screen, /onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); openMenu\(entry/);
  assert.match(screen, /<ListItemContextMenu point=\{menu\.point\}/);
});

test('Library section head and rows wear the Templates look', () => {
  assert.match(screen, /hub-section-label[^>]*>Categories<span className="hub-section-count">\{outline\.length\}<\/span>/);
  assert.match(screen, /<SectionIconButton action="add" label="Add Category"/);
  assert.match(css, /\.library-card__head \.hub-section-label \{ font-size: 11px; font-weight: 600; color: var\(--text-3\); \}/);
  assert.match(css, /\.library-row__name \{ flex: 1; min-width: 0; font-weight: 500;/);
  assert.match(css, /@media \(hover: hover\) \{\n  \.library-row:hover \{ background: var\(--hover\); \}/);
  assert.match(css, /\.library-row__more::after \{ content: ''; position: absolute; inset: -8px; \}/);
});
