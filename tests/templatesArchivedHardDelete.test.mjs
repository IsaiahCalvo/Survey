import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-archived-hard-delete.spec.mjs
// Unique leftover after checklist item Delete: permanent-delete of
// already-archived items (hardDeleteItem). Distinct from unused
// hard-delete / usage>0 archive-confirm and leftover-18 U-04.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hardDeleteItem strips the archived id with no confirm and no last-item gate', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const hardAt = editor.indexOf('const hardDeleteItemInModule = (moduleIndex, ci, itemId) => mutateCategoryInModule(moduleIndex, ci, (c) => ({');
  assert.ok(hardAt > 0, 'hardDeleteItemInModule');
  const hard = editor.slice(hardAt, editor.indexOf('const archiveItemInModule', hardAt));
  assert.match(hard, /items: c\.items\.filter\(\(it\) => it\.id !== itemId\)/);
  assert.doesNotMatch(hard, /getChecklistItemUsageCount/);
  assert.doesNotMatch(hard, /setArchiveConfirm/);
  assert.doesNotMatch(hard, /if \(c\.items\.length <= 1\)/);
  assert.doesNotMatch(hard, /onExportSpaceCSV/);
  assert.doesNotMatch(hard, /file\.id/);
  assert.doesNotMatch(hard, /PRINT_PANEL_ENABLED/);

  assert.match(editor, /const hardDeleteItem = \(ci, itemId\) => hardDeleteItemInModule\(openMod, ci, itemId\);/);
  assert.doesNotMatch(editor, /__e2eHardDeleteItem/);
});

test('desktop + 390 archived × call hardDeleteItem; empty list hides the section', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  assert.match(editor, /title="Permanently delete \(orphans historical responses\)" aria-label="Permanently delete \(orphans historical responses\)"/);
  assert.match(editor, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); hardDeleteItem\(i, it\.id\); \}\}/);
  assert.match(editor, /title="Permanently delete" aria-label="Permanently delete"/);
  assert.match(editor, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); hardDeleteItem\(ci, it\.id\); \}\}/);

  assert.match(editor, /data-testid=\{`archived-items-\$\{c\.id\}`\}/);
  assert.match(editor, /\{archivedItems\.length > 0 && \(/);
  assert.match(editor, /data-testid=\{`mobile-archived-items-\$\{c\.id\}`\}/);
  assert.match(editor, /\{archivedItems\.length > 0 \? \(/);

  const archivedTitleAt = editor.indexOf('title={`Archived${it.archivedAt');
  assert.ok(archivedTitleAt > 0, 'archived label title');
  const archivedTitle = editor.slice(archivedTitleAt, archivedTitleAt + 220);
  assert.match(archivedTitle, /historical responses preserved/);

  assert.match(editor, /You can permanently delete the archived item later from the Archived section\./);
  assert.doesNotMatch(editor, /onExportSpaceCSV/);
  assert.doesNotMatch(editor, /Copy to Spaces/);
  assert.doesNotMatch(editor, /file\.id/);
});

test('archive-confirm is setup only — modal still has no Permanently delete action', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const modalAt = editor.indexOf('data-testid="archive-confirm-modal"');
  assert.ok(modalAt > 0, 'archive-confirm-modal');
  const modal = editor.slice(modalAt, editor.indexOf('{/* Edit modules modal */}', modalAt));
  assert.match(modal, /data-testid="archive-confirm-cancel"/);
  assert.match(modal, /data-testid="archive-confirm-archive"/);
  assert.doesNotMatch(modal, /Permanently delete<\/button>/);
  assert.doesNotMatch(modal, /hardDeleteItemInModule/);
  assert.doesNotMatch(modal, /onExportSpaceCSV/);
  assert.doesNotMatch(modal, /file\.id/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /i1: 3/);
  assert.match(preview, /Is the camera cable pulled\?/);
  assert.doesNotMatch(preview, /archived:\s*true/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /file\.id/);
});
