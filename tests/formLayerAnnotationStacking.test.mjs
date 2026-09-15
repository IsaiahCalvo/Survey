/**
 * REGRESSION GUARD — the PDF form-widget layer must paint UNDER the SVG
 * annotation overlay.
 *
 * Both layers live in the SAME stacking context: inside a page div they share
 * a common `z-index: 20` ancestor, and every wrapper between that ancestor and
 * each layer is `z-index: auto`, so their own z-index values compete directly.
 * Verified live in the running app (prog-07-form-fields.pdf, 2026-09-15):
 *
 *   .pdfjsFormLayer            computed z-index 101
 *   [data-diag-svg-wrapper]    computed z-index 100
 *
 * With the form layer on top, EVERY annotation the SVG layer paints is
 * invisible wherever it overlaps a widget's box, in every tool: a pen stroke
 * drawn across a text field is cut off dead at the field border, and a click on
 * the stroke inside that box focuses the field instead of selecting the
 * annotation. Reverting only the form layer's z-index to its historical value
 * at runtime made the stroke reappear immediately, which pins the cause.
 *
 * A widget click can be made to win the hit test without occluding markup
 * (pointer-events routing, a hit-test bail-out, or a thin transparent proxy);
 * painting the control OVER user markup is never acceptable, so this test
 * guards the paint order only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** z-index the PdfjsFormLayer root div renders with. */
function readFormLayerZIndex() {
  const src = readFileSync(join(repoRoot, 'src/components/PdfjsFormLayer.jsx'), 'utf8');
  const rootStyle = src.match(/data-pdfjs-form-layer[\s\S]{0,400}?style=\{\{[\s\S]*?zIndex:\s*([A-Za-z0-9_]+)/);
  assert.ok(rootStyle, 'could not find the PdfjsFormLayer root div zIndex');
  const raw = rootStyle[1];
  if (/^\d+$/.test(raw)) return Number(raw);
  const constant = src.match(new RegExp(`const\\s+${raw}\\s*=\\s*(\\d+)`));
  assert.ok(constant, `could not resolve the PdfjsFormLayer zIndex constant ${raw}`);
  return Number(constant[1]);
}

/** z-index the per-page SVG annotation overlay wrapper renders with. */
function readAnnotationOverlayZIndex() {
  const src = readFileSync(join(repoRoot, 'src/PDFViewer.jsx'), 'utf8');
  const wrapper = src.match(/data-diag-svg-wrapper=\{pageNumber\}[\s\S]*?zIndex:\s*(\d+)/);
  assert.ok(wrapper, 'could not find the SVG annotation wrapper zIndex');
  return Number(wrapper[1]);
}

test('form widgets paint under the SVG annotation overlay, never over it', () => {
  const formZ = readFormLayerZIndex();
  const overlayZ = readAnnotationOverlayZIndex();
  assert.ok(
    formZ < overlayZ,
    `PdfjsFormLayer z-index (${formZ}) must stay below the SVG annotation overlay `
    + `z-index (${overlayZ}); they share one stacking context, so a higher form `
    + 'layer hides every annotation drawn over a form field.',
  );
});
