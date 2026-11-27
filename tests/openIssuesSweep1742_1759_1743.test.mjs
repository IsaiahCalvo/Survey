import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FIVE_GROUP_INSERT_IDS } from '../src/utils/toolbarRows.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#1759: every Insert row tool (including Signature and Stamp) defines a label and renders aria-label', () => {
  const viewer = read('src/PDFViewer.jsx');
  const pinControls = read('src/components/pins/PinControls.jsx');

  // Slice the review/insert sub-row block in PDFViewer.jsx.
  const start = viewer.indexOf("(subRowCategory === 'review' || subRowCategory === 'insert') && (");
  assert.ok(start > 0, 'review/insert sub-row block must exist');
  const end = viewer.indexOf("subRowCategory === 'survey'", start);
  assert.ok(end > start, 'review/insert sub-row block end must exist');
  const block = viewer.slice(start, end);

  // Every ID in FIVE_GROUP_INSERT_IDS must have a non-empty label in the row definition.
  for (const id of FIVE_GROUP_INSERT_IDS) {
    const pattern = new RegExp(`id:\\s*'${id}'[^}]*label:\\s*'([^']+)'`);
    const match = block.match(pattern);
    assert.ok(match && match[1].trim().length > 0, `Insert tool '${id}' must define a non-empty label`);
  }

  // Signature and Stamp are the last two Insert tools and must map through aria-label={... : t.label}.
  assert.deepEqual(FIVE_GROUP_INSERT_IDS.slice(-2), ['signature', 'stamp']);
  assert.match(block, /<button\s+key=\{t\.id\}\s+type="button"/);
  assert.match(block, /aria-label=\{[^}]*t\.label\}/);
  // Page comment renders through PinToolButton, which also sets aria-label={label}.
  assert.match(pinControls, /export function PinToolButton[\s\S]*?aria-label=\{label\}/);
});

test('#1742: View drawer widens to fit all five view toggles evenly without shrinking menu-wrapped buttons', () => {
  const css = read('src/components/ViewStripMenu.css');
  const widthMatch = css.match(/\.view-drawer\s*\{[\s\S]*?\bwidth:\s*(\d+)px;/);
  assert.ok(widthMatch, '.view-drawer must define an explicit px width');
  assert.ok(Number(widthMatch[1]) >= 360, `.view-drawer width (${widthMatch[1]}px) should be >= 360px for 5 toggles`);

  // Menu-wrapped toggles (.page-grid-menu around Paper, Thin lines, Page grid) must stretch to fill their 1fr cell.
  assert.match(css, /\.view-drawer__toggles\s*>\s*\.page-grid-menu\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.view-drawer__toggles\s*>\s*\.page-grid-menu\s*>\s*\.view-drawer__toggle\s*\{[^}]*width:\s*100%;/);

  // "On the page" stays out of the View drawer (moved to Page comment tool in #1744).
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\{pinsOn && !labelled && \(/);
});

test('#1743: New task/issue create dialog portals atRoot and autofocuses title before creating a row', () => {
  const panel = read('src/projectItems/ProjectItemsPanel.jsx');
  const dialogStart = panel.indexOf('open={Boolean(createDraft)}');
  assert.ok(dialogStart > 0, 'createDraft DialogCard must exist');
  const dialogBlock = panel.slice(dialogStart, dialogStart + 1100);
  assert.match(dialogBlock, /\batRoot\b/, 'createDraft DialogCard should portal atRoot so phone sheets never hide it');
  assert.match(dialogBlock, /data-autofocus=""/, 'title input should autofocus when the dialog opens');
});
