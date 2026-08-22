import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveHistoryEntryContext } from '../src/utils/historyContextRestore.js';

// Source contracts for local History sidebar click-restore / collapse.
// Live proof: debug/scenarios/e2e-history-sidebar-click-restore.spec.mjs
// Distinct from W5-01 jump/delete smoke, named cloud Restore (X-01),
// leftover-18 Save version, and E-05 undo/redo.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('click is jump + spotlight + context, not a named snapshot; collapse tears it down; filter chrome is absent', () => {
  const panel = read('src/components/revisions/RevisionsPanel.jsx');
  assert.match(panel, /const handleActivityClick = useCallback/);
  assert.match(panel, /onRestoreHistoryContext\(event\)/);
  assert.match(panel, /onNavigateToPage\(pageNumber/);
  assert.match(panel, /spotlightHistoryPreview\(pageNumber, event\)/);
  assert.match(panel, /spotlightAnnotation\(/);
  assert.match(panel, /not a full-document snapshot/);
  assert.match(panel, /document-history-spotlight-svg/);
  assert.match(panel, /const hidden = embedded \? !isActive : !open/);
  assert.match(panel, /stopSpotlightTracking\(\)/);
  assert.match(panel, /setViewingRevision\(null\)/);
  assert.match(panel, /Only the document owner can save or restore versions/);
  assert.match(panel, /Item is already present — no restore needed/);
  assert.doesNotMatch(panel, /Search history|Filter history|Filter activity|placeholder=.*[Ff]ilter/);
  assert.doesNotMatch(panel, /handleActivityClick[\s\S]{0,400}restoreRevision/);
  assert.doesNotMatch(panel, /handleActivityClick[\s\S]{0,400}createRevision/);

  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /if \(!isCollapsed && activeTab === 'history'\) \{\s*setActiveTab\('pages'\)/);
  assert.match(sidebar, /aria-label=\{isCollapsed \? 'Expand sidebar' : 'Collapse sidebar'\}/);
  assert.match(sidebar, /aria-label="Close version history"/);
  assert.match(sidebar, /isActive=\{activeTab === 'history' && !isCollapsed\}/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['B'\]/);
  assert.match(overlay, /description: 'Toggle sidebar'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'b' \|\| e\.key === 'B'/);
  assert.match(viewer, /pdfSidebarRef\.current\?\.toggleCollapse/);

  const resolved = resolveHistoryEntryContext({
    payload: { uiContext: { spaceId: null, surveyPanelOpen: false } },
  }, { spaces: [] });
  assert.equal(resolved.hasSpaceTarget, true);
  assert.equal(resolved.spaceId, null);
});

test('live spec covers click-spotlight / collapse / filter-absent / Restore no-op + 390', () => {
  const spec = read('debug/scenarios/e2e-history-sidebar-click-restore.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /No history yet/);
  assert.match(spec, /History must omit a Search\/Filter field/);
  assert.match(spec, /History must omit a Filter control/);
  assert.match(spec, /kal48-save-revision/);
  assert.match(spec, /Only the document owner can save or restore versions/);
  assert.match(spec, /create-event must omit Restore/);
  assert.match(spec, /click page-3 activity must jump to page 3/);
  assert.match(spec, /click page-3 activity must show the spotlight/);
  assert.match(spec, /not a full-document snapshot/);
  assert.match(spec, /click-restore must keep B — not rewind a snapshot/);
  assert.match(spec, /Collapse sidebar must tear down the spotlight/);
  assert.match(spec, /Expand sidebar/);
  assert.match(spec, /B must collapse History and tear down the spotlight/);
  assert.match(spec, /Restore must bring B back/);
  assert.match(spec, /already present\|no restore needed/);
  assert.match(spec, /second Restore must not duplicate B/);
  assert.match(spec, /Pen-armed History click must invent 0/);
  assert.match(spec, /390 click must show the spotlight/);
  assert.match(spec, /390 Close version history must tear down the spotlight/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('this slice is local in-session History, not leftover-18 named Restore', () => {
  const spec = read('debug/scenarios/e2e-history-sidebar-click-restore.spec.mjs');
  assert.match(spec, /Named Save version \/ Restore\s+stay leftover-18 X-01/);
  assert.match(spec, /W4-03 empty\/after-edit smoke \+ W5-01/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  const named = read('debug/scenarios/e2e-named-revision-restore.spec.mjs');
  assert.match(named, /Save version|kal48-save-revision|revisionNumber/);

  const leftover = read('debug/scenarios/e2e-leftover18-save-export.spec.mjs');
  assert.match(leftover, /kal48-save-revision/);
  assert.match(leftover, /Only the document owner can save or restore versions/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
