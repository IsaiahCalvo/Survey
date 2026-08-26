// Genuine hunt of P1-46 guest localStorage after tip c6f1c1dd / product
// 6c1ab2cd. Persist works; guest / no-Y.Doc stays localStorage-only
// (accepted leftover, not taken). Do not invent leftover-18, Line /AP,
// callout Rotation, user-settable callout verticalAlign, a richTextEditor,
// eraser-cut Width restroke, imported-outline Width restroke, or a
// name/type/row leftover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('P1-46 guest / no-Y.Doc sidebar stays localStorage-only (accepted leftover)', () => {
  const persist = read('src/utils/sidebarPersistence.js');
  assert.match(persist, /mergeSidebarWrite/);
  assert.match(persist, /meta is what shares those lists across browsers/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /mergeSidebarWrite\(existing/);
  assert.match(viewer, /setMetaValue\(yjsDoc, PAGE_NAMES_META_KEY, pageNames\)/);
  assert.match(viewer, /setMetaValue\(yjsDoc, BOOKMARKS_META_KEY, bookmarks\)/);
  assert.match(viewer, /if \(!yjsDoc\) return/);
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /We keep PDF-specific data \(pdfData_\*, surveyMarkers_\*, pdfSidebar_\*\)/);
  assert.doesNotMatch(shell, /localStorage\.removeItem\(`pdfSidebar_/);
});

test('P1-46 handleRenamePage stays unwired; do not invent page-name chrome', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handleRenamePage,/);
  assert.doesNotMatch(viewer, /onRenamePage:/);
  const sidebar = read('src/PDFSidebar.jsx');
  assert.doesNotMatch(sidebar, /onRenamePage/);
});

test('hunt host still names the P1-46 persist contract; isolated 8448 / 75/250 standing', () => {
  const spec = read('debug/scenarios/e2e-after-p146-guest-ls-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /KeepMe/);
  assert.match(spec, /clearSidebar: false/);
  assert.match(spec, /reload must not wipe guest\/no-Y\.Doc sidebar/);
  assert.match(spec, /must not stamp file.id/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /viewBox/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
