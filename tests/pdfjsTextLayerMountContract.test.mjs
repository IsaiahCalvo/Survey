import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewerSource = readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);
const parentSource = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);

test('the owned page renderer mounts the selectable text layer on each live page', () => {
  assert.match(viewerSource, /import PdfjsTextLayer from ['"]\.\/PdfjsTextLayer['"]/);
  assert.match(
    viewerSource,
    // Mounted for Text Select and, where a mouse / pen can hover, for Pan
    // (Pan selects text after a 200 ms rest - owner 2026-10-14).
    /\(textSelectionLayerActive \|\| panTextHoverSelect\)\s*&&\s*\([\s\S]*?<PdfjsTextLayer[\s\S]*?pdf=\{pdfRef\.current\}[\s\S]*?pageNumber=\{i \+ 1\}[\s\S]*?scale=\{scale\}[\s\S]*?rotation=\{rotation\}[\s\S]*?interactive/,
  );
});

test('PDFViewer enables the owned layer for Text Select (and Pan on hover devices) and keeps availability reporting', () => {
  const viewerCall = parentSource.slice(
    parentSource.indexOf('<PdfjsViewerContainer'),
    parentSource.indexOf('/>', parentSource.indexOf('<PdfjsViewerContainer')),
  );
  assert.match(viewerCall, /textSelectionLayerActive=\{activeTool === 'text-select'\}/);
  // Pan's hover-to-select layer: never on a device without a hover pointer.
  assert.match(viewerCall, /panTextHoverSelect=\{shouldMountPanTextLayer\(\{ toolIsPan: activeTool === 'pan', canHover: deviceCanHover\(\) \}\)\}/);
  assert.match(viewerCall, /onTextAvailability=\{handlePdfjsTextAvailability\}/);
});

test('PDFViewer does not duplicate the owned text layer through its annotation portal', () => {
  assert.doesNotMatch(parentSource, /<PdfjsTextLayer/);
});
