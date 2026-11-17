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
