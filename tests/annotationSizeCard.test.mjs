import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIZE_SLIDER_STEPS, sizeToSliderPosition, sliderPositionToSize } from '../src/utils/annotationSize.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('the size slider runs on a square-root scale, so thin widths get most of the track', () => {
  assert.equal(sizeToSliderPosition(1, 1, 50), 0);
  assert.equal(sizeToSliderPosition(50, 1, 50), SIZE_SLIDER_STEPS);
  // 1 to 8 pt takes about a third of the track, not a seventh.
  const at8 = sizeToSliderPosition(8, 1, 50) / SIZE_SLIDER_STEPS;
  assert.ok(at8 > 0.28 && at8 < 0.34, String(at8));
  assert.equal(sizeToSliderPosition(500, 1, 50), SIZE_SLIDER_STEPS);
  assert.equal(sizeToSliderPosition('x', 1, 50), 0);
});

test('a slider position comes back as a tidy size: halves under 10 when decimals are kept', () => {
  for (const width of [1, 2, 3, 4, 6, 8, 12, 16, 20, 32, 50]) {
    assert.equal(sliderPositionToSize(sizeToSliderPosition(width, 1, 50), 1, 50, 1), width);
  }
  const small = sliderPositionToSize(120, 1, 50, 1);
  assert.equal(small * 2, Math.round(small * 2));
  const big = sliderPositionToSize(700, 1, 50, 1);
  assert.equal(big, Math.round(big));
  assert.equal(sliderPositionToSize(-5, 1, 50, 1), 1);
  assert.equal(sliderPositionToSize(5000, 1, 50, 1), 50);
  // Whole numbers only when the field keeps none.
  const counter = sliderPositionToSize(130, 4, 76, 0);
  assert.equal(counter, Math.round(counter));
});

test('the pill opens the size card: sample in the tool colour, slider, typed number, quick picks', () => {
  const source = read('../src/components/AnnotationSizeControl.jsx');
  assert.match(source, /isPill \? \(\s*<SizeCard/);
  assert.match(source, /data-size-card-sample="true"/);
  assert.match(source, /type="range"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /className="annotation-size-card__chips" role="listbox"/);
  // The slider drafts while it moves and commits once when let go.
  assert.match(source, /onPointerUp=\{endSlide\}/);
  assert.match(source, /onDraft\(String\(next\)\)/);
  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /previewShape=\{bottomToolbarApi\.activeTool === 'eraser' \|\| bottomToolbarApi\.contextTool === 'counter' \? 'dot' : 'stroke'\}/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /<AnnotationSizeControl\s+open=\{surveyMarkerWidthMenuOpen\}/);
});
