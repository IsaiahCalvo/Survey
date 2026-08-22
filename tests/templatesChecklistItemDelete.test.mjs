import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-checklist-item-delete.spec.mjs
// Unique leftover after More menu: checklist item Delete (unused
// hard-delete vs usage>0 archive-confirm). Distinct from Add item /
// item rename / item reorder and leftover-18 U-04 cloud usage.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('deleteItem probes usage and archives when count > 0; unused hard-deletes', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const delAt = editor.indexOf('const deleteItemInModule = async (moduleIndex, ci, itemId) => {');
  assert.ok(delAt > 0, 'deleteItemInModule');
  const delEnd = editor.indexOf('const deleteItem = (ci, itemId) => deleteItemInModule(openMod, ci, itemId);', delAt);
  assert.ok(delEnd > delAt, 'deleteItem wrapper');
  const del = editor.slice(delAt, delEnd);
  assert.match(del, /getChecklistItemUsageCount\(itemId\)/);
  assert.match(del, /if \(usage > 0 && !item\.archived\)/);
  assert.match(del, /setArchiveConfirm\(\{/);
  assert.match(del, /hardDeleteItemInModule\(moduleIndex, ci, itemId\)/);
  assert.doesNotMatch(del, /items\.length === 1/);
  assert.doesNotMatch(del, /onExportSpaceCSV/);
  assert.doesNotMatch(del, /file\.id/);
  assert.doesNotMatch(del, /PRINT_PANEL_ENABLED/);

  assert.match(editor, /title="Delete item" aria-label="Delete item"/);
  assert.match(editor, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); deleteItem\(i, it\.id\); \}\}/);
  assert.match(editor, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); deleteItem\(ci, it\.id\); \}\}/);

  const hardAt = editor.indexOf('const hardDeleteItemInModule = (moduleIndex, ci, itemId) => mutateCategoryInModule(moduleIndex, ci, (c) => ({');
  assert.ok(hardAt > 0, 'hardDeleteItemInModule');
  const hard = editor.slice(hardAt, editor.indexOf('const archiveItemInModule', hardAt));
  assert.match(hard, /items: c\.items\.filter\(\(it\) => it\.id !== itemId\)/);
  assert.doesNotMatch(hard, /if \(c\.items\.length <= 1\)/);

  assert.match(editor, /archiveItemInModule\(moduleIndex, categoryIndex, itemId\)/);
  assert.doesNotMatch(editor, /__e2eDeleteItem/);
});

test('archive-confirm modal Cancel / Archive / Escape / outside; last-item not gated', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const modalAt = editor.indexOf('data-testid="archive-confirm-modal"');
  assert.ok(modalAt > 0, 'archive-confirm-modal');
  const modal = editor.slice(modalAt, editor.indexOf('{/* Edit modules modal */}', modalAt));
  assert.match(modal, /Archive checklist item\?/);
  assert.match(modal, /data-testid="archive-confirm-cancel"/);
  assert.match(modal, /data-testid="archive-confirm-archive"/);
  assert.match(modal, /onClick=\{closeArchiveConfirm\}/);
  assert.match(modal, /archiveItemInModule\(moduleIndex, categoryIndex, itemId\)/);
  assert.match(modal, /survey marker has/);
  assert.match(modal, /survey markers have/);
  assert.doesNotMatch(modal, /Permanently delete<\/button>/);
  assert.doesNotMatch(modal, /onExportSpaceCSV/);
  assert.doesNotMatch(modal, /Copy to Spaces/);
  assert.doesNotMatch(modal, /file\.id/);

  assert.match(editor, /useModalFocusTrap\(\{\s*active: Boolean\(archiveConfirm\),/s);
  assert.match(editor, /onClose: closeArchiveConfirm/);
});

test('hubPreview seeds usage on i1 only; unused ids stay 0', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /i1: 3/);
  assert.match(preview, /Is the camera cable pulled\?/);
  assert.match(preview, /Is the camera installed\?/);
  assert.match(preview, /Camera tested and online\?/);
  assert.match(preview, /getChecklistItemUsageCount=\{previewGetChecklistItemUsageCount\}/);
  assert.match(preview, /Number\(MOCK_CHECKLIST_ITEM_USAGE\[itemId\]\) \|\| 0/);
  assert.doesNotMatch(preview, /i2:/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /file\.id/);
});
