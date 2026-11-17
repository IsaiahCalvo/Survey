import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');

function menuLabels(anchor) {
  const at = src.indexOf(anchor);
  const end = src.indexOf(']}', at);
  return [...src.slice(at, end).matchAll(/\{ label: '([^']+)'/g)].map((m) => m[1]);
}

test('template editor ⋮ menus share one order: Rename first, Delete last', () => {
  const want = ['Rename', 'Duplicate', 'Move', 'Copy', 'Share', 'Delete'];
  for (const anchor of ['anchorRect={tplMenu.rect}', 'anchorRect={entityMenu.rect}', 'anchorRect={catMenu.rect}', 'anchorRect={modMenu.rect}']) {
    if (!src.includes(anchor)) continue;
    const got = menuLabels(anchor);
    assert.deepEqual(got, want.filter((l) => got.includes(l)), anchor);
  }
});

test('a module tab shows a press with no inner block behind its label', () => {
  const css = readFileSync(new URL('../src/home/TemplatesEditor.css', import.meta.url), 'utf8');
  assert.match(css, /\.ed-scope \[data-module-tab-id\]:not\(\[data-drag-lifted\]\):active \{\s*background: var\(--pressed\) !important;/);
  assert.match(css, /\.ed-scope \[data-module-tab-id\]:active > button \{ background: transparent !important; \}/);
});
