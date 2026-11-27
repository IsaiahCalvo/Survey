import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ExportPdfDialog clarifies that comment threads export to a separate CSV, not into the PDF (#1726)', () => {
  const src = readFileSync(new URL('../src/components/ExportPdfDialog.jsx', import.meta.url), 'utf8');
  assert.match(src, /Save comments as a separate CSV/);
  assert.match(src, /Comment threads are not drawn on the PDF\./);
  assert.match(src, /data-export-comments-csv/);
});

test('From a job file Done summary calls Plot items devices instead of nodes (#1735)', () => {
  const src = readFileSync(new URL('../src/home/WalkthruHandoffDialog.jsx', import.meta.url), 'utf8');
  // Verify the pure source-word mapping in handoffSummary without JSX runtime imports.
  assert.match(src, /result\.source === 'Plot'\s*\?\s*'device'/);
  assert.match(src, /!result\.source \|\| result\.source === 'Walkthru'\s*\?\s*'node'/);
  assert.match(src, /plural\(missing, missingWord\)/);
});

test('ProjectItemsPanel opens a New task / New issue dialog before calling data.create (#1743)', () => {
  const src = readFileSync(new URL('../src/projectItems/ProjectItemsPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /const createItem = \(\) => \{[\s\S]{0,180}setCreateDraft\(\{ title: '' \}\);/);
  assert.match(src, /const submitCreateItem = async \(event\) => \{[\s\S]{0,250}await data\.create\(kind, \{ title \}\)/);
  assert.match(src, /data-testid': 'new-item-dialog'/);
});
