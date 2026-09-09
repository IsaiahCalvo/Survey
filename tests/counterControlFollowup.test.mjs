import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getCounterRenderGeometry } from '../src/utils/counterGeometry.js';

const read = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
};

const appShellSource = read('../src/AppShell.jsx');
const mobileChromeSource = read('../src/mobile/MobilePdfViewerChrome.jsx');
const colorPickerSource = read('../src/components/CompactColorPicker.jsx');
const sizeControlSource = read('../src/components/AnnotationSizeControl.jsx');
const packageSource = read('../package.json');
const iconsSource = read('../src/Icons.jsx');
const pdfViewerSource = read('../src/PDFViewer.jsx');
const counterIcon = readFileSync(new URL('../src/assets/icons/counter.svg', import.meta.url));

test('counter tool uses the approved custom icon in every shared toolbar', () => {
  assert.equal(createHash('sha256').update(counterIcon).digest('hex'), 'c0e643ddfe6689d0bea4428e2f240f69968602eeb8a5e43498248a2a14e27843');
  assert.match(iconsSource, /import counterIconUrl from '.\/assets\/icons\/counter\.svg'/);
  assert.match(iconsSource, /counter:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(counterIconUrl, size, color, style, className\)/);
  assert.match(pdfViewerSource, /\{ id: 'counter', label: 'Counter', iconName: 'counter' \}/);
  assert.match(mobileChromeSource, /\{ id: 'counter', label: 'Counter', icon: 'counter' \}/);
});

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
});
