import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTitleCommit } from '../src/home/templatesEditorReload.js';

// Live proof: debug/scenarios/e2e-templates-existing-row-rename.spec.mjs
// Unique leftover after list / content / module Search: existing-row rename
// of seed Cameras / Installation Phase / GC / item text.
// Create flows only minted new names. Distinct from leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('renameModule / renameCategory / renameEntity / renameItem no-op without a real change', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const modAt = editor.indexOf('const renameModule = (id, name) => {');
  assert.ok(modAt > 0, 'renameModule');
  const mod = editor.slice(modAt, editor.indexOf('const reorderMods = (from, to) => {', modAt));
  assert.match(mod, /const v = name\.trim\(\);/);
  assert.match(mod, /if \(!v \|\| !tpl\) \{ setModRename\(null\); return; \}/);
  assert.match(mod, /if \(m\.id !== id \|\| m\.name === v\) return m;/);
  assert.match(mod, /return changed \? \{ \.\.\.t, modules \} : t;/);
  assert.doesNotMatch(mod, /onExportSpaceCSV/);
  assert.doesNotMatch(mod, /file\.id/);

  const catAt = editor.indexOf('const renameCategoryInModule = (moduleIndex, ci, name) => {');
  assert.ok(catAt > 0, 'renameCategoryInModule');
  const cat = editor.slice(catAt, editor.indexOf('const renameCategory = (ci, name) =>', catAt));
  assert.match(cat, /if \(!v\) return;/);
  assert.match(cat, /if \(!current \|\| current\.name === v\) return m;/);

  const entAt = editor.indexOf('const renameEntity = (eid, role) => {');
  assert.ok(entAt > 0, 'renameEntity');
  const ent = editor.slice(entAt, editor.indexOf('const setEntityColor = (eid, color) => {', entAt));
  assert.match(ent, /if \(!v \|\| !tpl\) return;/);
  assert.match(ent, /return changed \? \{ \.\.\.t, roster \} : t;/);

  const itemAt = editor.indexOf('const renameItemInModule = (moduleIndex, ci, itemId, text) =>');
  assert.ok(itemAt > 0, 'renameItemInModule');
  const item = editor.slice(itemAt, editor.indexOf('const renameItem = (ci, itemId, text) =>', itemAt));
  assert.match(item, /if \(it\.id !== itemId \|\| it\.text === text\) return it;/);
  assert.match(item, /return changed \? \{ \.\.\.c, items \} : c;/);

  assert.match(editor, /const mutateModuleAt = \(moduleIndex, fn\) => \{/);
  assert.match(editor, /if \(nextModule === current\) return t;/);
  assert.match(editor, /if \(nextCategory === current\) return m;/);
  const mutateAt = editor.indexOf('const mutateTpl = useCallback((tid, fn) => {');
  assert.ok(mutateAt > 0, 'mutateTpl');
  const mutate = editor.slice(mutateAt, editor.indexOf('const renameTemplate = (tid, name) => {', mutateAt));
  assert.match(mutate, /flushSync\(\(\) => \{/);
  assert.match(mutate, /if \(changed\) markEdited\(\);/);
  assert.doesNotMatch(mutate, /markEdited\(\);[\s\S]*setRich/);

  assert.deepEqual(resolveTitleCommit('', 'Cameras'), { action: 'restore', name: 'Cameras' });
  assert.deepEqual(resolveTitleCommit('   ', 'Installation Phase'), { action: 'restore', name: 'Installation Phase' });
  assert.deepEqual(resolveTitleCommit('GC', 'GC'), { action: 'noop', name: 'GC' });
  assert.deepEqual(resolveTitleCommit('  Cameras  ', 'Cameras'), { action: 'noop', name: 'Cameras' });
  assert.deepEqual(resolveTitleCommit('E2E Cameras', 'Cameras'), { action: 'commit', name: 'E2E Cameras' });
});

test('existing-row rename chrome uses seed Cameras / Installation Phase / GC / item text', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  assert.match(editor, /onDoubleClick=\{\(\) => onStartRename\(mod\.id\)\}/);
  assert.match(editor, /double-click to rename/);
  assert.match(editor, /e\.currentTarget\.value = mod\.name;/);
  assert.match(editor, /onCancelRename\(\);/);
  assert.match(editor, /resolveTitleCommit\(e\.currentTarget\.value, mod\.name\)/);
  assert.match(editor, /resolveTitleCommit\(e\.currentTarget\.value, c\.name\)/);
  assert.match(editor, /commitRequiredRow\(e\.currentTarget, r\.role, ENTITY_BLANK_HINT, \(v\) => renameEntity\(r\.id, v\)\)/);
  assert.match(editor, /commitRequiredRow\(e\.currentTarget, it\.text, CHECKLIST_BLANK_HINT, \(v\) => renameItem\(i, it\.id, v\)\)/);
  assert.match(editor, /commitRequiredRow\(e\.currentTarget, it\.text, CHECKLIST_BLANK_HINT, \(v\) => renameItem\(ci, it\.id, v\)\)/);
  assert.match(editor, /key=\{it\.id \+ ':' \+ it\.text\}/);
  assert.match(editor, /key=\{`mobile-item-\$\{it\.id\}:\$\{it\.text\}`\}/);
  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /stampTool/);
  assert.doesNotMatch(editor, /Note-Link/);
  assert.doesNotMatch(editor, /__e2eRenameModule/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /id: 'm1', name: 'Installation Phase'/);
  assert.match(preview, /id: 'c1', name: 'Cameras'/);
  assert.match(preview, /id: 'e1', name: 'GC'/);
  assert.match(preview, /\{ id: 'i2', text: 'Is the camera installed\?' \}/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});

test('Move/Copy stays a dead stub; More menu is not this leftover', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const moveAt = editor.indexOf('{/* Move/Copy modal */}');
  assert.ok(moveAt > 0, 'Move/Copy modal exists');
  const move = editor.slice(moveAt);
  assert.match(move, /onClick=\{closeMoveModal\}/);
  assert.match(move, />Copy<\/button>/);
  assert.match(move, />Move<\/button>/);
  assert.doesNotMatch(move, /mutateTpl/);
  assert.doesNotMatch(move, /onExportSpaceCSV/);
  assert.doesNotMatch(move, /Copy to Spaces/);

  assert.match(editor, /\{ label: 'Rename', onClick: \(\) => beginTemplateRename\(t\.id\) \}/);
  assert.match(editor, /\{ label: 'Rename', onClick: \(\) => beginEntityRename\(ent\.id\) \}/);
  assert.doesNotMatch(editor, /Copy to Spaces/);
});
