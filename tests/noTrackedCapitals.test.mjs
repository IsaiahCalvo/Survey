// Owner 2026-10-02: section labels use the interface font in sentence case,
// "not tracked monospace capitals". The 2026-10-27 dialog round dropped the
// capitals from dialogs, but the launch audit (2026-10-30) still found them in
// Settings (FIRST NAME, EMAIL), Print, Keyboard shortcuts, the pinned-tools
// menu, the phone sheets and three viewer menus. One rule now, everywhere:
// no text-transform: uppercase. Write labels in sentence case instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// The old per-page edit modal inside the high-risk per-page layer (CLAUDE.md:
// touch it only when a task needs it); left alone rather than edited for looks.
const ALLOWED = new Set(['src/PageAnnotationLayer.jsx']);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'prototype') files(path, out); }
    else if (/\.(jsx|css)$/.test(name)) out.push(path);
  }
  return out;
}

test('no label is drawn in tracked capitals', () => {
  const offenders = [];
  for (const path of files(join(root, 'src'))) {
    const rel = relative(root, path);
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(path, 'utf8');
    if (/text-transform:\s*uppercase|textTransform:\s*['"]uppercase['"]/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});
