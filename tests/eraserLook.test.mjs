// Nightly 'eraser-look' (Drawboard PDF's eraser, checked live 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ERASER_LOOK_CURSOR,
  ERASER_HALO_COLOUR,
  ERASER_HALO_OPACITY,
  ERASER_TRAIL_EDGE,
  ERASER_TRAIL_OPACITY,
  haloStrokeWidth,
  paintVisible,
  smoothTrailPath,
  trailWidths,
} from '../src/utils/eraserLook.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test("Drawboard's numbers: grey edge at half strength, orange-red at 40%, 3 pt wider", () => {
  assert.equal(ERASER_TRAIL_EDGE, '#313131');
  assert.equal(ERASER_TRAIL_OPACITY, 0.5);
  assert.equal(ERASER_HALO_COLOUR, '#E6563D');
  assert.equal(ERASER_HALO_OPACITY, 0.4);
  assert.equal(haloStrokeWidth(2, true), 5, 'a 2 pt arrow gets a 5 pt halo');
  assert.equal(haloStrokeWidth(0, false), 4, 'filled pen ink gets a 4 pt halo');
  assert.equal(haloStrokeWidth('x', true), 4);
});

test('the cursor is a 42 px image with its hot spot on the cross, crosshair behind it', () => {
  assert.match(ERASER_LOOK_CURSOR, /^url\("data:image\/svg\+xml,/);
  assert.match(ERASER_LOOK_CURSOR, /\) 9 26, crosshair$/);
  assert.match(decodeURIComponent(ERASER_LOOK_CURSOR), /width="42" height="42"/);
  assert.match(decodeURIComponent(ERASER_LOOK_CURSOR), /#3E4554/);
});

test('the trail is as wide as the eraser reaches, with a white middle 2 screen px in', () => {
  assert.deepEqual(trailWidths(10, 1), { outer: 20, inner: 16 });
  assert.deepEqual(trailWidths(10, 2), { outer: 20, inner: 18 });
  assert.deepEqual(trailWidths(1, 0.5), { outer: 2, inner: 0 });
});

test('the trail path is smoothed through the midpoints', () => {
  assert.equal(smoothTrailPath([]), '');
  assert.equal(smoothTrailPath([{ x: 1, y: 2 }]), 'M1 2L1 2');
  assert.equal(smoothTrailPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'M0 0L10 0');
  assert.equal(
    smoothTrailPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]),
    'M0 0Q10 10 15 5L20 0',
  );
});

test('a paint shows unless it is none, see-through or under 5%', () => {
  assert.equal(paintVisible('rgb(255, 0, 0)', '1'), true, 'red is not see-through because blue is 0');
  assert.equal(paintVisible('rgba(0, 0, 0, 0.001)', '1'), false, 'hit targets do not glow');
  assert.equal(paintVisible('rgba(255, 255, 255, 0)', '1'), false);
  assert.equal(paintVisible('none', '1'), false);
  assert.equal(paintVisible('#ff0000', '0'), false);
  assert.equal(paintVisible('#ff0000', '0.6'), true);
});

test('a beta flag with its migration, wired into the eraser and both mode toggles', () => {
  assert.equal(FEATURE_FLAGS['eraser-look']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110144000_eraser_look_flag.sql'), /\('eraser-look', 'off'/);
  const eraser = read('src/components/FabricEraserCanvas.jsx');
  assert.match(eraser, /eraserLookRef\.current = isFeatureOn\('eraser-look'\)/);
  assert.match(eraser, /if \(eraserLookRef\.current\) \{\s*lookEraserGesture\(pointer, segment\);\s*return false;\s*\}/);
  assert.match(eraser, /const eraserCursor = eraserLookRef\.current \? ERASER_LOOK_CURSOR : nativeEraserCursor/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\['entire', null, 'Full Eraser', 'eraserModeFull'\], \['partial', null, 'Partial Eraser', 'eraserModePartial'\]/);
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const eraserModeOptions = isFeatureOn\('eraser-look'\)/);
});
