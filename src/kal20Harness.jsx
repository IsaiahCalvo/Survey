// KAL-20 standalone harness — mounts the real UnsupportedAnnotationsNotice
// component after running the production importer on the synthetic fixture.
// Used only by /kal-20-notice-test.html for screenshot evidence.

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import React from 'react';
import ReactDOMClient from 'react-dom/client';

import { importAnnotationsFromPdf } from './utils/pdfAnnotationImporter.js';
import UnsupportedAnnotationsNotice from './components/UnsupportedAnnotationsNotice.jsx';

// Use the worker copy at /kal-20-pdf.worker.js so we don't have to negotiate
// Vite's `/@fs/` restriction for the upstream worktree.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/kal-20-pdf.worker.js';

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const resultNegEl = document.getElementById('result-negative');
const noticeRoot = document.getElementById('notice-root');
const rerenderBtn = document.getElementById('rerender');
const rerunNegBtn = document.getElementById('rerun-negative');

const root = ReactDOMClient.createRoot(noticeRoot);
let lastUnsupported = [];

function mountNotice(types) {
  window.__kal20NoticeDismissed = false;
  root.render(
    React.createElement(UnsupportedAnnotationsNotice, {
      unsupportedTypes: types,
      onDismiss: () => {
        window.__kal20NoticeDismissed = true;
      },
    })
  );
}

async function importFixture(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const result = await importAnnotationsFromPdf(doc, { rawPdfBytes: bytes });
  return {
    unsupportedTypes: result.unsupportedTypes,
    importedTypesByPage: Object.fromEntries(
      Object.entries(result.annotationsByPage || {}).map(([p, payload]) => [
        p,
        (payload?.objects || []).map((o) => o.pdfAnnotationType || o.type),
      ])
    ),
  };
}

async function runPositive() {
  const url = '/debug-fixtures/pdf-native-edge-cases/kal-20-mixed-fileattachment.pdf';
  statusEl.textContent = 'Fetching fixture: ' + url;
  const summary = await importFixture(url);
  lastUnsupported = summary.unsupportedTypes;
  resultEl.textContent = JSON.stringify(summary, null, 2);
  const verdict =
    lastUnsupported.length > 0
      ? '✓ POSITIVE CASE PASS: unsupportedTypes contains: ' + lastUnsupported.join(', ')
      : '✗ POSITIVE CASE FAIL: unsupportedTypes is empty';
  statusEl.innerHTML =
    '<span class="' +
    (verdict.startsWith('✓') ? 'ok' : 'bad') +
    '">' +
    verdict +
    '</span>';
  mountNotice(lastUnsupported);
  window.__kal20Result = summary;
}

rerenderBtn.addEventListener('click', () => mountNotice(lastUnsupported));
rerunNegBtn.addEventListener('click', async () => {
  resultNegEl.style.display = '';
  resultNegEl.textContent = 'Running…';
  const url = '/debug-fixtures/pdf-native-edge-cases/kal-20-supported-only.pdf';
  try {
    const summary = await importFixture(url);
    resultNegEl.textContent = JSON.stringify(summary, null, 2);
    window.__kal20NegSummary = summary;
  } catch (e) {
    resultNegEl.textContent = 'ERROR: ' + (e && e.message ? e.message : e);
  }
});

runPositive().catch((err) => {
  statusEl.innerHTML =
    '<span class="bad">FAILED: ' + (err && err.message ? err.message : err) + '</span>';
  console.error(err);
});
