import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const interactionSource = await readFile(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');

test('range resize names the one active text-markup record in its save context', () => {
  const rangeResizeStart = interactionSource.indexOf("source: 'text-markup:range-resize'");
  assert.ok(rangeResizeStart > 0, 'expected text-markup range resize save');
  const saveContext = interactionSource.slice(rangeResizeStart, rangeResizeStart + 320);
  assert.match(saveContext, /annotationIndex:\s*ds\.annotationIndex/);
  assert.match(saveContext, /annotationId:\s*committedTextMarkup\?\.data\?\.id/);
});

test('range resize preserves raw sibling records for state while history stays normalized', () => {
  assert.match(viewerSource, /preserveTextMarkupRangeResizeSiblings\s*\(\s*\{/);
  assert.match(viewerSource, /previousPage:\s*identityNormalizedCurrentAnnotations/);
  assert.match(viewerSource, /nextPage:\s*markedIncomingJson/);
  assert.match(viewerSource, /source\s*===\s*'text-markup:range-resize'/);
  assert.match(
    viewerSource,
    /stateIncomingAnnotations\s*=\s*rangeResizeIncomingAnnotations\s*\|\|\s*finalIncomingAnnotations/,
  );
  assert.match(viewerSource, /committedIncomingAnnotations[\s\S]{0,300}stateIncomingAnnotations/);
});
