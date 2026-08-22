import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-print-panel-failclosed.spec.mjs
// PRINT_PANEL_ENABLED=false is reachable fail-closed chrome (blob / flatten
// iframe), not a missing Print backend. Distinct from leftover18-save-export
// OPEN-only cluster and from UL-40–43 flag-on custom panel.
// Does not flip the flag. Does not invent a Print backend.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('PDFViewer fail-closes the custom panel and keeps the blob / flatten path', () => {
  const viewer = read('src/PDFViewer.jsx');
  const panel = read('src/components/PrintPanel.jsx');

  assert.match(viewer, /const PRINT_PANEL_ENABLED = false;/);
  assert.doesNotMatch(viewer, /const PRINT_PANEL_ENABLED = true;/);
  assert.match(viewer, /if \(!PRINT_PANEL_ENABLED\) \{/);
  assert.match(viewer, /disabled — base PDF blob print/);
  assert.match(viewer, /disabled — temporary annotated PDF print with regular app annotations only/);
  assert.match(viewer, /ignoring — a print job is still composing/);
  assert.match(viewer, /window keydown Cmd\/Ctrl\+P intercepted \(no markup\)/);
  assert.match(viewer, /window keydown Cmd\/Ctrl\+Shift\+P intercepted \(regular annotations\)/);
  assert.match(viewer, /blob-URL iframe\.print\(\) called/);
  assert.match(viewer, /printInFlight = true;/);
  assert.match(viewer, /withMarkup && pdfFile/);
  assert.match(viewer, /!withMarkup && pdfFile/);

  const flagOff = viewer.indexOf('const PRINT_PANEL_ENABLED = false;');
  const gate = viewer.indexOf('if (!PRINT_PANEL_ENABLED) {');
  const blob = viewer.indexOf('disabled — base PDF blob print');
  const flatten = viewer.indexOf('disabled — temporary annotated PDF print');
  const openPanel = viewer.indexOf('setPrintPanelOpen(true)');
  assert.ok(flagOff > 0 && gate > flagOff, 'gate must follow the false flag');
  assert.ok(blob > gate && flatten > gate, 'blob / flatten must live inside the flag-off branch');
  assert.ok(openPanel > flatten, 'custom panel open must stay after the flag-off return');

  assert.match(panel, /aria-label="Print options"/);
  assert.match(panel, /Save as PDF/);
  assert.match(panel, />Markups</);
});

test('no-markup blob print does not set inFlight; markup flatten does', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('if (!PRINT_PANEL_ENABLED) {');
  const end = viewer.indexOf('setPrintPanelOpen(true)');
  const branch = viewer.slice(start, end);
  assert.match(branch, /if \(withMarkup && pdfFile/);
  assert.match(branch, /printInFlight = true;/);
  assert.match(branch, /if \(!withMarkup && pdfFile && typeof URL\?\.createObjectURL === 'function'\)/);

  const noMarkup = branch.slice(branch.indexOf('if (!withMarkup && pdfFile'));
  const noMarkupReturn = noMarkup.indexOf('return;');
  const noMarkupBody = noMarkup.slice(0, noMarkupReturn);
  assert.match(noMarkupBody, /printPdfBlob\(pdfFile/);
  assert.doesNotMatch(noMarkupBody, /printInFlight = true;/);
});

test('live spec proves fail-closed chrome and does not flip the flag', () => {
  const live = read('debug/scenarios/e2e-print-panel-failclosed.spec.mjs');
  const leftover = read('debug/scenarios/e2e-leftover18-save-export.spec.mjs');
  const panelLive = read('debug/scenarios/e2e-print-panel.spec.mjs');
  const leftoverNode = read('tests/leftover18FailClosed.test.mjs');

  assert.match(live, /PRINT_PANEL_FAILCLOSED_PROOF/);
  assert.match(live, /PRINT_PANEL_ENABLED=false/);
  assert.match(live, /Control\+p/);
  assert.match(live, /dispatchPrintHotkey/);
  assert.match(live, /shift: true/);
  assert.match(live, /width: 390/);
  assert.match(live, /hubPreview=1/);
  assert.match(live, /panel enabled=false/);
  assert.match(live, /disabled — base PDF blob print/);
  assert.match(live, /ignoring — a print job is still composing/);
  assert.match(live, /Export annotated PDF/);
  assert.doesNotMatch(live, /PRINT_PANEL_ENABLED = true/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /setInputFiles/);

  assert.match(leftover, /PrintPanel.*OPEN/);
  assert.doesNotMatch(leftover, /PRINT_PANEL_FAILCLOSED_PROOF/);
  assert.match(panelLive, /panel enabled=true/);
  assert.doesNotMatch(panelLive, /PRINT_PANEL_FAILCLOSED_PROOF/);
  assert.doesNotMatch(leftoverNode, /PRINT_PANEL_FAILCLOSED_PROOF/);
});

test('96 unique inventory IDs still have proven receipts', () => {
  const inventory = read('.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md');
  const unique = inventory
    .split('## All unique IDs (96)')[1]
    .split('### P2-34 / P2-35 sub-defects')[0];
  const ids = [];
  for (const line of unique.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const head = cells[1];
    const singles = head.match(/^(KB-\d+|P1-\d+|P2-\d+)$/);
    if (singles) {
      ids.push(singles[1]);
      continue;
    }
    const pair = head.match(/^(P1-\d+) \/ (P1-\d+)$/);
    if (pair) {
      ids.push(pair[1], pair[2]);
    }
  }
  assert.equal(ids.length, 96, `expected 96 unique IDs, got ${ids.length}: ${ids.join(',')}`);
  assert.equal(new Set(ids).size, 96);
  const unproven = [];
  for (const line of unique.split('\n')) {
    if (!/^\| (KB-\d+|P1-\d+|P2-\d+)/.test(line)) continue;
    if (!line.includes('**proven**')) unproven.push(line.slice(0, 80));
  }
  assert.deepEqual(unproven, []);
});
