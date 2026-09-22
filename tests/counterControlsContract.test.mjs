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
  assert.match(APP_SHELL_SOURCE, /disabled=\{startLocked\}/);
  assert.match(APP_SHELL_SOURCE, /aria-label="Counter start number"/);
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

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, pass 7 integration). Was
 * /<CompactColorPicker[\s\S]*?attachedHeader=\{isShape\}/.
 *
 * RULING: board 19 puts the Border / Fill tabs INSIDE the picker panel, so there
 * is no separate header strip above it to attach to and `attachedHeader` is not
 * passed any more. What this test is for is unchanged — the colour trigger and
 * the popover are both marked, so the shared dismiss boundary can tell a press
 * on either from a press on the page — and the tabs are asserted in their new
 * home instead.
 */
test('annotation color chrome is marked and the picker carries the tabs', () => {
  assert.match(APP_SHELL_SOURCE, /data-annotation-color-trigger/);
  assert.match(APP_SHELL_SOURCE, /data-annotation-color-picker/);
  assert.match(
    APP_SHELL_SOURCE,
    /<CompactColorPicker[\s\S]*?tabs=\{isShape \? \{/,
  );
});
