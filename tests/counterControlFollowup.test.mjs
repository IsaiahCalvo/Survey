import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { getCounterRenderGeometry } from '../src/utils/counterGeometry.js';

const read = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
};

const appShellSource = read('../src/AppShell.jsx');
const mobileChromeSource = read('../src/mobile/MobilePdfViewerChrome.jsx');
const propertiesPanelSource = read('../src/components/AnnotationPropertiesPanel.jsx');
const colorPickerSource = read('../src/components/CompactColorPicker.jsx');
const sizeControlSource = read('../src/components/AnnotationSizeControl.jsx');
const packageSource = read('../package.json');

test('counter pin geometry stays proportional at every supported radius', () => {
  const extensionRatio = (radius) => {
    const geometry = getCounterRenderGeometry(0, 0, radius, 225, 1);
    const tipDistance = Math.hypot(geometry.tip.x, geometry.tip.y);
    return (tipDistance - radius) / radius;
  };

  const ratios = [4, 5, 10, 25, 50].map(extensionRatio);
  for (const ratio of ratios) {
    assert.ok(Math.abs(ratio - ratios[0]) < 1e-10, `non-proportional tip ratio: ${ratios.join(', ')}`);
  }
});

test('counter color tabs are inside the picker dismissal boundary', () => {
  assert.match(colorPickerSource, /outsideBoundaryRef/);
  assert.match(appShellSource, /ref=\{annotationColorPickerRef\}/);
  assert.match(appShellSource, /outsideBoundaryRef=\{annotationColorPickerRef\}/);
});

test('desktop and mobile annotation sizes use one Radix-backed whole-number control', () => {
  assert.match(packageSource, /"@radix-ui\/react-popover"/);
  assert.match(sizeControlSource, /@radix-ui\/react-popover/);
  assert.match(sizeControlSource, /normalizeAnnotationSize/);
  assert.match(sizeControlSource, /maxLength=\{3\}/);
  assert.match(sizeControlSource, /aria-label=\{label\}/);
  assert.match(sizeControlSource, /data-annotation-size-popover/);
  assert.match(appShellSource, /<AnnotationSizeControl/);
  assert.match(mobileChromeSource, /<AnnotationSizeControl/);
  assert.match(propertiesPanelSource, /<AnnotationSizeControl/);
  assert.match(propertiesPanelSource, /data-annotation-size-popover/);
});
