// Overlay leftover: F3 is a live Find next chord (SearchTextPanel
// goToNextMatch), and sibling Action shortcuts were already listed
// (Ctrl+F Search text), but the catalog omitted F3. Distinct from
// leftover-18, V-08 Search apply, F3/Ctrl+G alias apply leftover,
// inventing Open file / UL-03, inventing Ctrl+G / Shift+F3 overlay
// rows, or clipboard overlay rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists F3 Find next next to Search text', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /keys: \['F3'\], description: 'Find next'/);
  assert.match(overlay, /live Find next chord/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Ctrl\+G|⌘G|Cmd\+G/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('F3 is a live SearchTextPanel next-match chord', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(panel, /F3 or Cmd\/Ctrl\+G for next\/prev/);
  assert.match(panel, /if \(e\.key === 'F3' \|\| isCmdOrCtrlG\)/);
  assert.match(panel, /goToNextMatchRef\.current\(\)/);
  assert.match(panel, /document\.addEventListener\('keydown', handleKeyDown\)/);
});

test('live spec covers overlay listing + F3 walk + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-f3-find-next.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay F3 Find next intended \+ break \+ edge/);
  assert.match(spec, /390 overlay F3 Find next intended \+ break \+ edge/);
  assert.match(spec, /F3 must walk Next 1→2/);
  assert.match(spec, /lists Find next/);
  assert.match(spec, /must not invent Ctrl\+G/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /F3 must not open Search/);
  assert.match(spec, /hubPreview must not mount the overlay/);
  assert.match(spec, /must not stamp file.id/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
