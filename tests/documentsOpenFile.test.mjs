import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-docs-open-file.spec.mjs
// Unique leftover after Hub Projects file-row Open.
// Documents Open file is onOpenDocument / HubPreview handleOpenDocument
// with returnTab='documents' — desktop Preview-pane Open file + row
// double-click; 390 row click openMobileDoc + detail Open file.
// Distinct from Documents Preview pane (already extras) and from
// Projects file-row Open (returnTab=projects). HubPreview assigns the
// Package 2 fixture (or clickable-link-test.pdf under workflowE2E).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('DocumentsLedger Open file is Preview button + double-click; 390 openMobileDoc + detail', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /onClick=\{\(\) => \{ if \(docSelectMode\) \{ toggleDocSel\(d\.id\); return; \} setSelId\(d\.id\); setPreviewOpen\(true\); \}\}/);
  assert.match(ledger, /onDoubleClick=\{\(\) => !docSelectMode && onOpenDocument && onOpenDocument\(d\.raw\)\}/);
  assert.match(ledger, /onClick=\{\(\) => onOpenDocument && onOpenDocument\(sel\.raw\)\}>Open file<\/button>/);
  assert.match(ledger, /const openMobileDoc = \(d\) => \{/);
  assert.match(ledger, /if \(docSelectMode\) \{ toggleDocSel\(d\.id\); return; \}/);
  assert.match(ledger, /onOpenDocument && onOpenDocument\(d\.raw\);/);
  assert.match(ledger, /onClick=\{\(\) => openMobileDoc\(d\)\}/);
  assert.match(ledger, /onClick=\{\(\) => \{ setMobileDetailId\(null\); onOpenDocument && onOpenDocument\(mobileDetailDoc\.raw\); \}\}>Open file<\/button>/);
  assert.match(ledger, /\{ label: 'Preview & details', onClick: \(\) => showDocumentDetails\(doc\) \}/);
  assert.doesNotMatch(ledger, /\{ label: 'Open'/);
  assert.doesNotMatch(ledger, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(ledger, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(ledger, /__e2eDocsOpenFile/);
});

test('SurveyHub + HubPreview Open from Documents assigns fixture + returnTab=documents', () => {
  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /onOpenDocument=\{\(document\) => onOpenDocument\?\.\(document, 'documents'\)\}/);
  assert.match(hub, /onOpenDocument=\{\(document\) => onOpenDocument\?\.\(document, 'projects'\)\}/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleOpenDocument = \(document, returnTab = 'documents'\) => \{/);
  assert.match(preview, /testPdf: workflowE2E \? 'clickable-link-test\.pdf' : 'Package 2 - Rev 4 -- IC\.pdf'/);
  assert.match(preview, /previewName: document\?\.name \|\| 'Document\.pdf'/);
  assert.match(preview, /returnTab,/);
  assert.match(preview, /window\.location\.assign\(`\/\?\$\{viewerParams\.toString\(\)\}`\)/);
  assert.match(preview, /onOpenDocument=\{handleOpenDocument\}/);
  assert.match(preview, /\{ id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /\{ id: 'd3', name: 'RFI-014 Lobby Camera Coverage\.pdf'/);
  assert.match(preview, /\{ id: 'd4', name: 'Door Hardware Schedule — A\.601\.pdf'/);
  assert.match(preview, /\{ id: 'd6', name: 'test\.pdf'/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /onLockDocument=\{/);
});

test('Documents Open file is not Projects file-row Open and not leftover-18 Upload', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /onClick=\{\(\) => \{ if \(fileSelect\) \{ toggleFileSel\(f\.id\); return; \} onOpenDocument && onOpenDocument\(f\); \}\}/);
  assert.match(tree, /const \[mobileProjectLayout, setMobileProjectLayout\] = useState\('drill'\)/);
  assert.doesNotMatch(tree, /setMobileProjectLayout\(/);

  const docsExtras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(docsExtras, /Preview & details/);
  assert.match(docsExtras, /Close preview/);
  assert.doesNotMatch(docsExtras, /returnTab/);
  assert.doesNotMatch(docsExtras, /handleOpenDocument/);
  assert.doesNotMatch(docsExtras, /openMobileDoc/);

  const projectsOpen = read('debug/scenarios/e2e-hub-projects-file-open.spec.mjs');
  assert.match(projectsOpen, /returnTab=projects/);
  assert.match(projectsOpen, /file-row Open/);
  assert.doesNotMatch(projectsOpen, /openMobileDoc/);
  assert.doesNotMatch(projectsOpen, /returnTab=documents/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleUpload = \(projectId = null\) => \{/);
  assert.match(preview, /if \(!workflowE2E\) \{/);
  assert.match(preview, /onUpload=\{handleUpload\}/);
});
