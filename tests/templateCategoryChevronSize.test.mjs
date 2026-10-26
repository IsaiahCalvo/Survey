// The desktop template-category chevron renders the shared 18px
// CategoryDisclosureGlyph box (same as the phone row); a 16px stylesheet
// override had shrunk it below the hub's other disclosure carets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('desktop category chevron glyph is 18px', () => {
  const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');
  assert.match(css, /\.tpl-cat-chevron > svg \{ width: 18px; height: 18px; \}/);
  const jsx = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /const CategoryDisclosureGlyph = \(\) => \(\s*<Icon name="chevronRight" size=\{18\}/);
});
