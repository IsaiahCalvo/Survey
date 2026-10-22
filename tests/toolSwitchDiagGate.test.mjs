// Perf guard: the tool-switch diagnostic (a per-mark DOM walk plus an SVG
// outerHTML dump a second after picking Select or Eraser) froze a ~670-mark
// sheet for 300-400 ms, right as the user started dragging. It must stay
// behind the debug switch.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCaptureToolSwitchDiag } from '../src/utils/toolSwitchDiag.js';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('the capture is off for every tool unless the debug switch is on', () => {
  for (const tool of ['select', 'eraser', 'pan', 'pen', 'rect']) {
    assert.equal(shouldCaptureToolSwitchDiag(tool, {}), false, tool);
    assert.equal(shouldCaptureToolSwitchDiag(tool, { __APP_DEBUG: 'yes' }), false, tool);
  }
  assert.equal(shouldCaptureToolSwitchDiag('select', null), false);
});

test('the debug switch turns it on for Select and Eraser only', () => {
  for (const win of [{ __APP_DEBUG: true }, { __DIAG_TOOL_SWITCH: true }]) {
    assert.equal(shouldCaptureToolSwitchDiag('select', win), true);
    assert.equal(shouldCaptureToolSwitchDiag('eraser', win), true);
    assert.equal(shouldCaptureToolSwitchDiag('pan', win), false);
  }
});

test('the viewer gates the capture timer on the switch before scheduling it', () => {
  const start = VIEWER_SOURCE.indexOf("appDebug(`[Diag] tool-switch DETECTED");
  assert.ok(start > 0, 'tool-switch capture effect not found');
  const effectStart = VIEWER_SOURCE.lastIndexOf('useEffect(() => {', start);
  const head = VIEWER_SOURCE.slice(effectStart, start);
  assert.match(head, /if \(!shouldCaptureToolSwitchDiag\(activeTool\)\) return;/);
  // Exactly one capture timer, and it is scheduled after the gate.
  const timer = VIEWER_SOURCE.indexOf('const timer = setTimeout(async () => {', effectStart);
  assert.ok(timer > start && timer - start < 400, 'capture timer moved away from the gated effect');
});
