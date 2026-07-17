import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Source-assertion guard (same pattern as annotationContextMenuCalloutDelete):
// pins the 2026-07-17 callout hover-glow fixes without needing a DOM render.
//
// Bug history: the filteredCallouts useMemo read hoveredCalloutId (glow) and
// selectedIds (multi-select glow) but its eslint-disabled dep array contained
// NEITHER — the memo held a stale snapshot and the callout hover glow NEVER
// painted. If either dep disappears again, hover glow silently dies again.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_LAYER_SOURCE = readFileSync(
  path.join(__dirname, '../src/components/SVGAnnotationLayer.jsx'),
  'utf8'
);

function extractFilteredCalloutsDeps(source) {
  const memoStart = source.indexOf('const filteredCallouts = useMemo(');
  assert.ok(memoStart > -1, 'filteredCallouts useMemo not found');
  // The dep array is the first `}, [ ... ]);` after the memo body's trailing
  // comment block. Search from the memo start for the eslint-disable marker
  // that immediately precedes the dep array, then grab the following [...].
  const disableIdx = source.indexOf('eslint-disable-next-line react-hooks/exhaustive-deps', memoStart);
  assert.ok(disableIdx > -1, 'dep-array eslint marker not found after filteredCallouts');
  const arrayStart = source.indexOf('[', disableIdx);
  const arrayEnd = source.indexOf(']', arrayStart);
  assert.ok(arrayStart > -1 && arrayEnd > arrayStart, 'filteredCallouts dep array not found');
  return source.slice(arrayStart + 1, arrayEnd);
}

test('filteredCallouts memo depends on hoveredCalloutId (hover glow)', () => {
  const deps = extractFilteredCalloutsDeps(SVG_LAYER_SOURCE);
  assert.match(deps, /\bhoveredCalloutId\b/);
});

test('filteredCallouts memo depends on selectedIds (multi-select glow with annotations)', () => {
  const deps = extractFilteredCalloutsDeps(SVG_LAYER_SOURCE);
  assert.match(deps, /\bselectedIds\b/);
});

test('pan-mode pendingHover consumption routes calloutId through the shared hover handlers', () => {
  // The pendingHover effect must set callout hover via the SAME
  // handleCalloutPointerEnter/Leave pair Select-mode pointer events use.
  assert.match(SVG_LAYER_SOURCE, /pendingHover\.calloutId/);
  const effectIdx = SVG_LAYER_SOURCE.indexOf('pendingHover.calloutId');
  const window = SVG_LAYER_SOURCE.slice(effectIdx, effectIdx + 1200);
  assert.match(window, /handleCalloutPointerEnter\(/);
  assert.match(window, /handleCalloutPointerLeave\(/);
});
