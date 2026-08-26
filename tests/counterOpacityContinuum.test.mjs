import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { clampOpacityPercent } from '../src/utils/annotationStyleCatalog.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const CONTINUUM = [0, 1, 25, 33, 40, 55, 70, 80, 99, 100];

test('Counter Fill/Number use the 0–100 continuum (no Border minOpacity=1 floor)', () => {
  for (const stop of CONTINUUM) {
    assert.equal(clampOpacityPercent(stop, 0), stop, `${stop} @ min 0`);
  }
  assert.equal(clampOpacityPercent(-10, 0), 0);
  assert.equal(clampOpacityPercent(999, 0), 100);
  assert.equal(clampOpacityPercent('', 0), 0);
  assert.equal(clampOpacityPercent('abc', 0), 0);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /const isCounter = bottomToolbarApi\.contextTool === 'counter'/);
  assert.match(shell, /const secondTabLabel = isCounter \? 'Number' : 'Border'/);
  const oneVisible = shell.match(
    /const shapeOneVisibleRule = bottomToolbarApi\.contextTool === 'rect'\s*\n\s*\|\| bottomToolbarApi\.contextTool === 'ellipse';/,
  );
  assert.ok(oneVisible, 'Counter must not inherit rect/ellipse minOpacity=1');
  assert.match(shell, /minOpacity=\{0\}/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /tool === 'rect' \|\| tool === 'ellipse'/);
  assert.match(mobile, /minOpacity: 0/);
  assert.doesNotMatch(
    mobile,
    /tool === 'counter'[\s\S]{0,80}minOpacity:\s*1/,
    '390 Counter Number must stay a 0–100 continuum',
  );
});

test('composeColorForPatch stamps continuum alpha onto Counter fill and numberColor', () => {
  for (const stop of CONTINUUM) {
    const fill = composeColorForPatch('#FF0000', stop);
    const number = composeColorForPatch('#0000FF', stop);
    assert.equal(fill, `rgba(255, 0, 0, ${stop / 100})`, `fill ${stop}`);
    assert.equal(number, `rgba(0, 0, 255, ${stop / 100})`, `number ${stop}`);
  }
  assert.equal(composeColorForPatch('transparent', 55), 'transparent');
});

test('Counter group-update writes series-wide fill + numberColor rgba from opacity handlers', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handleFillOpacityChange = useCallback\(\(opacity\) => \{/);
  assert.match(viewer, /handleStrokeOpacityChange = useCallback\(\(opacity\) => \{/);
  assert.match(viewer, /handleCounterGroupUpdateRef\.current\?\.\(activeSeriesId, \{ fill: nextFillColor \}\)/);
  assert.match(viewer, /handleCounterGroupUpdateRef\.current\?\.\(activeSeriesId, \{ numberColor: nextNumberColor \}\)/);
  assert.match(viewer, /\/\/   - fill         → writes obj\.fill \(bubble color\)/);
  assert.match(viewer, /\/\/   - numberColor  → writes obj\.data\.numberColor \(text fill in renderCounter\)/);
});

test('live Counter opacity spec covers Fill + Number continuum, clamp, isolation, 390', () => {
  const spec = read('debug/scenarios/e2e-counter-opacity-continuum.spec.mjs');
  assert.match(spec, /desktop Counter Fill \+ Number opacity continuum/);
  assert.match(spec, /390 Counter Fill \+ Number opacity continuum/);
  assert.match(spec, /FILL_STOPS = \[1, 25, 40, 55, 80, 99, 100\]/);
  assert.match(spec, /NUMBER_STOPS = \[1, 25, 40, 55, 80, 99, 100\]/);
  assert.match(spec, /FILL_SLIDER = 70/);
  assert.match(spec, /NUMBER_SLIDER = 33/);
  assert.match(spec, /remembered 40 after transparent/);
  assert.match(spec, /number remembered 40 after transparent/);
  assert.match(spec, /clickTab\(page, 'Fill'\)/);
  assert.match(spec, /clickTab\(page, 'Number'\)/);
  assert.match(spec, /Fill must not clobber Number/);
  assert.match(spec, /series B fill must not clobber series A fill/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /createRect|createLine/);
});
