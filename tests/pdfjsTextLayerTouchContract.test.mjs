import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/components/PdfjsTextLayer.jsx', import.meta.url),
  'utf8',
);

test('interactive PDF text keeps selection and pan while allowing native pinch zoom', () => {
  assert.match(
    source,
    /\.pdfjsTextLayer\.is-interactive \{[^}]*pointer-events: auto;[^}]*user-select: text !important;[^}]*touch-action: pan-x pan-y pinch-zoom;/,
  );
  assert.match(
    source,
    /\.pdfjsTextLayer:not\(\.is-interactive\) \{ pointer-events: none; \}/,
  );
});

test('interactive PDF text repairs one-finger WebKit drags without claiming pinch', () => {
  assert.match(source, /document\.addEventListener\('touchstart', onTouchStart, true\)/);
  assert.match(source, /document\.addEventListener\('touchend', onTouchEnd, true\)/);
  assert.match(source, /if \(event\.touches\.length !== 1\) \{ clearDrag\(\); return; \}/);
  assert.doesNotMatch(source, /const onTouch(?:Start|Move|End) = [\s\S]{0,800}?preventDefault\(\)/);
});

test('rotated PDF text layers follow the pdf.js root rotation contract', () => {
  assert.match(source, /\.pdfjsTextLayer\[data-main-rotation="90"\] \{ transform: rotate\(90deg\) translateY\(-100%\); \}/);
  assert.match(source, /\.pdfjsTextLayer\[data-main-rotation="180"\] \{ transform: rotate\(180deg\) translate\(-100%, -100%\); \}/);
  assert.match(source, /\.pdfjsTextLayer\[data-main-rotation="270"\] \{ transform: rotate\(270deg\) translateX\(-100%\); \}/);
});
