import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-category-module-delete.spec.mjs
// Unique leftovers after Add module / module Duplicate / Add checklist item:
// New category / category Duplicate / module Delete.
// Distinct from U-03 create/rename/delete, entity color, leftover-18 export.
// Template-list Duplicate is a distinct leftover — not this contract.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('addCategory mints unique Category N with empty items; empty title restores', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const addCategoryToModule = (moduleIndex) => {');
  assert.ok(start > 0, 'addCategoryToModule');
  const block = editor.slice(start, editor.indexOf('const renameCategoryInModule = (moduleIndex, ci, name) => {', start));
  assert.match(block, /if \(!tpl\) return;/);
  assert.match(block, /name = `Category \$\{n\+\+\}`/);
  assert.match(block, /categories: \[\.\.\.\(m\.categories \|\| \[\]\), \{ id: categoryId, name, items: \[\] \}\]/);
  assert.match(block, /setOpenCat\(\(orderedMods\[targetIndex\]\.categories \|\| \[\]\)\.length\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eAddCategory/);

  assert.match(editor, /const addCategory = \(\) => addCategoryToModule\(openMod\);/);
  assert.match(editor, /<Icon name="plus" size=\{11\} \/>New category/);
  assert.match(editor, /<button type="button" data-search-dismiss-action onClick=\{addCategory\}><Icon name="plus" size=\{11\} \/>New category<\/button>/);

  const reload = read('src/home/templatesEditorReload.js');
  const commitAt = reload.indexOf('export const resolveTitleCommit = (rawValue, currentName) => {');
  assert.ok(commitAt > 0, 'resolveTitleCommit');
  const commit = reload.slice(commitAt, commitAt + 400);
  assert.match(commit, /if \(!trimmed\) return \{ action: 'restore', name: currentName \};/);
  assert.match(commit, /if \(trimmed === currentName\) return \{ action: 'noop', name: currentName \};/);
  assert.match(commit, /return \{ action: 'commit', name: trimmed \};/);
});

test('Duplicate leftover is category duplicateCategories, not template-list or leftover-18', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const duplicateCategories = (ids) => {');
  assert.ok(start > 0, 'duplicateCategories');
  const block = editor.slice(start, editor.indexOf('const reorderCategoriesInModule = (moduleIndex, activeId, overId) => {', start));
  assert.match(block, /if \(!ids\.size\) return;/);
  assert.match(block, /name: `\$\{c\.name\} copy`/);
  assert.match(block, /id: newId\('c'\)/);
  assert.match(block, /items: c\.items\.map\(\(it\) => \(\{ \.\.\.it, id: newId\('i'\) \}\)\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /Copy to Spaces/);

  assert.match(editor, /onClick=\{\(\) => duplicateCategories\(selCats\)\}/);
  assert.match(editor, /onClick=\{\(\) => duplicateCategories\(visibleSelectedIds\)\}/);

  const tplDup = editor.indexOf('const duplicateTemplates = (ids) => {');
  assert.ok(tplDup > 0, 'duplicateTemplates exists as a distinct list leftover');
  const tplBlock = editor.slice(tplDup, editor.indexOf('const DEFAULT_ROLES', tplDup));
  assert.match(tplBlock, /name: `\$\{t\.name\} copy`/);
});

test('deleteModules is immediate — no confirm dialog, no last-module guard', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const deleteModules = (ids) => {');
  assert.ok(start > 0, 'deleteModules');
  const block = editor.slice(start, editor.indexOf('const duplicateModules = (ids) => {', start));
  assert.match(block, /if \(!tpl \|\| !ids\.size\) return;/);
  assert.match(block, /if \(pickByIds\(tpl\.modules, ids\)\.length === 0\) return;/);
  assert.match(block, /modules: removeByIds\(t\.modules, ids\)/);
  assert.match(block, /setOpenMod\(0\)/);
  assert.doesNotMatch(block, /confirm\(/);
  assert.doesNotMatch(block, /archive-confirm/);
  assert.doesNotMatch(block, /Are you sure/);
  assert.doesNotMatch(block, /last.?module/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eDeleteModule/);

  assert.match(editor, /onClick=\{\(\) => deleteModules\(selMods\)\}/);
  assert.match(editor, /title="Delete" aria-label="Delete"><Icon name="trash" size=\{12\} \/>/);

  const archiveAt = editor.indexOf('data-testid="archive-confirm-modal"');
  assert.ok(archiveAt > 0, 'archive confirm exists only for checklist usage');
  const archive = editor.slice(archiveAt - 400, archiveAt + 200);
  assert.match(archive, /Archive checklist item confirmation modal/);
  assert.doesNotMatch(archive, /deleteModules/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'c1', name: 'Cameras', checklist: \[/);
  assert.match(preview, /\{ id: 'm2', name: 'Commissioning Phase'/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});
