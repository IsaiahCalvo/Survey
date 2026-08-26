// Overlay leftover: Shift+F3 is a live Find previous chord
// (SearchTextPanel goToPrevMatch), and sibling Action shortcuts were
// already listed (F3 Find next), but the catalog omitted Shift+F3.
// Distinct from leftover-18, V-08 Search apply, F3/Ctrl+G alias apply
// leftover, inventing Open file / UL-03, inventing Ctrl+G overlay
// rows, or clipboard overlay rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay lists Shift+F3 Find previous next to Find next', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['F3'\], description: 'Find next'/);
  assert.match(overlay, /keys: \['Shift', 'F3'\], description: 'Find previous'/);
  assert.match(overlay, /live Find previous chord/);
  assert.doesNotMatch(overlay, /description: 'Open file'/);
  assert.doesNotMatch(overlay, /Ctrl\+G|⌘G|Cmd\+G/);
  assert.doesNotMatch(overlay, /Copy|Cut|Paste/);
});

test('Shift+F3 is a live SearchTextPanel previous-match chord', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(panel, /F3 or Cmd\/Ctrl\+G for next\/prev/);
  assert.match(panel, /if \(e\.key === 'F3' \|\| isCmdOrCtrlG\)/);
  assert.match(panel, /const goToPrevMatch = useCallback/);
  assert.match(panel, /goToPrevMatchRef\.current\(\)/);
  assert.match(panel, /document\.addEventListener\('keydown', handleKeyDown\)/);
});

test('live spec covers overlay listing + Shift+F3 walk + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-overlay-shift-f3-find-previous.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop overlay Shift\+F3 Find previous intended \+ break \+ edge/);
  assert.match(spec, /390 overlay Shift\+F3 Find previous intended \+ break \+ edge/);
  assert.match(spec, /Shift\+F3 must walk Previous 2→1/);
  assert.match(spec, /lists Find previous/);
  assert.match(spec, /must not invent Ctrl\+G/);
  assert.match(spec, /must not invent Open file/);
  assert.match(spec, /Shift\+F3 must not open Search/);
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
