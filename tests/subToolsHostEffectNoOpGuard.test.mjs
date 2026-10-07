// Test plan item 63 (2026-10-06): with a mark picked in window A, window B
// deleted another mark; pressing Delete in A then crashed A's viewer with
// "Maximum update depth exceeded" (5 of 5 runs in the two-window walkthrough,
// debug/scenarios/test-plan/part9-sync-local.spec.mjs). The loop's engine was
// PDFViewer's every-commit layout effect that looks up AppShell's
// #chrome-subtools-host: it called setSubToolsHostEl((prev) => …) even when
// nothing changed, and a functional no-op update still schedules a render
// while the component has other work pending — so each commit scheduled the
// next. The effect must leave state alone when the host did not change.
// (A source check: PDFViewer cannot be rendered under node --test.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('the subtools-host layout effect returns before setState when the host is unchanged', () => {
  const at = source.indexOf("document.getElementById('chrome-subtools-host')");
  assert.ok(at > 0, 'the effect that looks up #chrome-subtools-host exists');
  const start = source.lastIndexOf('useLayoutEffect(', at);
  const end = source.indexOf('});', at);
  const body = source.slice(start, end);
  const guard = body.search(/if \(\s*subToolsHostElRef\.current === el\s*\) return;/);
  const set = body.indexOf('setSubToolsHostEl(');
  assert.ok(guard > 0, 'early return when the host element is the one already held');
  assert.ok(set > guard, 'setState only after the guard');
  assert.ok(!/setSubToolsHostEl\(\s*\(prev\)/.test(body), 'no unconditional functional update');
});
