import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const VIEWER_SOURCE = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);
const APP_SHELL_SOURCE = readFileSync(
  new URL('../src/AppShell.jsx', import.meta.url),
  'utf8',
);
const START_FIELD_SOURCE = readFileSync(
  new URL('../src/components/CounterStartNumberField.jsx', import.meta.url),
  'utf8',
);

test('selected counter colors route through the series update contract', () => {
  assert.match(VIEWER_SOURCE, /const handleCounterGroupUpdateRef = useRef\(null\);/);
  assert.match(
    VIEWER_SOURCE,
    /handleCounterGroupUpdateRef\.current\?\.\(annotation\.data\.seriesId, \{ fill: rgba \}\);/,
  );
  assert.match(
    VIEWER_SOURCE,
    /handleCounterGroupUpdateRef\.current\?\.\(annotation\.data\.seriesId, \{ numberColor: rgba \}\);/,
  );
  assert.match(
    VIEWER_SOURCE,
    /handleCounterGroupUpdateRef\.current = handleCounterGroupUpdate;/,
  );
});

test('counter start is published and remains editable only for a one-pin series', () => {
  assert.match(
    VIEWER_SOURCE,
    /if \(\(series\?\.count \|\| 0\) !== 1\) return;/,
  );
  assert.match(
    VIEWER_SOURCE,
    /handleCounterGroupUpdateRef\.current\?\.\(seriesId, \{ seriesStart: parsed \}\);/,
  );
  assert.match(VIEWER_SOURCE, /selectedCounterSeriesId,/);
  assert.match(
    VIEWER_SOURCE,
    /selectedCounterSeriesSize: selectedCounterSeries\?\.count \|\| 0,/,
  );
  assert.match(
    VIEWER_SOURCE,
    /onSelectedCounterSeriesStartChange: handleSelectedCounterSeriesStartChange,/,
  );

  assert.match(
    APP_SHELL_SOURCE,
    /const startLocked = bottomToolbarApi\.selectedCounterSeriesSize !== 1;/,
  );
  assert.match(APP_SHELL_SOURCE, /<CounterStartNumberField/);
  assert.match(APP_SHELL_SOURCE, /locked=\{startLocked\}/);

  // Shared field (desktop + 390) maps locked → native disabled. The
  // pre-extract inline input used disabled={startLocked} on AppShell.
  assert.match(START_FIELD_SOURCE, /disabled=\{locked\}/);
  assert.match(START_FIELD_SOURCE, /aria-label="Counter start number"/);
});

test('counter Size clamps to a radius of at least four', () => {
  assert.match(
    VIEWER_SOURCE,
    /const newRadius = Math\.max\(4, Number\(width\) \|\| 14\);/,
  );
  assert.match(
    VIEWER_SOURCE,
    /const COUNTER_RADIUS = Math\.max\(4, Number\(strokeWidth\) \|\| 14\);/,
  );
});

test('annotation color chrome is marked and the picker attaches to its header', () => {
  assert.match(APP_SHELL_SOURCE, /data-annotation-color-trigger/);
  assert.match(APP_SHELL_SOURCE, /data-annotation-color-picker/);
  assert.match(
    APP_SHELL_SOURCE,
    /<CompactColorPicker[\s\S]*?attachedHeader=\{isShape\}/,
  );
});
