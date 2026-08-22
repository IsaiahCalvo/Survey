import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-module-dup-checklist.spec.mjs
// Unique leftovers after Templates entity color:
// Add module / module Duplicate / Add checklist item.
// Distinct from U-03 create/rename/delete, entity color, leftover-18 export.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('addModule mints Module N, opens rename, empty rename is a no-op', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const addModule = () => {');
  assert.ok(start > 0, 'addModule');
  const block = editor.slice(start, editor.indexOf('const renameModule = (id, name) => {', start));
  assert.match(block, /if \(!tpl\) return;/);
  assert.match(block, /name = `Module \$\{n\+\+\}`/);
  assert.match(block, /modules: \[\.\.\.t\.modules, \{ id, name, categories: \[\] \}\]/);
  assert.match(block, /setModRename\(id\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eAddModule/);

  const renameAt = editor.indexOf('const renameModule = (id, name) => {');
  const rename = editor.slice(renameAt, editor.indexOf('const reorderMods = (from, to) => {', renameAt));
  assert.match(rename, /const v = name\.trim\(\);/);
  assert.match(rename, /if \(!v \|\| !tpl\) \{ setModRename\(null\); return; \}/);

  assert.match(editor, /title="New module"/);
  assert.match(editor, /<button type="button" onClick=\{addModule\}><Icon name="plus" size=\{11\} \/>New module<\/button>/);
});

test('Duplicate leftover is module duplicateModules, not leftover-18 export', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const duplicateModules = (ids) => {');
  assert.ok(start > 0, 'duplicateModules');
  const block = editor.slice(start, editor.indexOf('const mutateModuleAt = (moduleIndex, fn) => {', start));
  assert.match(block, /if \(!tpl \|\| !ids\.size\) return;/);
  assert.match(block, /name: `\$\{m\.name\} copy`/);
  assert.match(block, /duplicateAfterByIds\(t\.modules, ids,/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /Copy to Spaces/);

  assert.match(editor, /onClick=\{\(\) => duplicateModules\(selMods\)\}/);
  assert.match(editor, /<h3 style=\{\{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '-0\.025em', flex: 'none', color: '#f4f1ea', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' \}\}>Edit modules<\/h3>/);

  const tplDup = editor.indexOf('const duplicateTemplates = (ids) => {');
  assert.ok(tplDup > 0, 'duplicateTemplates exists as a distinct list action');
  const tplBlock = editor.slice(tplDup, editor.indexOf('const DEFAULT_ROLES', tplDup));
  assert.match(tplBlock, /name: `\$\{t\.name\} copy`/);
});

test('addItem creates an empty checklist row; blank never commits', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  assert.match(editor, /const addItemToModule = \(moduleIndex, ci\) => mutateCategoryInModule\(moduleIndex, ci, \(c\) => \(\{ \.\.\.c, items: \[\.\.\.c\.items, \{ id: newId\('i'\), text: '' \}\] \}\)\);/);
  assert.match(editor, /const addItem = \(ci\) => addItemToModule\(openMod, ci\);/);
  assert.match(editor, /<span style=\{\{ fontSize: 13 \}\}>\+<\/span> Add checklist item/);
  assert.match(editor, /className="templates-mobile-add-line" onClick=\{\(\) => addItem\(ci\)\}>\+ Add checklist item<\/button>/);

  const commitAt = editor.indexOf('const commitRequiredRow = (el, previousValue, hint, commit) => {');
  assert.ok(commitAt > 0, 'commitRequiredRow');
  const commit = editor.slice(commitAt, editor.indexOf('const reorderItemsInModule', commitAt));
  assert.match(commit, /if \(isBlank\(el\.value\)\) \{/);
  assert.match(commit, /if \(previousValue\) el\.value = previousValue;/);
  assert.match(commit, /else flagRequiredInput\(el, hint\);/);
  assert.match(editor, /CHECKLIST_BLANK_HINT = "Can't be empty — type something or hit Esc to cancel\."/);
  assert.match(editor, /if \(!it\.text\) \{ deleteItem\(i, it\.id\); return; \}/);
  assert.doesNotMatch(editor.slice(commitAt, commitAt + 800), /onExportSpaceCSV/);
  assert.doesNotMatch(editor, /__e2eChecklistItem/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'c1', name: 'Cameras', checklist: \[/);
  assert.match(preview, /\{ id: 'i1', text: 'Is the camera cable pulled\?' \}/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});
