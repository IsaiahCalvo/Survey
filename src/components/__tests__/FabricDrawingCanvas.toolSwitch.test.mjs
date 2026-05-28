import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const TARGET = resolve(process.cwd(), 'src/components/FabricDrawingCanvas.jsx');

test('drawing canvas reconfigures from current activeTool prop, not a stale ref, when switching pen to survey marker', () => {
  const src = readFileSync(TARGET, 'utf8');

  assert.match(
    src,
    /export\s+function\s+configureCanvasForDrawingTool\s*\(/,
    'expected a testable canvas tool-mode configurator'
  );

  assert.match(
    src,
    /configureCanvasForDrawingTool\s*\(\s*canvas\s*,\s*activeTool\s*\)/,
    'expected the shape-mode effect to configure from the activeTool prop'
  );

  assert.doesNotMatch(
    src,
    /const\s+isShape\s*=\s*SHAPE_TOOLS\.includes\s*\(\s*activeToolRef\.current\s*\)/,
    'shape-mode effect must not read activeToolRef.current before the ref-sync effect runs'
  );
});
