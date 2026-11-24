// Templates: a checklist line's delete x is quiet until you point at the
// line or Tab to it (KAL-652, batch 28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');

test('the checklist delete glyph rests quiet and turns red on row hover or keyboard focus', () => {
  const at = jsx.indexOf('aria-label="Delete item"');
  assert.ok(at > 0 && jsx.indexOf('className="hub-icon-btn is-danger te-item-delete"', at) - at < 300, 'the row delete wears the quiet class');
  assert.match(css, /\.te-item-delete\.hub-icon-btn\.is-danger \{ color: var\(--text-3\); \}/);
  assert.match(css, /\[data-drag-rearrange-row\]:hover \.te-item-delete\.hub-icon-btn\.is-danger \{ color: var\(--danger\); \}/);
  assert.match(css, /\.te-item-delete\.hub-icon-btn\.is-danger:focus-visible \{ color: var\(--danger\); \}/);
});
