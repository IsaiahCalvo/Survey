import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for F3 / Ctrl+G find next-prev aliases.
// Live proof is debug/scenarios/e2e-f3-find-aliases.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SearchTextPanel binds F3 and Ctrl/Cmd+G as next/prev, including wrap and 0-hit no-op', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');

  assert.match(panel, /F3 or Cmd\/Ctrl\+G for next\/prev/);
  assert.match(panel, /const isCmdOrCtrlG = \(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && e\.key\.toLowerCase\(\) === 'g'/);
  assert.match(panel, /if \(e\.key === 'F3' \|\| isCmdOrCtrlG\)/);
  assert.match(panel, /if \(e\.shiftKey\) \{\s*\n\s*goToPrevMatchRef\.current\(\);/);
  assert.match(panel, /goToNextMatchRef\.current\(\)/);
  assert.match(panel, /if \(searchResults\.length === 0\) return;/);
  assert.match(panel, /currentMatchIndex > 0\s*\n\s*\? currentMatchIndex - 1\s*\n\s*: searchResults\.length - 1/);
  assert.match(panel, /document\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(panel, /if \(!searchInputRef\.current\) return;/);
});

test('Search panel stays mounted when hidden; overlay lists F3 / Shift+F3 Find next/previous next to Search, not Ctrl+G; Group stays compile-hidden', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /Keep all panels mounted but hide inactive ones using display: none/);
  assert.match(sidebar, /display: activeTab === 'search' \? 'flex' : 'none'/);
  assert.match(sidebar, /<SearchTextPanel/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Search text'/);
  assert.match(overlay, /keys: \['F3'\], description: 'Find next'/);
  assert.match(overlay, /keys: \['Shift', 'F3'\], description: 'Find previous'/);
  assert.doesNotMatch(overlay, /Ctrl\+G|⌘G|Cmd\+G/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /Cmd\+G and Cmd\+Shift\+G shortcuts are short-circuited/);
  assert.match(svg, /useEffect\(\(\) => \{\s*return;/);
});
