import test from 'node:test';
import { equal } from 'node:assert/strict';

import {
  sanitizeConsoleLogText,
  shouldCaptureConsoleLine,
} from '../src/utils/consoleLogFilter.js';

test('captures useful undo logs', () => {
  equal(shouldCaptureConsoleLine('[UndoDiag] {"event":"undo_choice"}'), true);
});

test('drops noisy render logs by default', () => {
  equal(shouldCaptureConsoleLine('[SVG p1] render — 2 objs, viewBox=612x792'), false);
  equal(shouldCaptureConsoleLine('[App-Debug p1] PAL render — pageSize={w:612, h:792}'), false);
  equal(shouldCaptureConsoleLine('[TextCursorParity] {"phase":"entry"}'), false);
});

test('drops noisy logs even when deep-diagnostic flags are enabled', () => {
  equal(shouldCaptureConsoleLine('[CalloutGeom svg p1] id=c1', { __CALLOUT_GEOM_DIAG: true }), false);
  equal(shouldCaptureConsoleLine('[SVG-RENDER] Page 1 objects=3', { __DIAG_SVG_RENDER: true }), false);
});

test('sanitizes saved logs while preserving useful errors and undo details', () => {
  const text = [
    '[SVG p1] render — 2 objs, viewBox=612x792',
    '[App-Debug p1] PAL render — pageSize={w:612, h:792}',
    '[CalloutGeom svg p1] id=c1',
    '[UndoDiag] {"event":"undo_choice"}',
    'console.error @ [AnnotationSync] Error upserting annotations',
  ].join('\n');

  const output = sanitizeConsoleLogText(text);

  equal(output.includes('[SVG p1] render'), false);
  equal(output.includes('[App-Debug p1] PAL render'), false);
  equal(output.includes('[CalloutGeom'), false);
  equal(output.includes('[UndoDiag] {"event":"undo_choice"}'), true);
  equal(output.includes('console.error @ [AnnotationSync] Error upserting annotations'), true);
  equal(output.includes('[SaveLog] filtered 3 noisy console lines'), true);
});

test('caps saved logs to a GitHub-friendly size', () => {
  const output = sanitizeConsoleLogText('x'.repeat(1200), { maxChars: 100 });

  equal(output.length <= 160, true);
  equal(output.includes('[SaveLog] truncated console log'), true);
});
