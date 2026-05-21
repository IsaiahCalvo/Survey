// KAL-20 + KAL-9 fixture validation runner.
//
// Loads the user's Acrobat-annotated PDF and runs it through the production
// importer so we can collect real-fixture evidence for both tickets without
// needing the dev server.
//
// Outputs:
//   - producer + page count
//   - per-page subtype distribution (raw PDF annotation subtypes)
//   - supported vs unsupported categorization counts
//   - the exact unsupportedTypes set we'd surface in the bottom-right notice
//   - imported Fabric type breakdown (for KAL-9 round-trip evidence)
//   - native-layer policy decisions per page
//
// Usage:
//   node scripts/kal-20-9-acrobat-fixture-validation.mjs <path-to-pdf>

import fs from 'node:fs/promises';
import path from 'node:path';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const PDF_PATH = process.argv[2]
  || '/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf';

async function main() {
  const absPath = path.resolve(PDF_PATH);
  console.log(`[KAL-20/9] Loading fixture: ${absPath}`);

  const buf = await fs.readFile(absPath);
  const bytes = new Uint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(0),
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const metadata = await pdfDoc.getMetadata().catch(() => null);
  const producer = metadata?.info?.Producer || metadata?.info?.Creator || '(unknown)';
  console.log(`  Producer: ${producer}`);
  console.log(`  Pages: ${numPages}`);

  // Walk pages directly to inventory the raw annotation subtype distribution
  // before the importer filters/categorizes anything.
  const rawSubtypeCounts = {};
  const rawPerPage = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const annots = await page.getAnnotations();
    const perPage = {};
    annots.forEach((a) => {
      const subtype = a?.subtype || '(no-subtype)';
      perPage[subtype] = (perPage[subtype] || 0) + 1;
      rawSubtypeCounts[subtype] = (rawSubtypeCounts[subtype] || 0) + 1;
    });
    rawPerPage.push({ page: pageNum, totals: perPage, total: annots.length });
  }
  console.log('\n[Raw PDF annotation subtype totals]');
  Object.entries(rawSubtypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Now run the production importer to mirror what the app does.
  const result = await importAnnotationsFromPdf(pdfDoc, {
    rawPdfBytes: bytes,
  });

  console.log('\n[Importer summary]');
  console.log(`  unsupportedTypes (these drive the UnsupportedAnnotationsNotice): ${
    Array.isArray(result?.unsupportedTypes) ? `[${result.unsupportedTypes.join(', ')}]` : '(none)'
  }`);

  // Fabric breakdown by page + by type
  const fabricTypeCounts = {};
  let totalFabric = 0;
  let totalPagesWithObjects = 0;
  Object.entries(result?.annotationsByPage || {}).forEach(([pageNum, payload]) => {
    const objs = Array.isArray(payload?.objects) ? payload.objects : [];
    if (objs.length === 0) return;
    totalPagesWithObjects++;
    totalFabric += objs.length;
    objs.forEach((obj) => {
      const t = obj?.type || '(no-type)';
      fabricTypeCounts[t] = (fabricTypeCounts[t] || 0) + 1;
    });
  });
  console.log(`  imported Fabric objects: ${totalFabric} on ${totalPagesWithObjects} page(s)`);
  Object.entries(fabricTypeCounts).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  // Callouts (separate path)
  const calloutPages = Object.keys(result?.calloutsByPage || {}).filter((p) => {
    const arr = result.calloutsByPage[p];
    return Array.isArray(arr) && arr.length > 0;
  });
  const totalCallouts = calloutPages.reduce((acc, p) => acc + result.calloutsByPage[p].length, 0);
  console.log(`  imported callouts: ${totalCallouts} on ${calloutPages.length} page(s)`);

  // Native-layer policy
  const policyByPage = result?.nativeLayerPolicyByPage || {};
  const policyPages = Object.keys(policyByPage);
  if (policyPages.length > 0) {
    console.log('\n[Native-layer policy (sample)]');
    policyPages.slice(0, 6).forEach((p) => {
      const policy = policyByPage[p];
      const action = policy?.action || policy?.decision || JSON.stringify(policy).slice(0, 80);
      console.log(`  page ${p}: ${action}`);
    });
  }

  // Per-page raw subtype detail (truncated for noise)
  console.log('\n[Per-page raw subtype detail]');
  rawPerPage.forEach((row) => {
    if (row.total === 0) return;
    const parts = Object.entries(row.totals).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  page ${row.page} (${row.total}): ${parts}`);
  });

  console.log('\n[Conclusions]');
  console.log(`  KAL-20 verdict: ${
    Array.isArray(result?.unsupportedTypes) && result.unsupportedTypes.length > 0
      ? `Unsupported notice WOULD appear and name: ${result.unsupportedTypes.join(', ')}`
      : 'Unsupported notice would NOT appear (no unsupported subtypes detected by the importer).'
  }`);
  console.log(`  KAL-9 inventory: ${totalFabric} editable annotations imported + ${totalCallouts} callouts; check the per-type breakdown above for Squiggly / Polygon / PolyLine / Ink coverage.`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
