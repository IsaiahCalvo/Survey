import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-file-open.spec.mjs
// Unique leftover after Hub Projects file More/Select Delete.
// File-row Open is onOpenDocument / HubPreview handleOpenDocument —
// not Documents Preview / Open file, not leftover-18 Upload, and not
// a File More item. HubPreview assigns the Package 2 fixture (or
// clickable-link-test.pdf under workflowE2E). returnTab is 'projects'.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree file-row click calls onOpenDocument unless Select is on', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /onClick=\{\(\) => \{ if \(fileSelect\) \{ toggleFileSel\(f\.id\); return; \} onOpenDocument && onOpenDocument\(f\); \}\}/);
  assert.match(tree, /onOpenDocument && onOpenDocument\(f\)/);
  assert.match(tree, /\{ label: 'Copy', onClick: \(\) => copyFile\(f\) \}/);
  assert.match(tree, /\{ label: 'Paste', disabled: !clipboard, onClick: \(\) => pasteFile\(\) \}/);
  assert.match(tree, /\{ label: 'Delete', danger: true, onClick: \(\) => deleteFiles\(\[fileMenu\.id\]\) \}/);
  assert.doesNotMatch(tree, /\{ label: 'Open'/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsFileOpen/);
  assert.match(tree, /const \[mobileProjectLayout, setMobileProjectLayout\] = useState\('drill'\)/);
  assert.doesNotMatch(tree, /setMobileProjectLayout\(/);
});

test('SurveyHub + HubPreview Open from Projects assigns fixture + returnTab=projects', () => {
  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /onOpenDocument=\{\(document\) => onOpenDocument\?\.\(document, 'projects'\)\}/);
  assert.match(hub, /onOpenDocument=\{\(document\) => onOpenDocument\?\.\(document, 'documents'\)\}/);

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
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /onLockDocument=\{/);
});

test('file-row Open is not Documents Preview/Open and not leftover-18 Upload', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /<div className="section-label">Preview<\/div>/);
  assert.match(ledger, />Open file<\/button>/);
  assert.match(ledger, /onClick=\{\(\) => onOpenDocument && onOpenDocument\(sel\.raw\)\}/);

  const docsExtras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(docsExtras, /Preview & details/);
  assert.match(docsExtras, /Close preview/);
  assert.doesNotMatch(docsExtras, /returnTab/);
  assert.doesNotMatch(docsExtras, /handleOpenDocument/);
  assert.doesNotMatch(docsExtras, /file-row Open/);

  const deleteSpec = read('debug/scenarios/e2e-hub-projects-file-delete.spec.mjs');
  assert.match(deleteSpec, /deleteFiles/);
  assert.doesNotMatch(deleteSpec, /handleOpenDocument/);
  assert.doesNotMatch(deleteSpec, /previewName/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleUpload = \(projectId = null\) => \{/);
  assert.match(preview, /onUpload=\{handleUpload\}/);
});
