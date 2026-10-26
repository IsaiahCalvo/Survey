// Owner 2026-10-26: double-clicking a counter pin shows a turn handle that
// must turn it. Every counter is drawn with lockRotation (its round body never
// spins); the handle turns the pointer, so lockRotation must not block it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnnotationTransformHandleLocked } from '../src/utils/annotationSelectionEligibility.js';
import { readFileSync } from 'node:fs';

const counter = {
  type: 'circle',
  left: 505.75,
  top: 621.02,
  radius: 14,
  lockScalingX: true,
  lockScalingY: true,
  lockRotation: true,
  data: { type: 'counter', pointerAngle: 320, displayNumber: 2 },
};

test('a counter pin drawn with lockRotation can still be turned by its handle', () => {
  assert.equal(isAnnotationTransformHandleLocked(counter, 'mtr'), false);
});

test('lockRotation still locks the turn handle on every other mark', () => {
  const rect = { type: 'Rect', lockRotation: true, data: {} };
  assert.equal(isAnnotationTransformHandleLocked(rect, 'mtr'), true);
});

test('Polygon and Polyline have their own line width, like every other shape tool', () => {
  // useDatabase.js pulls in the Supabase client, so read its defaults table as text.
  const source = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('const DEFAULT_TOOL_PREFERENCES ='), source.indexOf('};', source.indexOf('const DEFAULT_TOOL_PREFERENCES =')));
  for (const tool of ['polygon', 'polyline']) {
    const row = table.match(new RegExp(`\\n\\s*${tool}: \\{([^}]*)\\}`));
    assert.ok(row, `${tool} has no defaults`);
    assert.match(row[1], /strokeWidth: \d/, `${tool} has no default width`);
    assert.match(row[1], /strokeColor: '#/, `${tool} has no default colour`);
  }
});
