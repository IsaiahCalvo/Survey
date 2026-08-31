import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
const layerSource = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Lasso Select captures pointerdown before annotation and handle handlers', () => {
  assert.match(layerSource, /onPointerDownCapture=\{isInteractive[\s\S]*activeTool === 'select' && selectionMode === 'lasso'[\s\S]*handleSvgPointerDown\(e\)/);
  assert.match(hookSource, /if \(activeTool === 'select' && selectionMode === 'lasso'\)[\s\S]*applyLassoState\(\{/);
  assert.doesNotMatch(hookSource, /e\.target === svgRef\.current && activeTool === 'select' && selectionMode === 'lasso'/);
});

test('lasso keeps pen ownership, hands touch pairs to pinch, and cancels lost capture', () => {
  assert.match(hookSource, /current\.pointerType === 'pen'[\s\S]*=== 'touch'[\s\S]*return 'pen-owned'/);
  assert.match(hookSource, /cancelLasso\(\);[\s\S]*return 'pinch-handoff'/);
  assert.match(layerSource, /onLostPointerCapture=\{isInteractive[\s\S]*cancelLasso\?\.\(e\.pointerId\)/);
});

test('lasso release stays owned by its starting page across sibling page roots', () => {
  assert.match(
    hookSource,
    /window\.addEventListener\('pointerup', onLassoWindowPointerUp, true\)/,
    'the starting page must observe release before a sibling page can consume it',
  );
  assert.match(
    hookSource,
    /const onLassoWindowPointerUp = \(e\) => \{[\s\S]*current\.pointerId !== e\.pointerId[\s\S]*handlePointerUp\(e\)/,
    'only the starting pointer may finish the originating page lasso',
  );
  assert.match(
    hookSource,
    /const onLassoWindowPointerCancel = \(e\) => \{[\s\S]*current\.pointerId !== e\.pointerId[\s\S]*cancelLasso\(e\.pointerId\)/,
    'pointer cancellation must clear only its originating lasso',
  );
});

test('lasso modifier snapshot covers add and subtract for shapes and callouts', () => {
  assert.match(hookSource, /shiftHeld: !!e\.shiftKey,[\s\S]*altHeld: !!e\.altKey/);
  assert.match(hookSource, /if \(lasso\.altHeld\)[\s\S]*annotationIndices\.forEach\(\(index\) => next\.delete\(index\)\)[\s\S]*rawHits\.calloutIds\.forEach\(\(id\) => nextCallouts\.delete\(id\)\)/);
  assert.match(hookSource, /else if \(lasso\.shiftHeld\)[\s\S]*new Set\(\[\.\.\.previous, \.\.\.annotationIndices\]\)[\s\S]*\.\.\.rawHits\.calloutIds/);
});
