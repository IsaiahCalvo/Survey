import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Polish round 6: the "?" sheet promised "B  Toggle sidebar", but no handler
// for B exists (the click-every-control walkthrough pressed it: nothing). If B
// ever gets a handler, put the row back and delete this test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = readFileSync(path.join(root, 'src/components/KeyboardShortcutsOverlay.jsx'), 'utf8');

test('the shortcuts sheet does not list a B shortcut', () => {
  assert.doesNotMatch(overlay, /keys:\s*\[\s*'B'\s*\]/);
});

test('…and indeed nothing in the app handles a bare B key', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === 'prototype' || name === 'dev' ? [] : walk(p);
    return /\.(jsx?|mjs)$/.test(name) ? [p] : [];
  });
  const hits = walk(path.join(root, 'src')).filter((file) => (
    /(?:\.key|key)\s*(?:\.toLowerCase\(\))?\s*===\s*['"][bB]['"]|code\s*===\s*['"]KeyB['"]/.test(readFileSync(file, 'utf8'))
  ));
  assert.deepEqual(hits, []);
});

// The ?testPdf dev route rendered a second sheet next to App's own, so "?"
// opened two stacked sheets and Escape closed only the top one.
test('the dev test route does not mount a second shortcuts sheet', () => {
  const route = readFileSync(path.join(root, 'src/DevTestRoute.jsx'), 'utf8');
  assert.doesNotMatch(route, /<KeyboardShortcutsOverlay/);
});
