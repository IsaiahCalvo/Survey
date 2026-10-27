import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * Phone pass, flows 4-6 (2026-10-21, Playwright iPhone 13 / iPhone SE on the
 * local signed-in stack). Three phone bugs found while testing Smart fill:
 *
 * 1. iPhone SE: the Survey Marker shape menu (Rectangle / Freehand / Smart
 *    fill) never showed. Its chip sits in the scrolling rail column, and that
 *    column's "more below" fade is a mask-image, which clips every descendant
 *    (position: fixed ones too). On a short phone the rail overflows, the mask
 *    goes on, and the menu was masked out: invisible and untappable.
 * 2. Tapping the Smart fill preview toast away left the blue preview outline
 *    on the page. (Since 2026-10-27 a Smart fill tap places the marker at
 *    once, so there is no preview left to dismiss.)
 * 3. In the viewer the sticky toast covered the Survey strip's Done and the
 *    rail's first chip (Pan).
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the phone Survey Marker shape menu is portaled out of the masked rail column', () => {
  const src = read('src/mobile/MobileSurveyRail.jsx');
  assert.match(src, /import \{ createPortal \} from 'react-dom';/);
  const menuAt = src.indexOf('className="mobile-pdf-tools__popover is-marker-shape"');
  assert.ok(menuAt > 0, 'the shape menu is still rendered here');
  const before = src.slice(Math.max(0, menuAt - 400), menuAt);
  assert.match(before, /createPortal\(/, 'the menu goes through createPortal');
  const after = src.slice(menuAt, menuAt + 2000);
  assert.match(after, /<\/div>,\s*document\.body,\s*\)\}/, 'portaled to document.body');
  // The fade that caused it is still there; the menu just no longer lives under it.
  assert.match(read('src/mobile/mobilePdfViewer.css'), /\.mobile-pdf-tools__main\[data-more-below='true'\] \{[^}]*mask-image/);
});

test('tapping a toast away tells listeners which toast the user dismissed', () => {
  const toast = read('src/utils/toast.js');
  assert.match(toast, /export const TOAST_USER_DISMISS_EVENT = 'app-toast-user-dismiss';/);
  const host = read('src/components/ToastHost.jsx');
  assert.match(host, /store\.dismiss\(t\.id\);\s*window\.dispatchEvent\(new CustomEvent\(TOAST_USER_DISMISS_EVENT, \{ detail: \{ id: t\.key \} \}\)\);/);
});

test('a Smart fill tap places its marker at once: no preview to Apply or dismiss (owner 2026-10-27)', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.doesNotMatch(layer, /smart-fill-preview|setSmartFillPreview/);
  assert.match(layer, /onSurveyMarkerCreated\(markerBounds, \{ smartFill: true \}\);/);
  // A second finger turns the tap into a pinch: the pending read is dropped,
  // so no marker lands mid-zoom.
  const pinch = layer.slice(layer.indexOf('const cancelPinchGesture = () => {'));
  assert.match(pinch.slice(0, 300), /smartFillAbortRef\.current\?\.abort\?\.\(\);\s*(\/\/[^\n]*\n\s*)?if \(!shapeCreationRef\.current\) return;/);
});

test('phone toasts land under the tool-settings / Survey strip and right of the rail', () => {
  const host = read('src/components/ToastHost.jsx');
  assert.match(host, /PHONE_TOP_CHROME_SELECTORS = \[[^\]]*'\.mobile-pdf-properties'/);
  const css = read('src/styles.css');
  assert.match(css, /html\.survey-viewer-open \.app-toast-host \{[^}]*left: calc\(var\(--mobile-rail-w, 36px\) \+ 8px\) !important;/);
});
