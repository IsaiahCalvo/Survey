// Owner 2026-10-26: dragging a module tab stretched and squashed its label.
// dnd-kit's CSS.Transform carries the scaleX / scaleY it computes for items
// of different widths; a drag should only move, so every sortable here uses
// CSS.Translate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : [];
});

test('no drag uses CSS.Transform (it scales the item)', () => {
  const offenders = walk(path.join(ROOT, 'src'))
    .filter((file) => /CSS\.Transform\.toString\(/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(offenders, []);
});
