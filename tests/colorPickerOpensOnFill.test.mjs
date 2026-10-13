// Owner 2026-10-02 (Test 16): Fill sits left of Border, and people read left
// to right, so the shape colour picker always opens on Fill.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('the shape colour picker opens on the Fill tab', () => {
  assert.match(shell, /const quickPaintTab = annotationPaint\?\.isShape \? 'fill' : annotationPaint\?\.quick\?\.tab;/);
  assert.doesNotMatch(shell, /setColorPickerTab\(annotationPaint\.quick\.tab\)/);
  // DELIBERATE CHANGE (2026-10-13, selection quick bar): the custom disc and
  // the combined swatch used to write this tab rule out once each; they (and
  // the quick bar's copies of them) now share ONE toggle, so the rule is
  // written once and every opener goes through it.
  assert.equal((shell.match(/setColorPickerTab\(annotationPaint\.isShape \? 'fill' : annotationPaint\.quick\.tab\)/g) || []).length, 1);
  assert.match(shell, /const toggleAnnotationColourPicker = \(\) => \{\s*if \(!annotationPaint \|\| !bottomToolbarApi\) return;\s*setColorPickerTab\(annotationPaint\.isShape \? 'fill' : annotationPaint\.quick\.tab\);/);
  assert.equal((shell.match(/onOpenPicker=\{toggleAnnotationColourPicker\}/g) || []).length, 1);
  assert.equal((shell.match(/onOpen=\{toggleAnnotationColourPicker\}/g) || []).length, 1);
  assert.equal((shell.match(/onOpenColourPicker=\{toggleAnnotationColourPicker\}/g) || []).length, 1);
});
