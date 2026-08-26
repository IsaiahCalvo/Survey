// Short remaining-E2E-UNLISTED hunt after tip df8ae57a / product f2f02e68.
// No unique LIVE leftover proved. Do not replay the six exhausted classes.
// Do not invent Font family chrome, leftover-18, Extract, or a name/type/row leftover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('390 Version history is live on testPdf; desktop stays gated; no Font next-draw chrome', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /label="Version history"/);
  assert.match(mobile, /onOpenPanel\?\.\('history'\)/);
  assert.match(mobile, /\['I', 'italic', 'Italic'\]/);
  // Next-draw 390 sheet has size / B/I/U/S / align. Font family is edit-only.
  assert.match(mobile, /aria-label="Font size"/);

  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /\{documentId && <HistoryButton/);
  assert.match(sidebar, /aria-label="Version history"/);

  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /fontFamily: newTextStyle\?\.fontFamily \|\| DEFAULT_FONT_FAMILY/);
});

test('hunt host still names the remaining-UL contract; isolated 8448 / 75/250 standing', () => {
  const spec = read('debug/scenarios/e2e-after-unlisted-remaining-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /390 UL-08 Version history already live/);
  assert.match(spec, /must not invent 390 Font family chrome/);
  assert.match(spec, /hubPreview Version history must be 0/);
  assert.match(spec, /1440 Version history trigger must stay 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
