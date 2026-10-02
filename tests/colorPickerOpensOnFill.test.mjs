// Owner 2026-10-02 (Test 16): Fill sits left of Border, and people read left
// to right, so the shape colour picker always opens on Fill.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('the shape colour picker opens on the Fill tab', () => {
  assert.match(shell, /const quickPaintTab = annotationPaint\?\.isShape \? 'fill' : annotationPaint\?\.quick\?\.tab;/);
  assert.doesNotMatch(shell, /setColorPickerTab\(annotationPaint\.quick\.tab\)/);
  assert.equal((shell.match(/setColorPickerTab\(annotationPaint\.isShape \? 'fill' : annotationPaint\.quick\.tab\)/g) || []).length, 2);
});
