// Owner 2026-10-26 (item 38, "switching between tabs needs to be smooth"):
// the viewer comes back from display: none on a tab switch, which restarts
// CSS entry animations; for a moment they run at 0s (styles/motion.css).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/motion.css', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useViewerReturnQuiet.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('the entry animations a tab switch would replay run at 0s while the viewer returns', () => {
  const rule = css.slice(css.indexOf(':root[data-viewer-returning]'));
  assert.ok(rule.length > 0, 'the rule exists');
  for (const sel of ['.survey-surface-in', '.survey-entitybar', '.chrome-row-drop-in', '.left-rail__panel', '#survey-rail-panel']) {
    assert.ok(rule.slice(0, rule.indexOf('}')).includes(sel), `${sel} is quieted`);
  }
  assert.match(rule, /animation-duration:\s*0s\s*!important/);
});

test('the mark is set on a return and cleared once the animations would have ended', async () => {
  const { VIEWER_RETURN_QUIET_MS } = await import('../src/hooks/useViewerReturnQuiet.js');
  // Longer than the longest entry it quiets (the 200 ms panel slides), so
  // taking the mark off never replays one.
  assert.ok(VIEWER_RETURN_QUIET_MS > 200 && VIEWER_RETURN_QUIET_MS <= 600);
  assert.match(hook, /dataset\.viewerReturning = 'true'/);
  assert.match(hook, /delete root\.dataset\.viewerReturning/);
  assert.match(shell, /useViewerReturnQuiet\(Boolean\(isViewerVisible\)\)/);
});
