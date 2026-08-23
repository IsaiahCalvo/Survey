import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Counter Size (4–76, 8 presets) + Start number.
// Distinct from D-05 stroke Width. Live proof:
// debug/scenarios/e2e-counter-size-start.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell Counter Size uses COUNTER_SIZE 4–76 and Start locks after a second pin', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /ANNOTATION_SIZE_PRESETS\.counter/);
  assert.match(shell, /contextTool === 'counter' \? COUNTER_SIZE_MIN/);
  assert.match(shell, /COUNTER_SIZE_MAX/);
  assert.match(shell, /aria-label="Counter start number"/);
  assert.match(shell, /Start number is set after a second counter is added/);
  assert.match(shell, /selectedCounterSeriesSize !== 1/);
  assert.match(shell, /Math\.max\(1, Math\.floor\(Number\(event\.currentTarget\.value\) \|\| 1\)\)/);
  assert.match(shell, /replace\(\/\[\^0-9\]\/g, ''\)/);
});

test('Counter Start Escape restores the pre-edit value and skips blur commit', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /function CounterStartNumberField/);
  assert.match(shell, /skipCommitRef/);
  assert.match(shell, /valueAtFocusRef/);
  assert.match(shell, /if \(event\.key === 'Escape'\)/);
  assert.match(shell, /skipCommitRef\.current = true/);
  assert.match(shell, /event\.currentTarget\.value = valueAtFocusRef\.current \|\| committed/);
  assert.match(
    shell,
    /if \(skipCommitRef\.current\) \{\s*skipCommitRef\.current = false;\s*return;/s,
  );
  assert.match(shell, /if \(event\.key === 'Enter'\)/);
});

test('viewer patches selected counter radius + seriesStart; size catalog is not Width', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleSelectedCounterSeriesStartChange = useCallback\(\(value\) => \{/);
  assert.match(viewer, /if \(\(series\?\.count \|\| 0\) !== 1\) return;/);
  assert.match(viewer, /seriesStart: parsed/);
  assert.match(viewer, /displayNumber: parsed/);
  assert.match(viewer, /const newRadius = Math\.max\(4, Number\(width\) \|\| 14\)/);
  assert.match(viewer, /const isCounterSize = activeTool === 'counter' \|\| getSelectedShapeMeta\(\)\.isCounter/);
  assert.match(viewer, /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50/);

  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /counter: \[5, 8, 12, 16, 24, 32, 48, 64\]/);
  assert.match(size, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /tool === 'counter' \? COUNTER_SIZE_MIN/);
  assert.match(mobile, /ANNOTATION_SIZE_PRESETS\.counter/);
});
