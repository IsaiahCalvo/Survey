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

// DELIBERATE ASSERTION CHANGE 2026-09-22: the bare "↗" strip glyph became a
// named "Resize and rotate" row in the tool's "..." sheet (owner could not
// tell what the glyph did). The entry still calls api.onEnterBBoxEdit.
test('the tool sheet exposes a named Resize and rotate action', () => {
  assert.match(chrome, /aria-label="Resize and rotate"/);
  assert.match(chrome, /Resize and rotate\s*<\/button>/);
  assert.match(chrome, /api\.onEnterBBoxEdit\(\)/);
  assert.doesNotMatch(chrome, /↗/);
});
