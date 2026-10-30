import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('the pill opens the size card: the typed number and quick picks, no sample or slider', () => {
  const source = read('../src/components/AnnotationSizeControl.jsx');
  assert.match(source, /isPill \? \(\s*<SizeCard/);
  // Owner 2026-10-28 ("a little simpler"): no paper sample, no slider.
  assert.doesNotMatch(source, /data-size-card-sample|type="range"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /className="annotation-size-card__chips" role="listbox"/);
  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /previewShape=\{bottomToolbarApi\.activeTool === 'eraser' \|\| bottomToolbarApi\.contextTool === 'counter' \? 'dot' : 'stroke'\}/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /<AnnotationSizeControl\s+open=\{surveyMarkerWidthMenuOpen\}/);
});
