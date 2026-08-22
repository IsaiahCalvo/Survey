import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-docs-select-all.spec.mjs
// Unique leftover after Documents Share / Document Access:
// Documents Select All / None / Done. Distinct from extras / Lock /
// Open file / Share Access / Archive Select. Upload stays leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Documents Select All / None / Done is local setSelDocs over visible docs', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /\{docSelectMode \? 'Done' : 'Select'\}/);
  assert.match(ledger, /\{allSel \? 'None' : 'All'\}/);
  assert.match(ledger, /setSelDocs\(allSel \? new Set\(\) : new Set\(docs\.map\(\(d\) => d\.id\)\)\)/);
  assert.match(ledger, /const allSel = docSelCount === docs\.length && docs\.length > 0/);
  assert.match(ledger, /const next = !docSelectMode; setDocSelectMode\(next\); if \(!next\) setSelDocs\(new Set\(\)\)/);
  assert.match(ledger, /if \(docSelectMode\) \{ toggleDocSel\(d\.id\); return; \}/);
  assert.match(ledger, /if \(docSelectMode\) \{ toggleDocSel\(d\.id\); return; \} setSelId\(d\.id\); setPreviewOpen\(true\)/);
  assert.match(ledger, /data-document-id=\{d\.id\}/);
  assert.doesNotMatch(ledger, />Restore<\/button>/);
  assert.doesNotMatch(ledger, />Delete forever<\/button>/);
  assert.doesNotMatch(ledger, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(ledger, /createDocumentInvite/);
});

test('HubPreview seed has six documents; Upload stays leftover-18 without workflowE2E', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /id: 'd2', name: 'Package 2 — Rev 4 — IC\.pdf'/);
  assert.match(preview, /id: 'd3', name: 'RFI-014 Lobby Camera Coverage\.pdf'/);
  assert.match(preview, /id: 'd4', name: 'Door Hardware Schedule — A\.601\.pdf'/);
  assert.match(preview, /id: 'd5', name: 'MEP Coordination — Level 3\.pdf'/);
  assert.match(preview, /id: 'd6', name: 'test\.pdf'/);
  assert.match(preview, /if \(!workflowE2E\) \{\s*console\.log\('\[hub preview\] upload'\);/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /invented-upload/);
});

test('Documents Select All is not extras / Share Access / Archive Select', () => {
  const extras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(extras, /Duplicate/);
  assert.match(extras, /Move\/Copy/);
  assert.doesNotMatch(extras, /name: 'All', exact: true/);
  assert.doesNotMatch(extras, /name: 'None', exact: true/);
  assert.doesNotMatch(extras, /DOCS_SELECT_ALL_PROOF/);

  const share = read('debug/scenarios/e2e-hub-docs-share-access.spec.mjs');
  assert.match(share, /Document Access/);
  assert.doesNotMatch(share, /DOCS_SELECT_ALL_PROOF/);
  assert.doesNotMatch(share, /name: 'All', exact: true/);

  const archive = read('debug/scenarios/e2e-archive-select.spec.mjs');
  assert.match(archive, /Archive Select \/ All \/ None \/ Done/);
  assert.match(archive, /name: 'Restore', exact: true/);
  assert.doesNotMatch(archive, /DOCS_SELECT_ALL_PROOF/);

  const live = read('debug/scenarios/e2e-hub-docs-select-all.spec.mjs');
  assert.match(live, /DOCS_SELECT_ALL_PROOF/);
  assert.match(live, /Search documents/);
  assert.match(live, /mobileAllNone/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /invented-upload/);
});
