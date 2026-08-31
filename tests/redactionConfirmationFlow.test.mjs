import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequestedRedactionSnapshot } from '../src/utils/textMarkupGroupTransactions.js';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const actionBar = readFileSync(new URL('../src/components/TextSelectionActionBar.jsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/components/ApplyRedactionsModal.jsx', import.meta.url), 'utf8');
const permanentRedaction = readFileSync(new URL('../src/utils/permanentPdfRedaction.js', import.meta.url), 'utf8');

test('Redact opens confirmation from the new selection before any transaction is committed', () => {
  assert.match(viewer, /if \(markupType === 'redact'\) \{\s*queuePermanentRedactionConfirmation\(transaction\);\s*return;\s*\}/);
  assert.match(viewer, /const queuePermanentRedactionConfirmation = useCallback\(\(transaction\) =>/);
  assert.match(viewer, /setPendingRedactionRequest\(\{[\s\S]{0,260}annotationsByPage: buildRequestedRedactionSnapshot\(transaction\.nextByPage, transaction\.created\)/);
});

test('cancelling redaction confirms that the document was not changed', () => {
  assert.match(viewer, /setPendingRedactionRequest\(null\);\s*setApplyRedactionsError\(''\);\s*showToast\('Redaction cancelled — nothing was changed\.', 'info'\);/);
});

test('permanent export uses only the confirmed pending document and clears it on cancel or success', () => {
  assert.match(viewer, /const redactionAnnotationsByPage = pendingRedactionRequest\.annotationsByPage/);
  assert.match(viewer, /savePDFWithAnnotationsPdfLib\(\s*pdfFile,\s*redactionAnnotationsByPage/);
  assert.match(viewer, /applyPermanentPdfRedactions\(\{[\s\S]{0,240}annotationsByPage: redactionAnnotationsByPage/);
  assert.match(viewer, /setPendingRedactionRequest\(null\)/);
});

test('the text toolbar contains Redact but no separate Apply Redactions action', () => {
  assert.match(actionBar, /onClick=\{\(\) => onAction\('redact'\)\}/);
  assert.doesNotMatch(actionBar, /Apply Redactions|onApplyRedactions|pendingRedactionCount/);
});

test('confirmation and export preserve the rest of the PDF instead of sanitizing every page', () => {
  assert.match(modal, /Everything else in the PDF will be kept/);
  assert.doesNotMatch(modal, /flattened PDF|removes searchable text|old metadata from every page/);
  assert.match(permanentRedaction, /engine\.applyAllRedactions\(documentObject, page\)/);
  assert.doesNotMatch(permanentRedaction, /toPixmap|renderViewport|drawImage|PDFDocument\.create/);
});

test('a fresh confirmation snapshot drops stale legacy redactions', () => {
  const stale = {
    data: {
      id: 'stale-redaction',
      type: 'text-markup',
      selectionGroupId: 'stale-group',
      markupType: 'redact',
    },
  };
  const fresh = {
    data: {
      id: 'fresh-redaction',
      type: 'text-markup',
      selectionGroupId: 'fresh-group',
      markupType: 'redact',
    },
  };
  const underline = {
    data: {
      id: 'underline',
      type: 'text-markup',
      selectionGroupId: 'underline-group',
      markupType: 'underline',
    },
  };

  const snapshot = buildRequestedRedactionSnapshot(
    { 1: { objects: [stale, underline, fresh] } },
    [{ pageNumber: 1, annotation: fresh, annotationIndex: 2 }],
  );

  assert.deepEqual(snapshot[1].objects, [underline, fresh]);
});
