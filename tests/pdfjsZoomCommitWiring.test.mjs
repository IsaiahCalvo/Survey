/**
 * pdfjsZoomCommitWiring.test.mjs — source-assertion guard for the owned-engine
 * zoom commit plumbing (2026-07 demo-parity work).
 *
 * The engine (PdfjsViewerContainer) fires onZoomChanged right after a zoom
 * commits and diff-emits onPageContainersChange on layout changes. These were
 * once wired to `undefined`, which left the app's scale state (toolbar %,
 * scale-dependent overlays) stale until a page re-raster happened to fire —
 * and raster-cache hits never fire one. Keep the wiring alive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src', 'PDFViewer.jsx'), 'utf8');

test('engine zoom commits are wired into the app (not undefined)', () => {
  assert.ok(
    src.includes('onZoomChanged={handlePdfjsEngineZoomCommitted}'),
    'PdfjsViewerContainer mount must wire onZoomChanged to the slim commit handler'
  );
  assert.ok(
    !src.includes('onZoomChanged={undefined}'),
    'onZoomChanged must not be wired to undefined'
  );
});

test('zoom commit handler reconciles scale immediately', () => {
  const handler = src.match(
    /const handlePdfjsEngineZoomCommitted = useCallback\(\(\) => \{[\s\S]*?\}, \[/
  );
  assert.ok(handler, 'handlePdfjsEngineZoomCommitted must exist');
  assert.ok(
    handler[0].includes("reconcilePdfjsScaleFromRenderedPage('engine-zoom-commit')"),
    'commit handler must reconcile the app scale from the committed layout'
  );
});

test('annotations are never hidden during zoom (no flicker gate)', () => {
  assert.ok(
    !/visibility:\s*pdfjsZoomPreviewActive/.test(src),
    'the committed-annotation surface must never be visibility-gated on zoom — ' +
    'the old Syncfusion-era gate blanked every annotation for the whole settle window'
  );
});

test('page container map stays engine-owned', () => {
  assert.ok(
    src.includes('onPageContainersChange={handlePdfjsEngineContainersChanged}'),
    'PdfjsViewerContainer mount must wire onPageContainersChange'
  );
  assert.ok(
    !src.includes('onPageContainersChange={undefined}'),
    'onPageContainersChange must not be wired to undefined'
  );
});
