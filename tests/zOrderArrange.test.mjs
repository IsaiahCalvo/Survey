import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for UL-30 z-order / arrange (context-menu Bring
// forward / Send backward + overlap-aware skip). Live proof:
// debug/scenarios/e2e-z-order-arrange.spec.mjs
// Distinct from UL-30 front/back smoke and keyboard-shortcut-matrix
// Ctrl+]/[ hotkeys.

const Z_ORDER_ITEMS = [
  'Bring to front',
  'Bring forward',
  'Send backward',
  'Send to back',
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('shape context menu lists all four arrange items; callout omits them', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  for (const label of Z_ORDER_ITEMS) {
    assert.match(menu, new RegExp(`item\\('${label}'`));
  }
  assert.match(menu, /The four z-order items \(Bring to front \/ Bring forward \/[\s\S]*Send backward \/ Send to back\) are DELIBERATELY EXCLUDED/);
  assert.match(menu, /callouts render in\s+\/\/\s+their own SVG loop ABOVE all shapes/);
  assert.match(menu, /handleReorderAnnotation\(ctx\.pageNumber, ctx\.annotationIndex, 'forward', ctx\.annotationId\)/);
  assert.match(menu, /handleReorderAnnotation\(ctx\.pageNumber, ctx\.annotationIndex, 'backward', ctx\.annotationId\)/);
  assert.match(menu, /handleReorderAnnotation\(ctx\.pageNumber, ctx\.annotationIndex, 'front', ctx\.annotationId\)/);
  assert.match(menu, /handleReorderAnnotation\(ctx\.pageNumber, ctx\.annotationIndex, 'back', ctx\.annotationId\)/);
});

test('reorder resolver is overlap-aware for forward/backward and absolute for front/back', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleReorderAnnotation = useCallback\(\(pageNumber, fromIndex, target, annotationId\) => \{/);
  assert.match(viewer, /Figma-style z-order — "Bring Forward" \/ "Send Backward" skip over/);
  assert.match(viewer, /if \(direction === 'front'\) return objectsLen - 1;/);
  assert.match(viewer, /if \(direction === 'back'\) return 0;/);
  assert.match(viewer, /if \(direction === 'forward'\) \{\s*\n\s*for \(let j = fromIndex \+ 1; j < objectsLen; j\+\+\) \{/);
  assert.match(viewer, /if \(intersects\(fromBbox, bboxOf\(j\)\)\) return j;/);
  assert.match(viewer, /stampZOrderAfterMove\(next\.objects, clamped, originalIndexById\)/);
  assert.match(viewer, /action: 'reorder'/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /onReorderAnnotation\(pageNumber, annotationIndex, e\.shiftKey \? 'front' : 'forward'\)/);
  assert.match(svg, /onReorderAnnotation\(pageNumber, annotationIndex, e\.shiftKey \? 'back' : 'backward'\)/);
  assert.match(svg, /data-svg-annotation-layer/);
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});

test('live z-order arrange spec covers menu forward/backward + break + edge', () => {
  const spec = read('debug/scenarios/e2e-z-order-arrange.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Bring forward/);
  assert.match(spec, /Send backward/);
  assert.match(spec, /Bring to front/);
  assert.match(spec, /Send to back/);
  assert.match(spec, /skip non-overlapping C/);
  assert.match(spec, /already-front Bring forward is a no-op/);
  assert.match(spec, /already-back Send backward is a no-op/);
  assert.match(spec, /callout menu must omit/);
  assert.match(spec, /Pen-armed must not rewrite rect stack/);
  assert.match(spec, /Select \/ empty page invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /390/);
  assert.match(spec, /hubPreview/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  for (const label of Z_ORDER_ITEMS) {
    assert.match(spec, new RegExp(label));
  }
});
