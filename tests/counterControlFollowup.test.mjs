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
const counterIcon = readFileSync(new URL('../src/assets/icons/counter-outline.svg', import.meta.url));

test('counter tool uses the approved custom icon in every shared toolbar', () => {
  // 2026-09-07 polish pass (A6): the counter glyph was redrawn from the
  // hand-sketched 976-unit artwork into a true circle on the house 24-unit
  // grid, matching the Ellipse tool glyph exactly. The hash fixture moves with
  // that deliberate redraw, and the two assertions below it described the old
  // artwork's markup (a white-stroked traced ring plus a white filled numeral
  // under a transform). They are replaced by the properties that matter now —
  // the full set lives in tests/counterIconSource.test.mjs.
  assert.equal(createHash('sha256').update(counterIcon).digest('hex'), 'a58a51a577a3aa5329319ed635dedb29b0f4bf0678b83b40093f89a841b327d4');
  assert.match(iconsSource, /import counterIconUrl from '.\/assets\/icons\/counter-outline\.svg'/);
  assert.match(iconsSource, /counter:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(counterIconUrl, size, color, style, className\)/);
  assert.match(counterIcon.toString(), /<circle cx="12" cy="12" r="10" stroke-width="1\.5"\/>/);
  assert.match(counterIcon.toString(), /viewBox="0 0 24 24"/);
  // A hollow ring only: a filled ring would paint a solid gold disc when the
  // tool is selected, and the owner's rule is gold outline + gold inner mark.
  assert.doesNotMatch(counterIcon.toString().replace(/<!--[\s\S]*?-->/g, ''), /fill="(?!none)[^"]*"/);
  assert.doesNotMatch(iconsSource, /<circle cx="13" cy="11" r="8"/);
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
