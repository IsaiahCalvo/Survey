import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isClientPointNearRect } from '../src/utils/selectionPointerOwnership.js';

const layerSource = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const containerSource = readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);

test('selection pointer regions include a small screen-space margin', () => {
  const rect = { left: 100, top: 100, right: 200, bottom: 180, width: 100, height: 80 };
  assert.equal(isClientPointNearRect(95, 140, rect, 6), true);
  assert.equal(isClientPointNearRect(93, 140, rect, 6), false);
  assert.equal(isClientPointNearRect(150, 187, rect, 6), false);
});

test('Text Select arms SVG pointer handling only near the current selection', () => {
  assert.match(layerSource, /const \[textSelectManipulationArmed, setTextSelectManipulationArmed\] = useState\(false\)/);
  assert.match(layerSource, /\.svg-selection-overlay/);
  assert.match(layerSource, /\[data-annotation-index="\$\{selectedIndex\}"\]/);
  assert.match(layerSource, /root\.style\.pointerEvents = ownsPointer \? 'auto' : 'none'/);
  assert.match(layerSource, /textLayer\.style\.pointerEvents = ownsPointer \? 'none' : 'auto'/);
  assert.match(layerSource, /activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'/);
  assert.match(layerSource, /onTextSelectManipulationChange\?\.\(pageNumber, textSelectOwnsPointer\)/);
  assert.match(viewerSource, /textSelectionLayerInteractive=\{activeTool === 'text-select' && textSelectManipulationPageNumber == null\}/);
  assert.match(containerSource, /interactive=\{textSelectionLayerInteractive\}/);
  assert.match(layerSource, /window\.addEventListener\('touchend', releaseTouchOwnership, true\)/);
  assert.match(layerSource, /releaseTouchOwnership[\s\S]{0,180}applyTextSelectPointerOwnership\(false\)/);
});
