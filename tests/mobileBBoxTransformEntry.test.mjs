import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewer = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const chrome = fs.readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

test('mobile toolbar publishes a bbox edit entry for line, polygon, and counter selections', () => {
  assert.match(viewer, /const handleEnterBBoxEditFromStrip = useCallback/);
  assert.match(viewer, /onEnterBBoxEdit: handleEnterBBoxEditFromStrip/);
  assert.match(viewer, /canEnterBBoxEdit:/);
  assert.match(viewer, /editType: 'bbox'/);
});

test('mobile formatting strip exposes a touch-accessible Resize and rotate action', () => {
  assert.match(chrome, /aria-label="Resize and rotate"/);
  assert.match(chrome, /onClick=\{api\.onEnterBBoxEdit\}/);
});
