import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const svgSource = await readFile(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Text Select installs existing-mark hit handling while preserving native drag selection', () => {
  const effectStart = source.indexOf("document.addEventListener('pointerdown', handlePointerDownCapture, true)");
  assert.notEqual(effectStart, -1);
  const effectGuard = source.slice(Math.max(0, effectStart - 500), effectStart);
  assert.match(effectGuard, /!\['select', 'text-select'\]\.includes\(activeTool\)/);
  assert.match(source, /const handleSelectPdfjsTextMarkup = useCallback\([^]*?!\['select', 'text-select'\]\.includes\(activeTool\)/);
  assert.match(source, /const handleSelectPdfjsTextMarkupFromClientPoint = useCallback\([^]*?!\['select', 'text-select'\]\.includes\(activeTool\)/);
  assert.match(source, /if \(activeTool !== 'text-select'\) return undefined;[^]*?Math\.hypot\([^]*?const hit = resolveAnnotationAt\(event\)/);
});

test('Text Select enables SVG selection state but leaves the root inert so native text still receives drags', () => {
  assert.match(source, /const svgInteractive = activeTool === 'select' \|\| activeTool === 'text-select';/);
  assert.match(svgSource, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'\)/);
  assert.match(svgSource, /activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'/);
});

test('only the selected page owns annotation handles', () => {
  assert.match(source, /selectionOwnerPageNumber=\{selectedToolbarAnnotation\?\.pageNumber \?\? null\}/);
  assert.match(svgSource, /selectionOwnerPageNumber = null/);
  assert.match(
    svgSource,
    /selectionOwnerPageNumber != null[\s\S]{0,180}selectionOwnerPageNumber !== pageNumber[\s\S]{0,220}deselectAll\(\)/,
  );
});
