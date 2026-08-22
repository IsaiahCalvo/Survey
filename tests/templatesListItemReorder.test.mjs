import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveItemById } from '../src/reorder/flatReorderUtils.js';

// Live proof: debug/scenarios/e2e-templates-list-item-reorder.spec.mjs
// Unique leftovers after entity / category / module reorder + Share:
// template-list reorder (reorderTemplates) + checklist item reorder (reorderItems).
// Distinct from survey-rail item reorder and leftover-18 A-03.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('reorderTemplates uses moveItemById + order preference and does not dirty via mutateTpl', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const start = editor.indexOf('const reorderTemplates = (activeId, overId) => {');
  assert.ok(start > 0, 'reorderTemplates');
  const block = editor.slice(start, editor.indexOf('const deleteTemplates = async (ids) => {', start));
  assert.match(block, /if \(!activeId \|\| !overId \|\| activeId === overId\) return;/);
  assert.match(block, /moveItemById\(prev, activeId, overId\)/);
  assert.match(block, /saveTemplateOrderPreference\(user, next\.map\(\(template\) => template\.id\)\)/);
  assert.match(block, /return next === prev \? prev : next;/);
  assert.doesNotMatch(block, /mutateTpl/);
  assert.doesNotMatch(block, /markEdited/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eReorderTemplates/);

  assert.match(editor, /const TEMPLATE_ORDER_STORAGE_KEY = 'surveyHub\.templateOrder';/);
  assert.match(editor, /localStorage\.setItem\(templateOrderKeyForUser\(user\), JSON\.stringify\(ids\.filter\(Boolean\)\)\)/);
  assert.match(editor, /ids=\{visibleTemplates\.map\(\(t\) => t\.id\)\} onReorder=\{reorderTemplates\}/);
  assert.match(editor, /from '\.\.\/reorder\/SortableRearrangeList'/);

  const seed = [
    { id: 't1', name: 'Security Walk-Through' },
    { id: 't2', name: 'MEP As-Built Markup' },
  ];
  assert.deepEqual(moveItemById(seed, 't1', 't2').map(({ name }) => name), ['MEP As-Built Markup', 'Security Walk-Through']);
  assert.equal(moveItemById(seed, 't1', 't1'), seed);
});

test('reorderItems uses moveItemById on active items and keeps archived at the tail', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const start = editor.indexOf('const reorderItemsInModule = (moduleIndex, ci, activeId, overId) => {');
  assert.ok(start > 0, 'reorderItemsInModule');
  const block = editor.slice(start, editor.indexOf('const reorderItems = (ci, activeId, overId) =>', start) + 140);
  assert.match(block, /if \(!activeId \|\| !overId \|\| activeId === overId\) return;/);
  assert.match(block, /filter\(isActiveChecklistItem\)/);
  assert.match(block, /filter\(isArchivedChecklistItem\)/);
  assert.match(block, /moveItemById\(activeItems, activeId, overId\)/);
  assert.match(block, /items: \[\.\.\.nextActiveItems, \.\.\.archivedItems\]/);
  assert.match(block, /const reorderItems = \(ci, activeId, overId\) => reorderItemsInModule\(openMod, ci, activeId, overId\);/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /__e2eReorderItems/);

  assert.match(editor, /ids=\{items\.map\(\(it\) => it\.id\)\} onReorder=\{\(activeId, overId\) => reorderItems\(i, activeId, overId\)\}/);
  assert.match(editor, /ids=\{items\.map\(\(it\) => it\.id\)\} onReorder=\{\(activeId, overId\) => reorderItems\(ci, activeId, overId\)\}/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /Is the camera cable pulled\?/);
  assert.match(preview, /Is the camera installed\?/);
  assert.match(preview, /Is the door roughed in\?/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  const active = [
    { id: 'i1', text: 'Is the camera cable pulled?' },
    { id: 'i2', text: 'Is the camera installed?' },
  ];
  const archived = [{ id: 'i9', text: 'retired', archived: true }];
  const nextActive = moveItemById(active, 'i1', 'i2');
  assert.deepEqual(nextActive.map(({ text }) => text), ['Is the camera installed?', 'Is the camera cable pulled?']);
  assert.deepEqual([...nextActive, ...archived].map(({ id }) => id), ['i2', 'i1', 'i9']);
  assert.equal(moveItemById(active, 'i1', 'i1'), active);
});

test('Move/Copy stays a dead stub; entity/category/module reorder is a distinct proven leftover', () => {
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

  assert.match(editor, /const reorderEntities = \(activeId, overId\) => \{/);
  assert.match(editor, /const reorderCategories = \(activeId, overId\) => reorderCategoriesInModule/);
  assert.match(editor, /const reorderMods = \(from, to\) => \{/);
  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /stampTool/);
  assert.doesNotMatch(editor, /Note-Link/);
});
