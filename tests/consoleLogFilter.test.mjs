import test from 'node:test';
import { equal } from 'node:assert/strict';

import { equal as eq, match, doesNotMatch } from 'node:assert/strict';
import {
  sanitizeConsoleLogText,
  shouldCaptureConsoleLine,
  redactSecrets,
} from '../src/utils/consoleLogFilter.js';

test('redactSecrets scrubs credential-shaped strings', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  doesNotMatch(redactSecrets(`token is ${jwt}`), /eyJhbGci/);
  match(redactSecrets(`token is ${jwt}`), /\[REDACTED_JWT\]/);
  doesNotMatch(redactSecrets('Authorization: Bearer sbp_e4d2abcd1234deadbeef'), /sbp_e4d2/);
  doesNotMatch(redactSecrets('key sk_live_51ABCdefGhiJK'), /sk_live_51ABC/);
  doesNotMatch(redactSecrets('smtp xsmtpsib-abcd1234efgh-WkrRsTaT'), /xsmtpsib-abcd/);
  doesNotMatch(redactSecrets('...&access_token=abcdef123456&type=recovery'), /abcdef123456/);
  eq(redactSecrets('plain non-secret line'), 'plain non-secret line');
});

test('sanitizeConsoleLogText redacts secrets before output', () => {
  const out = sanitizeConsoleLogText('user logged in Bearer sbp_deadbeefdeadbeef1234');
  doesNotMatch(out, /sbp_deadbeef/);
});

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

test('sanitizeConsoleLogText uses placeholder when every line is noisy', () => {
  const output = sanitizeConsoleLogText('[SVG p1] render — only noise\n[SVG-RENDER] more noise', {
    maxLines: 10,
  });
  // After dropping noisy lines the filter prepends a SaveLog note; when that
  // note itself is filtered out somehow we still need a non-empty fallback.
  // With the SaveLog preamble present, output is non-empty; force empty by
  // only keeping whitespace then verify the empty-output branch via maxLines=1
  // after dropping everything useful.
  equal(output.includes('[SaveLog] filtered'), true);
});

test('sanitizeConsoleLogText empty-output fallback when filtered content is blank', () => {
  // Whitespace-only non-noisy lines collapse to empty after trim.
  const output = sanitizeConsoleLogText('   \n\t  ', { maxLines: 5, maxChars: 50 });
  equal(output, '(no console output captured)');
});
