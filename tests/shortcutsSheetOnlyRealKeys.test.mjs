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

test('the sheet close button has a name (it was an unlabeled X)', () => {
  assert.match(overlay, /aria-label="Close keyboard shortcuts"/);
});

// KAL-444 (2026-10-13): every row was pressed in the viewer. These did nothing
// there, so they left the sheet (adding real tab keys is an owner call).
test('the sheet does not promise tab keys nothing handles', () => {
  assert.doesNotMatch(overlay, /description: 'Close tab'/);
  assert.doesNotMatch(overlay, /description: 'Next tab'/);
  assert.doesNotMatch(overlay, /description: 'Previous tab'/);
  const handlesCtrlTab = (file) => /ctrlKey[^\n]*['"]Tab['"]|['"]Tab['"][^\n]*ctrlKey/.test(file);
  const viewer = readFileSync(path.join(root, 'src/PDFViewer.jsx'), 'utf8');
  const shell = readFileSync(path.join(root, 'src/AppShell.jsx'), 'utf8');
  assert.equal(handlesCtrlTab(viewer) || handlesCtrlTab(shell), false, 'a Ctrl+Tab handler exists now: put the rows back');
});

test('arrows are not sold as page turns while the viewer is always continuous', () => {
  assert.doesNotMatch(overlay, /keys: \['←', '→'\]/);
  const viewer = readFileSync(path.join(root, 'src/PDFViewer.jsx'), 'utf8');
  assert.match(viewer, /if \(scrollMode !== 'continuous'\) \{\s*setScrollMode\('continuous'\)/);
});

test('lasso Space is described as the two modes it flips', () => {
  assert.match(overlay, /Switch between Window and Crossing/);
  const hook = readFileSync(path.join(root, 'src/hooks/useSVGInteraction.js'), 'utf8');
  assert.match(hook, /const nextMode = activeMode === 'window' \? 'crossing' : 'window';/);
});

test('Open document shows only where the desktop menu wires Ctrl/Cmd+O', () => {
  assert.match(overlay, /hasDesktopOpenKey \? \[\{ keys: \[mod, 'O'\]/);
  const main = readFileSync(path.join(root, 'src/electron-main.js'), 'utf8');
  assert.match(main, /accelerator: 'CmdOrCtrl\+O'/);
});
